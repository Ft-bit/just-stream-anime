// api/proxy.js — Referer proxy for HLS streaming segments
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const { url, referer } = req.query;
  if (!url) return res.status(400).send('url required');

  const ALLOWED = [
    'uwucdn.top','owocdn.top','vault-','kwik','pahe','animepahe',
    'megaplay','vidnest','akamaized.net','cloudfront.net',
    '.m3u8','.ts','.mp4','.m4s'
  ];
  if (!ALLOWED.some(s => url.includes(s)))
    return res.status(403).send('domain not allowed');

  const ref    = referer || 'https://kwik.si/';
  let   origin = 'https://kwik.si';
  try { origin = new URL(ref).origin; } catch (_) {}

  try {
    const r = await fetch(url, {
      headers: {
        'Referer':    ref,
        'Origin':     origin,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36',
        'Accept':     '*/*',
      }
    });
    if (!r.ok) return res.status(r.status).send(`Upstream error ${r.status}`);
    res.setHeader('Content-Type',  r.headers.get('content-type') || 'application/octet-stream');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    const buf = Buffer.from(await r.arrayBuffer());
    res.setHeader('Content-Length', buf.length);
    res.end(buf);
  } catch (e) {
    res.status(500).send(`Proxy error: ${e.message}`);
  }
};
