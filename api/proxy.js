// api/proxy.js
const https = require('https');
const http = require('http');
const { URL } = require('url');

const ALLOWED = [
  'uwucdn.top','owocdn.top','vault-','kwik','pahe','animepahe',
  'megaplay','vidnest','akamaized.net','cloudfront.net',
  '.m3u8','.ts','.mp4','.m4s'
];

module.exports = function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');

  if (req.method === 'OPTIONS') {
    res.statusCode = 200;
    res.end();
    return;
  }

  const qs = require('url').parse(req.url, true).query;
  const target = qs.url || '';
  const ref = qs.referer || 'https://kwik.si/';

  if (!target) {
    res.statusCode = 400;
    res.end('url required');
    return;
  }

  if (!ALLOWED.some(s => target.includes(s))) {
    res.statusCode = 403;
    res.end('domain not allowed');
    return;
  }

  let parsed;
  try {
    parsed = new URL(target);
  } catch (err) {
    res.statusCode = 400;
    res.end('invalid url');
    return;
  }

  const lib = parsed.protocol === 'https:' ? https : http;
  const options = {
    hostname: parsed.hostname,
    port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
    path: parsed.pathname + (parsed.search || ''),
    method: 'GET',
    headers: {
      'Referer': ref,
      'Origin': (() => { try { return new URL(ref).origin } catch { return 'https://kwik.si' } })(),
      'User-Agent': 'Mozilla/5.0 (compatible)',
      'Accept': '*/*'
    },
    timeout: 15000
  };

  const upstreamReq = lib.request(options, upstreamRes => {
    // forward status and headers
    res.statusCode = upstreamRes.statusCode || 502;
    // copy content-type if present
    if (upstreamRes.headers['content-type']) {
      res.setHeader('Content-Type', upstreamRes.headers['content-type']);
    } else {
      res.setHeader('Content-Type', 'application/octet-stream');
    }
    res.setHeader('Cache-Control', 'public, max-age=3600');

    // stream directly to client to avoid buffering large media
    upstreamRes.pipe(res);
    upstreamRes.on('error', err => {
      if (!res.writableEnded) {
        res.statusCode = 502;
        res.end('Upstream error');
      }
    });
  });

  upstreamReq.on('timeout', () => {
    upstreamReq.destroy(new Error('upstream timeout'));
  });

  upstreamReq.on('error', err => {
    if (!res.writableEnded) {
      res.statusCode = 500;
      res.end('Proxy error: ' + (err && err.message ? err.message : 'unknown'));
    }
  });

  upstreamReq.end();
};
