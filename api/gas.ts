import type { VercelRequest, VercelResponse } from '@vercel/node';

const GAS_URL =
  'https://script.google.com/macros/s/AKfycby7OeFYuai1QoTEXD427-Kn_2KBvh3nakD4iKSuOji9-i3b7sK8DD59BHRBRc5Ow1YB/exec';

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=60');

  try {
    // Chama como JSONP — o GAS sempre responde a isso sem redirecionar
    const url = `${GAS_URL}?callback=__cb`;
    const response = await fetch(url, {
      redirect: 'follow',
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });
    const text = await response.text();

    // Texto: __cb({...})
    const match = text.match(/^__cb\((.+)\)\s*;?\s*$/s);
    if (match) {
      const data = JSON.parse(match[1]);
      return res.status(200).json(data);
    }

    // Tenta JSON puro como fallback
    try {
      return res.status(200).json(JSON.parse(text));
    } catch {
      return res.status(200).json({ status: 'parse_error', raw: text.slice(0, 400) });
    }
  } catch (err: any) {
    return res.status(500).json({ status: 'error', message: String(err) });
  }
}
