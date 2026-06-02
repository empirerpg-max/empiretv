import type { VercelRequest, VercelResponse } from '@vercel/node';

const GAS_URL =
  'https://script.google.com/macros/s/AKfycby7OeFYuai1QoTEXD427-Kn_2KBvh3nakD4iKSuOji9-i3b7sK8DD59BHRBRc5Ow1YB/exec';

async function fetchFollowJson(url: string, depth = 0): Promise<any> {
  if (depth > 5) throw new Error('Too many redirects');

  const res = await fetch(url, {
    redirect: 'manual',
    headers: {
      'Accept': 'application/json, text/javascript, */*',
      'User-Agent': 'Mozilla/5.0 (compatible; EmpireTV/1.0)',
    },
  });

  // Segue redirect manualmente
  if (res.status >= 300 && res.status < 400) {
    const location = res.headers.get('location');
    if (!location) throw new Error('Redirect sem Location header');
    return fetchFollowJson(location, depth + 1);
  }

  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    // GAS às vezes retorna JSONP — tenta extrair o JSON interno
    const match = text.match(/^[^(]+\((.+)\)\s*;?\s*$/);
    if (match) {
      try { return JSON.parse(match[1]); } catch {}
    }
    return { status: 'parse_error', raw: text.slice(0, 300) };
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=60');

  try {
    const data = await fetchFollowJson(GAS_URL);
    res.status(200).json(data);
  } catch (err: any) {
    res.status(500).json({ status: 'error', message: String(err) });
  }
}
