const https = require('https');
const http  = require('http');
const { URL } = require('url');

const ALLOWED = [
  'uwucdn.top','owocdn.top','vault-','kwik','pahe','animepahe',
  'megaplay','vidnest','akamaized.net','cloudfront.net',
  '.m3u8','.ts','.mp4','.m4s'
];

module.exports = function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS') { res.statusCode = 200; res.end(); return; }

  const qs  = require('url').parse(req.url, true).query;
  const url = qs.url || '';
  const ref = qs.referer || 'https://kwik.si/';

  if (!url) { res.statusCode = 400; res.end('url required'); return; }
  if (!ALLOWED.some(s => url.includes(s))) {
    res.statusCode = 403; res.end('domain not allowed'); return;
  }

  let origin = 'https://kwik.si';
  try { origin = new URL(ref).origin; } catch (_) {}

  let parsedUrl;
  try { parsedUrl = new URL(url); } catch (_) {
    res.statusCode = 400; res.end('invalid url'); return;
  }

  const lib = parsedUrl.protocol === 'https:' ? https : http;
  const options = {
    hostname: parsedUrl.hostname,
    port:     parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
    path:     parsedUrl.pathname + (parsedUrl.search || ''),
    method:   'GET',
    headers: {
      'Referer':    ref,
      'Origin':     origin,
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36',
      'Accept':     '*/*',
    },
  };

  const proxyReq = lib.request(options, (upstream) => {
    if (upstream.statusCode !== 200) {
      res.statusCode = upstream.statusCode;
      res.end('Upstream ' + upstream.statusCode);
      return;
    }
    res.setHeader('Content-Type',  upstream.headers['content-type'] || 'application/octet-stream');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    const chunks = [];
    upstream.on('data',  chunk => chunks.push(chunk));
    upstream.on('end',   ()    => {
      const buf = Buffer.concat(chunks);
      res.setHeader('Content-Length', buf.length);
      res.end(buf);
    });
    upstream.on('error', err  => { res.statusCode = 502; res.end(err.message); });
  });

  proxyReq.on('error', err => { res.statusCode = 500; res.end('Proxy error: ' + err.message); });
  proxyReq.end();
};
