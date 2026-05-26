export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const secret = url.searchParams.get("secret");
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
          "Access-Control-Allow-Headers": "Range, Content-Type",
        }
      });
    }
    if (path === "/preload" || path === "/delete") {
      if (secret !== env.SECRET_KEY) {
        return new Response("Não autorizado", { status: 401 });
      }
    }
    if (path === "/preload") {
      const driveId = url.searchParams.get("id");
      const filename = url.searchParams.get("name");
      if (!driveId || !filename) return new Response("Faltam parâmetros id e name", { status: 400 });
      try {
        const firstResp = await fetch(
          `https://drive.google.com/uc?export=download&id=${driveId}`,
          { headers: { "User-Agent": "Mozilla/5.0" }, redirect: "follow" }
        );
        const cookie = firstResp.headers.get("set-cookie") || "";
        const tokenMatch = cookie.match(/download_warning[^=]*=([^;]+)/);
        const confirm = (tokenMatch && tokenMatch[1]) ? tokenMatch[1] : "t";
        const videoResp = await fetch(
          `https://drive.google.com/uc?export=download&id=${driveId}&confirm=${confirm}`,
          { headers: { "User-Agent": "Mozilla/5.0", "Cookie": cookie }, redirect: "follow" }
        );
        if (!videoResp.ok) return new Response(`Erro Drive: ${videoResp.status}`, { status: 500 });
        await env.VIDEOS_BUCKET.put(filename, videoResp.body, {
          httpMetadata: { contentType: "video/mp4" }
        });
        return new Response(JSON.stringify({ ok: true, filename }), {
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
        });
      } catch (e) {
        return new Response(`Erro: ${e.message}`, { status: 500 });
      }
    }
    if (path === "/delete") {
      const filename = url.searchParams.get("name");
      if (!filename) return new Response("Falta parâmetro name", { status: 400 });
      await env.VIDEOS_BUCKET.delete(filename);
      return new Response(JSON.stringify({ ok: true, deleted: filename }), {
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
      });
    }
    if (path === "/video") {
      const filename = url.searchParams.get("file");
      if (!filename) return new Response("Falta parâmetro file", { status: 400 });
      const rangeHeader = request.headers.get("Range");
      const options = rangeHeader ? { range: parseRange(rangeHeader) } : {};
      
      let object = null;
      try {
        object = await env.VIDEOS_BUCKET.get(filename, options);
      } catch (err) {
        console.error("Erro ao ler R2:", err);
      }

      if (object) {
        const headers = new Headers();
        headers.set("Content-Type", "video/mp4");
        headers.set("Accept-Ranges", "bytes");
        headers.set("Access-Control-Allow-Origin", "*");
        headers.set("Cache-Control", "no-cache");
        if (object.range) {
          const { offset, length } = object.range;
          headers.set("Content-Range", `bytes ${offset}-${offset + length - 1}/${object.size}`);
          headers.set("Content-Length", String(length));
          return new Response(object.body, { status: 206, headers });
        }
        headers.set("Content-Length", String(object.size));
        return new Response(object.body, { status: 200, headers });
      }

      // --- FALLBACK AUTOMÁTICO DE SEGURANÇA: SE NÃO TIVER NO R2, TRANSMITE DIRETO DO GOOGLE DRIVE ---
      // Formato do arquivo esperado: video_<ID_DO_DRIVE>.mp4
      const driveId = filename.replace(/^video_/, "").replace(/\.mp4$/, "");
      if (driveId && driveId !== filename) {
        console.log(`[R2 Fallback] ${filename} não localizado no R2. Sintonizando direto do Google Drive ${driveId}...`);
        try {
          const firstResp = await fetch(
            `https://drive.google.com/uc?export=download&id=${driveId}`,
            { headers: { "User-Agent": "Mozilla/5.0" }, redirect: "follow" }
          );
          const cookie = firstResp.headers.get("set-cookie") || "";
          const tokenMatch = cookie.match(/download_warning[^=]*=([^;]+)/);
          const confirm = (tokenMatch && tokenMatch[1]) ? tokenMatch[1] : "t";
          const videoResp = await fetch(
            `https://drive.google.com/uc?export=download&id=${driveId}&confirm=${confirm}`,
            { headers: { "User-Agent": "Mozilla/5.0", "Cookie": cookie }, redirect: "follow" }
          );

          if (videoResp.ok) {
            // Repassa o stream original do Drive com cabeçalhos CORS de vídeo
            const headers = new Headers();
            headers.set("Access-Control-Allow-Origin", "*");
            headers.set("Content-Type", "video/mp4");
            // Se o Drive retornou Content-Length, nós repassamos
            const contentLen = videoResp.headers.get("Content-Length");
            if (contentLen) headers.set("Content-Length", contentLen);
            
            return new Response(videoResp.body, {
              status: videoResp.status,
              headers
            });
          }
        } catch (e) {
          console.error(`[R2 Fallback Exception] Erro na sintonização direta do Drive: ${e.message}`);
        }
      }

      // Se todas as conexões falharam, busca o vídeo de backup padrão e serve de forma direta sem redirecionamento para evitar erros de CORS no HTML5
      console.warn(`[Fallback Crítico] Sem fontes disponíveis para ${filename}. Servindo vídeo de demonstração de forma direta...`);
      try {
        const backupResp = await fetch("https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4");
        if (backupResp.ok) {
          const headers = new Headers();
          headers.set("Access-Control-Allow-Origin", "*");
          headers.set("Content-Type", "video/mp4");
          const contentLen = backupResp.headers.get("Content-Length");
          if (contentLen) headers.set("Content-Length", contentLen);
          return new Response(backupResp.body, {
            status: 200,
            headers
          });
        }
      } catch (errBackup) {
        console.error("Erro ao sintonizar vídeo de backup de emergência no Worker:", errBackup);
      }
      return new Response("Erro: nenhuma fonte de vídeo disponível.", { status: 404 });
    }
    return new Response("Rota não encontrada", { status: 404 });
  }
};
function parseRange(rangeHeader) {
  const match = rangeHeader?.match(/bytes=(\d+)-(\d*)/);
  if (!match) return undefined;
  const offset = parseInt(match[1]);
  const end = match[2] ? parseInt(match[2]) : undefined;
  return { offset, length: end !== undefined ? end - offset + 1 : undefined };
}
