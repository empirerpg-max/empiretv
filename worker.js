export default {
  async fetch(request) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
          "Access-Control-Allow-Headers": "Range, Content-Type",
        }
      });
    }

    const id = url.searchParams.get("id");
    if (!id) return new Response("Parâmetro ?id= obrigatório", { status: 400 });

    // Primeira requisição — pega o cookie de confirmação do Drive
    const firstUrl = `https://drive.google.com/uc?export=download&id=${id}`;
    const firstResp = await fetch(firstUrl, {
      headers: { "User-Agent": "Mozilla/5.0" },
      redirect: "follow"
    });

    // Extrai o token de confirmação do cookie (para arquivos grandes)
    const setCookie = firstResp.headers.get("set-cookie") || "";
    const tokenMatch = setCookie.match(/download_warning[^=]*=([^;]+)/);
    const confirmToken = tokenMatch ? tokenMatch[1] : "t";

    // Segunda requisição — agora com o token de confirmação
    const finalUrl = `https://drive.google.com/uc?export=download&id=${id}&confirm=${confirmToken}`;
    const finalResp = await fetch(finalUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0",
        "Range": request.headers.get("Range") || "bytes=0-",
        "Cookie": setCookie
      },
      redirect: "follow"
    });

    const headers = new Headers(finalResp.headers);
    headers.set("Access-Control-Allow-Origin", "*");
    headers.set("Content-Type", "video/mp4");
    headers.delete("x-frame-options");
    headers.delete("content-security-policy");

    return new Response(finalResp.body, {
      status: finalResp.status,
      headers
    });
  }
};
