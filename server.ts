import express from "express";
import path from "path";
import fs from "fs";
import { createServer as createViteServer } from "vite";

// Configurações do ambiente de cache
const CACHE_DIR = path.join("/tmp", "empiretv_videos");
if (!fs.existsSync(CACHE_DIR)) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
} else {
  // Limpeza na inicialização para expurgar possíveis resíduos corrompidos do player (HTML de erros salvos como MP4)
  try {
    const cachedFiles = fs.readdirSync(CACHE_DIR);
    for (const cachedFile of cachedFiles) {
      if (cachedFile.endsWith(".mp4") || cachedFile.endsWith(".tmp")) {
        fs.unlinkSync(path.join(CACHE_DIR, cachedFile));
      }
    }
    console.log("[Empire TV Server] Diretório de cache limpo com sucesso de potenciais arquivos corrompidos anteriores.");
  } catch (e) {
    console.error("[Empire TV Server] Erro ao tentar limpar arquivos corrompidos de cache na inicialização:", e);
  }
}

const GOOGLE_APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycby7OeFYuai1QoTEXD427-Kn_2KBvh3nakD4iKSuOji9-i3x7sK8DD59BHRBRc5Ow1YB/exec";
const activeDownloads = new Set<string>();

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Middleware CORS para as rotas da API
  app.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Range, Content-Type");
    next();
  });

  // Rota de status do servidor
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", cache_dir: CACHE_DIR });
  });

  // Rota de streaming de vídeo super otimizada com suporte nativo a Range e cache local
  app.get("/video", async (req, res) => {
    const file = req.query.file as string;
    if (!file) {
      return res.status(400).send("Falta parâmetro file");
    }

    // Extrai o ID do Drive a partir do formato esperado video_ID.mp4
    const driveId = file.replace(/^video_/, "").replace(/\.mp4$/, "");
    if (!driveId || driveId === file) {
      return res.status(400).send("Formato de arquivo inválido");
    }

    const localPath = path.join(CACHE_DIR, `${driveId}.mp4`);

    // 1. Caso o arquivo já esteja totalmente cacheado localmente em disco
    if (fs.existsSync(localPath)) {
      try {
        const stats = fs.statSync(localPath);
        if (stats.size > 2 * 1024 * 1024) { // Pelo menos 2MB para garantir integridade básica
          console.log(`[Express Cache] Servindo "${file}" localmente do cache em disco (${(stats.size / 1024 / 1024).toFixed(2)} MB)`);
          return res.sendFile(localPath);
        } else {
          console.warn(`[Express Cache Corrupt Detected] Arquivo local "${file}" tem apenas ${(stats.size / 1024).toFixed(1)} KB (esperado > 2MB). Provavelmente é um HTML de erro do Google Drive (cota excedida ou aviso de vírus). Excluindo-o para permitir redownload fresco.`);
          try {
            fs.unlinkSync(localPath);
          } catch (e) {}
        }
      } catch (err) {
        console.error(`[Express Cache Read Error] Falha ao ler arquivo local:`, err);
      }
    }

    // 2. Caso não esteja no cache, sintoniza em segundo plano e faz proxy em tempo real
    console.log(`[Express Cache Miss] "${file}" não disponível localmente. Baixando em background e servindo por streaming direto do Drive...`);
    
    // Dispara o download em background para as requisições subsequentes ( ranges futuros )
    triggerBackgroundDownload(driveId, localPath);

    // Serve a transmissão diretamente do Drive por streaming contínuo sem fazer o usuário esperar o fim do download
    return serveDirectDriveStreaming(driveId, req, res);
  });

  // Integrazione Vite em desenvolvimento / Servidor estático em produção
  if (process.env.NODE_ENV !== "production") {
    console.log("[Server] Modo de Desenvolvimento Detectado. Acoplando o Vite Middleware...");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    console.log("[Server] Modo de Produção Ativo. Servindo arquivos compilados de /dist...");
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[Empire TV Server] Ativo em http://0.0.0.0:${PORT}`);
  });
}

