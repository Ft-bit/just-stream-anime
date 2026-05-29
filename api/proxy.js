// api/proxy.js — CORS proxy for HLS segments and m3u8 playlists
// Used by client-side downloader when CDN blocks direct browser fetch

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const { url } = req.query;
  if (!url) return res.status(400).send('url required');

  // Only allow CDN / media URLs — block arbitrary URL access
  const allowed = [
    'akamaized.net', 'cloudfront.net', 'fastly.net', 'cdnfile',
    'kwik', 'pahe', 'animepahe', 'megaplay', 'vidnest',
    '.m3u8', '.ts', '.mp4', '.m4s',
  ];
  const isAllowed = allowed.some(s => url.includes(s));
  if (!isAllowed) return res.status(403).send('URL not allowed');

  try {
    const r = await fetch(url, {
      headers: {
        'Referer':    'https://jsanime.site/',
        'Origin':     'https://jsanime.site',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      }
    });

    if (!r.ok) return res.status(r.status).send(`Upstream error: ${r.status}`);

    const ct = r.headers.get('content-type') || 'application/octet-stream';
    res.setHeader('Content-Type', ct);
    res.setHeader('Cache-Control', 'no-store');

    const buf = await r.arrayBuffer();
    res.send(Buffer.from(buf));
  } catch (err) {
    res.status(500).send(`Proxy error: ${err.message}`);
  }
}
