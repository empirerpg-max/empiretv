import type { VercelRequest, VercelResponse } from '@vercel/node';

const GAS_URL =
  'https://script.google.com/macros/s/AKfycby7OeFYuai1QoTEXD427-Kn_2KBvh3nakD4iKSuOji9-i3b7sK8DD59BHRBRc5Ow1YB/exec';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=60');

  try {
    const response = await fetch(GAS_URL, { redirect: 'follow' });
    const text = await response.text();
    let data: any;
    try { data = JSON.parse(text); } catch { data = { status: 'parse_error', raw: text.slice(0, 200) }; }
    res.status(200).json(data);
  } catch (err: any) {
    res.status(500).json({ status: 'error', message: String(err) });
  }
}
