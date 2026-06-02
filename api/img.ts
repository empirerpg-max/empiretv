import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const { id } = req.query;
  if (!id || typeof id !== 'string') {
    return res.status(400).json({ error: 'Missing id' });
  }

  // Tenta 3 URLs em ordem de confiabilidade
  const candidates = [
    `https://lh3.googleusercontent.com/d/${id}`,
    `https://drive.google.com/uc?export=download&id=${id}&confirm=t`,
    `https://drive.usercontent.google.com/download?id=${id}&export=view`,
  ];

  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
    'Referer': 'https://drive.google.com/',
  };

  for (const url of candidates) {
    try {
      const response = await fetch(url, { redirect: 'follow', headers });
      const ct = response.headers.get('content-type') || '';

      if (response.ok && ct.startsWith('image/')) {
        res.setHeader('Content-Type', ct);
        res.setHeader('Cache-Control', 'public, max-age=86400, stale-while-revalidate=3600');
        res.setHeader('Access-Control-Allow-Origin', '*');
        const buffer = Buffer.from(await response.arrayBuffer());
        return res.status(200).send(buffer);
      }
    } catch (_) {
      // tenta próximo candidate
    }
  }

  // Todos falharam — retorna placeholder SVG transparente
  res.setHeader('Content-Type', 'image/svg+xml');
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).send(
    `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80" viewBox="0 0 120 80">` +
    `<rect width="120" height="80" fill="#1e1a2e"/>` +
    `<text x="60" y="46" text-anchor="middle" font-size="28" fill="#3a3558">&#x1F4FA;</text>` +
    `</svg>`
  );
}