// ============================================================
// LOGICA DE SINAL E STREAMING DIRETO DO GOOGLE DRIVE
// ============================================================

async function serveDirectDriveStreaming(driveId: string, req: express.Request, res: express.Response) {
  try {
    const url = `https://drive.google.com/uc?export=download&id=${driveId}`;
    const response = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0" }
    });

    const cookies = response.headers.getSetCookie();
    const cookieString = cookies.join("; ");
    const warningCookie = cookies.find(c => c.includes("download_warning"));
    let confirm = "t";
    if (warningCookie) {
      const match = warningCookie.match(/download_warning[^=]*=([^;]+)/);
      if (match && match[1]) {
        confirm = match[1];
      }
    }

    const downloadUrl = `https://drive.google.com/uc?export=download&id=${driveId}&confirm=${confirm}`;

    const driveHeaders: Record<string, string> = {
      "User-Agent": "Mozilla/5.0",
      "Cookie": cookieString
    };
    if (req.headers.range) {
      driveHeaders["Range"] = req.headers.range;
    }

    const videoResponse = await fetch(downloadUrl, { headers: driveHeaders });

    // Se o sinal recebido for inválido, cota diária excedida ou uma resposta HTML contendo erro do Drive, fazemos o failover preventivo
    const contentType = videoResponse.headers.get("Content-Type") || "";
    const isHtmlOrText = contentType.includes("text/html") || contentType.includes("text/plain") || contentType.includes("application/json");

    if (!videoResponse.ok || isHtmlOrText) {
      console.warn(`[Direct Drive Streaming Fallback] Link com cota estourada, arquivo inexistente ou erro do Drive (OK: ${videoResponse.ok}, Content-Type: ${contentType}). Redirecionando transmissão transparentemente para vídeo de backup de contingência estável...`);
      return serveBackupVideo(req, res);
    }

    res.status(videoResponse.status);
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Cache-Control", "no-cache");

    if (contentType) res.setHeader("Content-Type", contentType);

    const contentRange = videoResponse.headers.get("Content-Range");
    if (contentRange) res.setHeader("Content-Range", contentRange);

    const contentLength = videoResponse.headers.get("Content-Length");
    if (contentLength) res.setHeader("Content-Length", contentLength);

    const body = videoResponse.body;
    if (body) {
      // @ts-ignore
      const reader = body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(Buffer.from(value));
      }
    }
    res.end();
  } catch (err) {
    console.error(`[Streaming Fallback Error] Falha de conexão de sinal do Drive para o ID ${driveId}:`, err);
    return serveBackupVideo(req, res);
  }
}

// ============================================================
// TRANSMISSÃO RESILIENTE DE VÍDEO DE CONTINGÊNCIA (BIG BUCK BUNNY)
// ============================================================

async function serveBackupVideo(req: express.Request, res: express.Response) {
  try {
    const backupUrl = "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4";
    const backupHeaders: Record<string, string> = { "User-Agent": "Mozilla/5.0" };
    if (req.headers.range) {
      backupHeaders["Range"] = req.headers.range;
    }
    const backupResponse = await fetch(backupUrl, { headers: backupHeaders });
    
    res.status(backupResponse.status);
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Cache-Control", "no-cache");
    const ct = backupResponse.headers.get("Content-Type");
    if (ct) res.setHeader("Content-Type", ct);
    const cr = backupResponse.headers.get("Content-Range");
    if (cr) res.setHeader("Content-Range", cr);
    const cl = backupResponse.headers.get("Content-Length");
    if (cl) res.setHeader("Content-Length", cl);

    const body = backupResponse.body;
    if (body) {
      // @ts-ignore
      const reader = body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(Buffer.from(value));
      }
    }
    res.end();
  } catch (err) {
    console.error("[Backup Streaming Error] Falha extrema ao servir o vídeo de contingência:", err);
    if (!res.headersSent) {
      res.status(500).send("Transmissão temporariamente indisponível. Tente atualizar a sintonia.");
    }
  }
}

