// api/proxy.js — CORS proxy for HLS segments and m3u8 playlists
// Accepts &referer= so CDNs (vault-*.uwucdn.top etc.) get the correct Referer header

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');

  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const { url, referer } = req.query;
  if (!url) return res.status(400).send('URL required');

  const allowed = [
    'akamaized.net', 'cloudfront.net', 'fastly.net', 'cdnfile',
    'kwik', 'pahe', 'animepahe', 'megaplay', 'vidnest',
    'uwucdn', 'vault-',
    '.m3u8', '.ts', '.mp4', '.m4s',
  ];
  if (!allowed.some(s => url.includes(s)))
    return res.status(403).send('URL not allowed');

  // Use the supplied referer so CDN authenticates the request
  const ref = referer || 'https://jsanime.site/';
  let origin = 'https://jsanime.site';
  try { origin = new URL(ref).origin; } catch (_) {}

  try {
    const response = await fetch(url, {
      headers: {
        'Referer':    ref,
        'Origin':     origin,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
    });

    if (!response.ok)
      return res.status(response.status).send(`Upstream error: ${response.status}`);

    res.setHeader('Content-Type',  response.headers.get('content-type') || 'application/octet-stream');
    res.setHeader('Cache-Control', 'public, max-age=3600');

    const reader = response.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(value);
    }
    res.end();

  } catch (err) {
    console.error('Proxy error:', err.message);
    res.status(500).send(`Proxy error: ${err.message}`);
  }
}
