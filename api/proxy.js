// api/proxy.js — Referer proxy for HLS streaming segments
module.exports = async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  // Don't use wildcard for Allow-Headers — list common headers used by clients
  res.setHeader('Access-Control-Allow-Headers', 'Range, Referer, Origin, Content-Type, Accept, User-Agent');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const url = req.query?.url;
  const referer = req.query?.referer;
  if (!url) return res.status(400).send('url required');

  // Validate URL
  let parsedUrl;
  try { parsedUrl = new URL(url); } catch (e) { return res.status(400).send('invalid url'); }

  const ALLOWED = [
    'uwucdn.top','owocdn.top','vault-','kwik','pahe','animepahe',
    'megaplay','vidnest','akamaized.net','cloudfront.net',
    '.m3u8','.ts','.mp4','.m4s'
  ];
  const low = parsedUrl.href.toLowerCase();
  if (!ALLOWED.some(s => low.includes(s)))
    return res.status(403).send('domain not allowed');

  const ref    = referer || 'https://kwik.si/';
  let   origin = 'https://kwik.si';
  try { origin = new URL(ref).origin; } catch (_) {}

  try {
    const headers = {
      'Referer':    ref,
      'Origin':     origin,
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36',
      'Accept':     '*/*',
    };
    // Forward Range header if client provided (important for HLS/byte ranges)
    if (req.headers && req.headers.range) headers['Range'] = req.headers.range;
    if (req.headers && req.headers.accept) headers['Accept'] = req.headers.accept;

    const r = await fetch(parsedUrl.toString(), {
      headers,
      redirect: 'follow',
    });
    if (!r.ok) return res.status(r.status).send(`Upstream error ${r.status}`);

    // Forward status and important headers
    res.status(r.status);
    const contentType = r.headers.get('content-type');
    if (contentType) res.setHeader('Content-Type', contentType);
    const cache = r.headers.get('cache-control') || 'public, max-age=3600';
    res.setHeader('Cache-Control', cache);

    const contentLength = r.headers.get('content-length');
    if (contentLength) res.setHeader('Content-Length', contentLength);

    // Try to stream when possible to avoid buffering large segments
    // In some environments Response.body is a Node stream with pipe(), in others it's a web ReadableStream
    if (r.body && typeof r.body.pipe === 'function') {
      // Node stream
      r.body.pipe(res);
    } else if (r.body && typeof r.body.getReader === 'function') {
      // Web ReadableStream (fallback) — pipe using reader
      const reader = r.body.getReader();
      const encoder = new TextEncoder();
      async function pump() {
        while (true) {
          const { done, value } = await reader.read();
          if (done) { res.end(); break; }
          res.write(Buffer.from(value));
        }
      }
      pump().catch(err => {
        try { res.end(); } catch (_) {}
      });
    } else {
      // Fallback: buffer the response
      const buf = Buffer.from(await r.arrayBuffer());
      res.setHeader('Content-Length', buf.length);
      res.end(buf);
    }
  } catch (e) {
    res.status(500).send(`Proxy error: ${e.message}`);
  }
};
