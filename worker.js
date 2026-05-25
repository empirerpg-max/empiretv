export default {
  async fetch(request) {
    const url = new URL(request.url);
    const id = url.searchParams.get("id");
    if (!id) return new Response("sem id", { status: 400 });

    const driveUrl = `https://drive.google.com/uc?export=download&id=${id}&confirm=t`;
    const driveResp = await fetch(driveUrl, {
      headers: { Range: request.headers.get("Range") || "bytes=0-" }
    });

    const headers = new Headers(driveResp.headers);
    headers.set("Access-Control-Allow-Origin", "*");
    headers.set("Content-Type", "video/mp4");
    return new Response(driveResp.body, { status: driveResp.status, headers });
  }
};