// ============================================================
// DOWNLOAD EM SEGUNDO PLANO PARA CACHE DE ALTA VELOCIDADE
// ============================================================

function triggerBackgroundDownload(driveId: string, outputPath: string) {
  if (activeDownloads.has(driveId)) return;
  activeDownloads.add(driveId);

  console.log(`[Downloader Background] Pré-carregamento iniciado para o ID do Drive: ${driveId}`);

  downloadFromGoogleDrive(driveId, outputPath)
    .then((success) => {
      activeDownloads.delete(driveId);
      if (success) {
        try {
          const stats = fs.statSync(outputPath);
          console.log(`[Downloader Background] Sucesso! Vídeo ${driveId} salvo localmente (${(stats.size / 1024 / 1024).toFixed(2)} MB).`);
        } catch (e) {}
      } else {
        console.error(`[Downloader Background] Falha ao sintonizar/salvar vídeo para o ID: ${driveId}`);
        if (fs.existsSync(outputPath)) {
          try { fs.unlinkSync(outputPath); } catch (e) {}
        }
        const tempPath = outputPath + ".tmp";
        if (fs.existsSync(tempPath)) {
          try { fs.unlinkSync(tempPath); } catch (e) {}
        }
      }
    })
    .catch((err) => {
      activeDownloads.delete(driveId);
      console.error(`[Downloader Background] Erro fatal no pré-carregamento do ID ${driveId}:`, err);
      if (fs.existsSync(outputPath)) {
        try { fs.unlinkSync(outputPath); } catch (e) {}
      }
      const tempPath = outputPath + ".tmp";
      if (fs.existsSync(tempPath)) {
        try { fs.unlinkSync(tempPath); } catch (e) {}
      }
    });
}

async function downloadFromGoogleDrive(driveId: string, outputPath: string): Promise<boolean> {
  const tempPath = outputPath + ".tmp";
  try {
    const url = `https://drive.google.com/uc?export=download&id=${driveId}`;
    const response = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0" }
    });

    const cookies = response.headers.getSetCookie();
    const cookieString = cookies.join("; ");
    const warningCookie = cookies.find(c => c.includes("download_warning"));
    let confirm = "t";
    if (warningCookie) {
      const match = warningCookie.match(/download_warning[^=]*=([^;]+)/);
      if (match && match[1]) {
        confirm = match[1];
      }
    }

    const downloadUrl = `https://drive.google.com/uc?export=download&id=${driveId}&confirm=${confirm}`;
    const videoResponse = await fetch(downloadUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0",
        "Cookie": cookieString
      }
    });

    if (!videoResponse.ok) {
      console.error(`[Drive API] Erro ao buscar sinal para download: ${videoResponse.statusText}`);
      return false;
    }

    const contentType = videoResponse.headers.get("Content-Type") || "";
    const isHtmlOrText = contentType.includes("text/html") || contentType.includes("text/plain") || contentType.includes("application/json");
    if (isHtmlOrText) {
      console.error(`[Drive API] Tentativa de download retornou página de erro, aviso de vírus ou cota do Drive excedida (Content-Type: ${contentType}). Abortando gravação para não corromper o cache.`);
      return false;
    }

    // Criar stream de escrita no arquivo temporário e salvar localmente em fatias
    const fileStream = fs.createWriteStream(tempPath);
    const body = videoResponse.body;
    if (!body) {
      try { fileStream.end(); fs.unlinkSync(tempPath); } catch (e) {}
      return false;
    }

    // @ts-ignore
    const reader = body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      fileStream.write(Buffer.from(value));
    }
    fileStream.end();

    return new Promise((resolve) => {
      fileStream.on("finish", () => {
        try {
          if (fs.existsSync(tempPath)) {
            // Renomeia o arquivo temporário completo para o destino final .mp4
            fs.renameSync(tempPath, outputPath);
            resolve(true);
          } else {
            resolve(false);
          }
        } catch (renameErr) {
          console.error(`[Rename Error] Falha ao renomear arquivo temporario de cache:`, renameErr);
          resolve(false);
        }
      });
      fileStream.on("error", (err) => {
        console.error(`[File Stream Error] Erro ao gravar o arquivo de cache temporario:`, err);
        try {
          if (fs.existsSync(tempPath)) {
            fs.unlinkSync(tempPath);
          }
        } catch (e) {}
        resolve(false);
      });
    });
  } catch (error) {
    console.error(`[Drive API Error] Exceção na chamada de pré-carga do Drive:`, error);
    try {
      if (fs.existsSync(tempPath)) {
        fs.unlinkSync(tempPath);
      }
    } catch (e) {}
    return false;
  }
}

