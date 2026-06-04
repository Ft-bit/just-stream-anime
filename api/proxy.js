// api/proxy.js — CORS + Referer proxy for HLS m3u8 and segment files
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');

  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const { url, referer } = req.query;
  if (!url) return res.status(400).send('url param required');

  // Allow CDN domains used by AnimePahe
  const ALLOWED = ['uwucdn.top','owocdn.top','vault-','kwik','pahe','animepahe',
                   'megaplay','vidnest','akamaized.net','cloudfront.net',
                   '.m3u8','.ts','.mp4','.m4s'];
  if (!ALLOWED.some(s => url.includes(s)))
    return res.status(403).send('domain not allowed');

  const ref    = referer || 'https://kwik.si/';
  let   origin = 'https://kwik.si';
  try { origin = new URL(ref).origin; } catch (_) {}

  try {
    const upstream = await fetch(url, {
      headers: {
        'Referer':    ref,
        'Origin':     origin,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept':     '*/*',
      },
    });

    if (!upstream.ok) {
      console.error('Upstream error:', upstream.status, url.substring(0, 80));
      return res.status(upstream.status).send(`Upstream ${upstream.status}`);
    }

    const contentType = upstream.headers.get('content-type') || 'application/octet-stream';
    res.setHeader('Content-Type',  contentType);
    res.setHeader('Cache-Control', 'public, max-age=3600');

    // Buffer the entire response — more reliable than streaming on Vercel
    const arrayBuf = await upstream.arrayBuffer();
    const buf      = Buffer.from(arrayBuf);
    res.setHeader('Content-Length', buf.length);
    res.end(buf);

  } catch (err) {
    console.error('Proxy error:', err.message, 'url:', url.substring(0, 80));
    res.status(500).send(`Proxy error: ${err.message}`);
  }
};
