export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const secret = url.searchParams.get("secret");

    if (secret !== env.SECRET_KEY) {
      return new Response("Não autorizado", { status: 401 });
    }

    // /preload — baixa do Drive e salva no R2
    if (path === "/preload") {
      const driveId = url.searchParams.get("id");
      const filename = url.searchParams.get("name");
      if (!driveId || !filename) return new Response("Faltam parâmetros id e name", { status: 400 });

      try {
        // Primeira requisição para pegar cookie de confirmação
        const firstResp = await fetch(
          `https://drive.google.com/uc?export=download&id=${driveId}`,
          { headers: { "User-Agent": "Mozilla/5.0" }, redirect: "follow" }
        );
        const cookie = firstResp.headers.get("set-cookie") || "";
        const tokenMatch = cookie.match(/download_warning[^=]*=([^;]+)/);
        const confirm = tokenMatch ? tokenMatch[1] : "t";

        // Segunda requisição com confirmação
        const videoResp = await fetch(
          `https://drive.google.com/uc?export=download&id=${driveId}&confirm=${confirm}`,
          {
            headers: { "User-Agent": "Mozilla/5.0", "Cookie": cookie },
            redirect: "follow"
          }
        );

        if (!videoResp.ok) return new Response(`Erro Drive: ${videoResp.status}`, { status: 500 });

        await env.VIDEOS_BUCKET.put(filename, videoResp.body, {
          httpMetadata: { contentType: "video/mp4" }
        });

        return new Response(JSON.stringify({ ok: true, filename }), {
          headers: { "Content-Type": "application/json" }
        });
      } catch (e) {
        return new Response(`Erro: ${e.message}`, { status: 500 });
      }
    }

    // /delete — exclui do R2 após transmissão
    if (path === "/delete") {
      const filename = url.searchParams.get("name");
      if (!filename) return new Response("Falta parâmetro name", { status: 400 });

      await env.VIDEOS_BUCKET.delete(filename);
      return new Response(JSON.stringify({ ok: true, deleted: filename }), {
        headers: { "Content-Type": "application/json" }
      });
    }

    // /video — serve o vídeo com Range requests (streaming real)
    if (path === "/video") {
      const filename = url.searchParams.get("file");
      if (!filename) return new Response("Falta parâmetro file", { status: 400 });

      const rangeHeader = request.headers.get("Range");
      const options = rangeHeader ? { range: parseRange(rangeHeader) } : {};
      const object = await env.VIDEOS_BUCKET.get(filename, options);

      if (!object) return new Response("Vídeo não encontrado no R2", { status: 404 });

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

    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
          "Access-Control-Allow-Headers": "Range",
        }
      });
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