// ============================================================
// SINCRONIZADOR DE MAPA E GRADE DE PROGRAMAS (BACKGROUND CRON)
// ============================================================

async function runBackgroundCacheSync() {
  try {
    console.log("[Cache Sync] Analisando planilha de fuso e programação para pré-carga preventiva...");
    const res = await fetch(GOOGLE_APPS_SCRIPT_URL);
    if (!res.ok) {
      console.warn(`[Cache Sync Warning] Apps Script indisponível. Status: ${res.status}`);
      return;
    }
    const data: any = await res.json();
    if (data.status !== "success") return;

    const currentDriveId = data.current?.drive_video_id;
    const fullSchedule = data.fullSchedule || [];

    // Mapeia até dois alvos cruciais de pré-carga para manter em cache rígido:
    // 1. O vídeo tocando agora "Ao Vivo"
    // 2. O próximo vídeo imediatamente escalado
    const idsToKeep = new Set<string>();
    if (currentDriveId && !currentDriveId.startsWith("http")) {
      idsToKeep.add(currentDriveId);
    }

    const nowSec = getSecondsToday();
    const nextItem = fullSchedule.find((item: any) => item.startInSeconds > nowSec);
    if (nextItem && nextItem.drive_video_id && !nextItem.drive_video_id.startsWith("http")) {
      idsToKeep.add(nextItem.drive_video_id);
    }

    // Dispara precocemente o pré-carregador se os arquivos de sinal ainda não estiverem guardados
    for (const driveId of idsToKeep) {
      const localPath = path.join(CACHE_DIR, `${driveId}.mp4`);
      if (!fs.existsSync(localPath)) {
        console.log(`[Cache Sync] Agendando download preventivo antecipado para o vídeo do ID: ${driveId}`);
        triggerBackgroundDownload(driveId, localPath);
      }
    }

    // Auto-limpeza inteligente: remove do cache local qualquer vídeo que não esteja na janela de reprodução atual ou próxima
    const files = fs.readdirSync(CACHE_DIR);
    for (const file of files) {
      if (file.endsWith(".mp4")) {
        const driveId = file.replace(/\.mp4$/, "");
        if (!idsToKeep.has(driveId)) {
          console.log(`[Cache Sync Garbage Collector] Removendo cache obsoleto para liberar espaço: ${file}`);
          try {
            fs.unlinkSync(path.join(CACHE_DIR, file));
          } catch (e) {
            console.error(`[Cache Sync Garbage Collector Error] Erro ao limpar arquivo obsoleto ${file}:`, e);
          }
        }
      }
    }
  } catch (error) {
    console.error("[Cache Sync Error] Exceção ao sincronizar a esteira de programação:", error);
  }
}

function getSecondsToday() {
  const now = new Date();
  const localTime = new Date(now.toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
  return (localTime.getHours() * 3600) + (localTime.getMinutes() * 60) + localTime.getSeconds();
}

// Ativa a esteira de pré-carregamento preventivo de background de tempos em tempos
setInterval(runBackgroundCacheSync, 45000); // Executa um scan preventivo a cada 45 segundos
setTimeout(runBackgroundCacheSync, 4000);   // Executa o primeiro scan preventivo logo na inicialização da rede

startServer();
