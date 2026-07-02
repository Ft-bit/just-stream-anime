// api/proxy.js
const https = require('https');
const http  = require('http');
const { URL } = require('url');

const ALLOWED = [
  'uwucdn.top','owocdn.top','vault-','kwik','pahe','animepahe',
  'megaplay','vidnest','akamaized.net','cloudfront.net',
  'uploads.mangadex.org','mangadex.network','mangadex.org',
  '.m3u8','.ts','.mp4','.m4s'
];

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

function fetchFollow(target, ref, res, depth) {
  let parsed;
  try { parsed = new URL(target); }
  catch { res.statusCode = 400; res.end('invalid url'); return; }

  const lib = parsed.protocol === 'https:' ? https : http;
  const isMdx = /mangadex\.org$|mangadex\.network$/.test(parsed.hostname) ||
                parsed.hostname.includes('mangadex');

  const headers = {
    'User-Agent': UA,
    'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
  };
  // MangaDex blocks hotlink referers; send none for its hosts
  if (!isMdx) {
    headers['Referer'] = ref;
    try { headers['Origin'] = new URL(ref).origin; } catch { headers['Origin'] = 'https://kwik.si'; }
  }

  const options = {
    hostname: parsed.hostname,
    port:     parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
    path:     parsed.pathname + (parsed.search || ''),
    method:   'GET',
    headers,
    timeout:  15000,
  };

  const upReq = lib.request(options, upRes => {
    const code = upRes.statusCode || 502;

    // Follow redirects server-side (browser never sees them)
    if ([301,302,303,307,308].includes(code) && upRes.headers.location && depth < 4) {
      upRes.resume();
      let next;
      try { next = new URL(upRes.headers.location, target).toString(); }
      catch { res.statusCode = 502; res.end('bad redirect'); return; }
      fetchFollow(next, ref, res, depth + 1);
      return;
    }

    res.statusCode = code;
    res.setHeader('Content-Type',  upRes.headers['content-type'] || 'application/octet-stream');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    if (upRes.headers['content-length']) res.setHeader('Content-Length', upRes.headers['content-length']);
    upRes.pipe(res);                              // stream directly — no buffering
    upRes.on('error', () => { if (!res.writableEnded) res.end(); });
  });

  upReq.on('timeout', () => upReq.destroy(new Error('timeout')));
  upReq.on('error',   err => { if (!res.writableEnded) { res.statusCode = 500; res.end('Proxy error: ' + err.message); }});
  upReq.end();
}

module.exports = function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS') { res.statusCode = 200; res.end(); return; }

  const qs     = require('url').parse(req.url, true).query;
  const target = qs.url     || '';
  const ref    = qs.referer || 'https://kwik.si/';

  if (!target) { res.statusCode = 400; res.end('url required'); return; }
  if (!ALLOWED.some(s => target.includes(s))) { res.statusCode = 403; res.end('domain not allowed'); return; }

  fetchFollow(target, ref, res, 0);
};
