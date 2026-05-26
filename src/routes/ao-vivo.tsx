import React, { useEffect, useRef, useState, useCallback } from "react";

const API_URL = "https://script.google.com/macros/s/AKfycby7OeFYuai1QoTEXD427-Kn_2KBvh3nakD4iKSuOji9-i3x7sK8DD59BHRBRc5Ow1YB/exec";

interface Transmission {
  status: string;
  programa: string;
  tipo: string;
  materialTocando: string;
  buff: string;
  videoUrl: string;
  seekOffset: number;
  durationSeconds: number;
  startedAt: string;
  isBackup: boolean;
  rowNum?: number;
  drive_video_id?: string;
}

export default function AoVivo() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const staticCanvasRef = useRef<HTMLCanvasElement>(null);
  const currentUrlRef = useRef<string>("");
  const errorCountRef = useRef<number>(0);
  const [current, setCurrent] = useState<Transmission | null>(null);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState("");
  
  // Estados para contornar limitações do navegador e queda de rede
  const [useAnalogStatic, setUseAnalogStatic] = useState(false);
  const [isBrowserAutoplayMuted, setIsBrowserAutoplayMuted] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);

  // Efeito de estática de TV analógica procedural (chuvisco de TV clássica)
  useEffect(() => {
    if (!useAnalogStatic) return;
    const canvas = staticCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animId: number;
    const resize = () => {
      if (canvas.parentElement) {
        canvas.width = canvas.parentElement.clientWidth;
        canvas.height = canvas.parentElement.clientHeight;
      } else {
        canvas.width = 640;
        canvas.height = 360;
      }
    };
    resize();
    window.addEventListener("resize", resize);

    const renderNoise = () => {
      const w = canvas.width;
      const h = canvas.height;
      try {
        const imgData = ctx.createImageData(w, h);
        const data = imgData.data;
        const len = data.length;
        for (let i = 0; i < len; i += 4) {
          const value = Math.floor(Math.random() * 255);
          data[i] = value;     // R
          data[i+1] = value;   // G
          data[i+2] = value;   // B
          data[i+3] = 255;     // A
        }
        ctx.putImageData(imgData, 0, 0);

        // Adiciona um letreiro retrô piscando sutilmente de "SEM COR / SINTONIA"
        ctx.fillStyle = "rgba(0,0,0,0.4)";
        ctx.fillRect(20, 20, 240, 50);
        ctx.strokeStyle = "#8b5cf6";
        ctx.lineWidth = 2;
        ctx.strokeRect(20, 20, 240, 50);

        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 14px monospace";
        ctx.fillText("📡 PROCURANDO SINAL...", 35, 50);
      } catch (err) {
        // Fallback rápido se falhar por canvas invisivel
      }
      animId = requestAnimationFrame(renderNoise);
    };
    renderNoise();

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener("resize", resize);
    };
  }, [useAnalogStatic]);

  const fetchAndSync = useCallback(async () => {
    setIsSyncing(true);
    try {
      const res = await fetch(API_URL);
      const data = await res.json();
      if (data.status !== "success" || !data.current) {
        setErro("Nenhuma transmissão no momento.");
        setUseAnalogStatic(true);
        setLoading(false);
        setIsSyncing(false);
        return;
      }
      const c: Transmission = data.current;
      
      // Inteligência de Autoreparo: Se a URL do vídeo estiver vazia ou contiver uma data residual,
      // extraímos o ID do Drive a partir de qualquer campo exposto no schedule (como "status" que tem o link real do drive)
      let correctedUrl = c.videoUrl;
      const fullSchedule = data.fullSchedule || [];
      const scheduleItem = fullSchedule.find((item: any) => Number(item.rowNum) === Number(c.rowNum));
      
      const regexDriveId = [
        /\/d\/([a-zA-Z0-9_-]{25,45})/i,
        /[?&]id=([a-zA-Z0-9_-]{25,45})/i,
        /\/file\/d\/([a-zA-Z0-9_-]{25,45})/i
      ];

      const extractId = (val: string): string => {
        if (!val) return "";
        val = String(val).trim();
        for (const regex of regexDriveId) {
          const match = val.match(regex);
          if (match && match[1]) return match[1];
        }
        if (/^[a-zA-Z0-9_-]{25,45}$/.test(val) && !val.includes("GMT") && !val.includes("Standard") && !val.includes(":") && !val.includes(" ")) {
          return val;
        }
        return "";
      };

      let realId = "";
      if (scheduleItem) {
        const checkFields = ["status", "link_drive", "drive_video_id", "linkDoDrive", "link_do_drive", "videoUrl"];
        for (const field of checkFields) {
          const val = scheduleItem[field];
          if (val) {
            const foundId = extractId(val);
            if (foundId) {
              realId = foundId;
              break;
            }
          }
        }
      }

      if (!realId) {
        const checkFields = ["videoUrl", "drive_video_id", "status"];
        for (const field of checkFields) {
          const val = (c as any)[field];
          if (val) {
            const foundId = extractId(val);
            if (foundId) {
              realId = foundId;
              break;
            }
          }
        }
      }

      const isUrlSuspicious = !c.videoUrl || c.videoUrl.includes("GMT") || c.videoUrl.includes("Standard") || c.videoUrl.includes("Time");
      if (realId && (isUrlSuspicious || !c.videoUrl.includes(realId))) {
        let secret = "garupapa@123";
        if (c.videoUrl && c.videoUrl.includes("secret=")) {
          const match = c.videoUrl.match(/[?&]secret=([^&]+)/);
          if (match && match[1]) {
            secret = match[1];
          }
        }
        correctedUrl = `https://empiretv.empirerpg-forum.workers.dev/video?file=video_${realId}.mp4&secret=${secret}`;
        console.warn(`[Autoreparo Frontend] Identificamos um desalinhamento na resposta da API na nuvem e corrigimos com sucesso a URL de: "${c.videoUrl}" para: "${correctedUrl}"`);
        c.videoUrl = correctedUrl;
      }

      setCurrent(c);
      setErro("");
      setUseAnalogStatic(false);

      const video = videoRef.current;
      if (!video || !c.videoUrl) {
        setIsSyncing(false);
        return;
      }

      if (currentUrlRef.current !== c.videoUrl) {
        currentUrlRef.current = c.videoUrl;
        video.pause();

        const onMetadataLoaded = () => {
          const seekTo = Math.max(c.seekOffset || 0, 0);
          video.currentTime = seekTo;
          
          video.play()
            .then(() => {
              setIsBrowserAutoplayMuted(false);
              errorCountRef.current = 0;
            })
            .catch((err) => {
              console.warn("[Autoplay] Bloqueado pelo navegador devido a políticas de áudio. Mutando para iniciar...", err);
              video.muted = true;
              setIsBrowserAutoplayMuted(true);
              video.play()
                .then(() => {
                  errorCountRef.current = 0;
                })
                .catch((errMuted) => {
                  console.error("[Autoplay] Falha persistente ao tentar tocar mesmo mutado:", errMuted);
                  // Não entra em estática imediatamente, deixa o onError lidar ou tenta o retry automático
                });
            });
        };

        video.addEventListener("loadedmetadata", onMetadataLoaded, { once: true });
        video.src = c.videoUrl;
        video.load();
      } else {
        const diff = Math.abs(video.currentTime - (c.seekOffset || 0));
        if (diff > 5) {
          console.log(`[Sync] Resincronizando transmissão. Ajustando posição de ${video.currentTime.toFixed(1)}s para ${c.seekOffset}s`);
          video.currentTime = c.seekOffset || 0;
        }
      }
    } catch (e) {
      console.error(e);
      setErro("Houve uma instabilidade temporária ao conectar com a grade de programação. Forçando estática do receptor...");
      setUseAnalogStatic(true);
    } finally {
      setLoading(false);
      setIsSyncing(false);
    }
  }, []);

  useEffect(() => {
    fetchAndSync();
    const interval = setInterval(fetchAndSync, 60000);
    return () => clearInterval(interval);
  }, [fetchAndSync]);

  const handleUnmute = () => {
    const video = videoRef.current;
    if (video) {
      video.muted = false;
      setIsBrowserAutoplayMuted(false);
      // Força play caso estivesse parado
      video.play().catch(() => {});
    }
  };

  return (
    <div style={styles.page}>
      {/* Barra de Notificações / Alertas Inteligentes */}
      {isBrowserAutoplayMuted && (
        <div className="bg-amber-600 text-white font-medium text-center px-4 py-2 flex items-center justify-center gap-3 animate-pulse cursor-pointer transition hover:bg-amber-500" onClick={handleUnmute}>
          <span>🔇 O Áudio foi mutado para permitir a sintonia automática no seu navegador.</span>
          <button className="bg-white text-amber-950 font-bold px-3 py-1 rounded text-xs uppercase shadow hover:scale-105 active:scale-95 transition">
            🔈 Ativar Som
          </button>
        </div>
      )}

      {loading && (
        <div style={styles.center}>
          <p style={styles.loadingText}>📡 Sintonizando Empire TV...</p>
        </div>
      )}

      <div style={styles.playerWrapper} className="relative group">
        {/* Renderiza estática analógica retrô se houver falhas com o arquivo */}
        {useAnalogStatic ? (
          <div className="absolute inset-0 z-10 w-full h-full bg-black flex flex-col items-center justify-center">
            <canvas ref={staticCanvasRef} className="absolute inset-0 w-full h-full object-cover opacity-80" />
            <div className="z-20 bg-zinc-950/90 border border-violet-500 p-6 rounded-lg text-center max-w-md mx-4 shadow-2xl">
              <span className="text-red-500 font-bold tracking-wider text-xs block mb-1">🚨 QUEDA DE SINAL</span>
              <h3 className="text-white font-bold text-lg mb-2">Aguardando Transmissão de Vídeo</h3>
              <p className="text-zinc-400 text-sm mb-4">
                O sinal falhou ou não há vídeos programados tocando no momento. O receptor de TV continuará tentando reconectar de forma automática.
              </p>
              <button 
                onClick={fetchAndSync}
                disabled={isSyncing}
                className="bg-violet-600 hover:bg-violet-500 text-white font-bold px-4 py-2 rounded text-sm uppercase transition active:scale-95 disabled:opacity-50 flex items-center gap-2 mx-auto"
              >
                {isSyncing ? "⚡ Sincronizando..." : "🔄 Forçar Re-sintonia"}
              </button>
            </div>
          </div>
        ) : null}

        <video
          ref={videoRef}
          controls
          playsInline
          style={styles.video}
          onEnded={fetchAndSync}
          onError={(e) => {
            const video = videoRef.current;
            if (!video) return;

            const mediaError = video.error;

            // Ignora se for o erro de Aborto do HTML5 (código 1). Esse erro ocorre quando limpamos ou redefinimos a transmissão
            if (mediaError && mediaError.code === 1) {
              console.log("[Player] Ignorando evento de carregamento abortado (comportamento de transição natural de mídias).");
              return;
            }

            // Ignorar erros temporários se o player estiver limpando o src ou durante transição de mídias
            if (!video.src || video.src === "" || video.src === window.location.href) {
              console.log("[Player] Ignorando evento de erro temporário durante transição ou limpeza de fonte.");
              return;
            }

            const errorDetails = mediaError ? ` Código: ${mediaError.code} - Mensagem: ${mediaError.message || ""}` : "";
            console.error(`Erro de carregamento capturado no player HTML5. Tentativa ${errorCountRef.current + 1}/3.${errorDetails}`);
            
            errorCountRef.current += 1;
            if (errorCountRef.current < 3) {
              // Tenta re-sintonizar após 2 segundos limpando o cache de URL para forçar recarregamento revigorado
              setTimeout(() => {
                currentUrlRef.current = "";
                fetchAndSync();
              }, 2000);
            } else {
              console.error("Falhas consecutivas de carregamento de mídia. Entrando em modo de estática analógica de contingência.");
              setUseAnalogStatic(true);
            }
          }}
        />
      </div>

      {/* Barra de Controle de Sincronia Rápida */}
      {!loading && (
        <div className="bg-zinc-900 border-b border-zinc-800 px-4 py-2 flex items-center justify-between text-xs text-zinc-400 gap-4">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping" />
            <span>Sincronia automática ativa (Atualiza a cada 60s)</span>
          </div>
          <button 
            onClick={fetchAndSync}
            disabled={isSyncing}
            className="text-violet-400 hover:text-violet-300 transition font-bold uppercase tracking-wider flex items-center gap-1 disabled:opacity-50"
          >
            {isSyncing ? "⚡ Sincronizando..." : "📡 Sincronizar Agora"}
          </button>
        </div>
      )}

      {current && !loading && !useAnalogStatic && (
        <div style={styles.infoBar}>
          <div style={styles.infoLeft}>
            <span style={styles.liveTag}>● AO VIVO</span>
            <span style={styles.programa}>{current.programa}</span>
            <span style={styles.tipo}>{current.tipo}</span>
          </div>
          <div style={styles.infoRight}>
            <span style={styles.material}>🎵 {current.materialTocando}</span>
            {current.buff && <span style={styles.buff}>🎮 {current.buff}</span>}
          </div>
        </div>
      )}

      {!current && !loading && !useAnalogStatic && (
        <div style={styles.offAir}>
          <p>📺 Sem transmissão agora. Volte mais tarde!</p>
        </div>
      )}

      {erro && !useAnalogStatic && <p style={styles.erro}>⚠️ {erro}</p>}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: { background: "#0a0a0a", minHeight: "100vh", display: "flex", flexDirection: "column", fontFamily: "sans-serif" },
  center: { display: "flex", alignItems: "center", justifyContent: "center", flex: 1 },
  loadingText: { color: "#fff", fontSize: 18 },
  playerWrapper: { width: "100%", background: "#000", aspectRatio: "16/9" },
  video: { width: "100%", height: "100%", display: "block" },
  infoBar: { display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 10, padding: "12px 20px", background: "#111", borderTop: "2px solid #8b5cf6" },
  infoLeft: { display: "flex", alignItems: "center", gap: 10 },
  infoRight: { display: "flex", alignItems: "center", gap: 16 },
  liveTag: { background: "#ef4444", color: "#fff", padding: "2px 8px", borderRadius: 4, fontSize: 12, fontWeight: "bold" },
  programa: { color: "#fff", fontWeight: "bold", fontSize: 16 },
  tipo: { color: "#8b5cf6", fontSize: 13, background: "#1e1b4b", padding: "2px 8px", borderRadius: 4 },
  material: { color: "#aaa", fontSize: 14 },
  buff: { color: "#a78bfa", fontSize: 13 },
  offAir: { color: "#aaa", textAlign: "center", padding: 40, fontSize: 18 },
  erro: { color: "#ef4444", padding: "8px 20px", fontSize: 14 },
};
