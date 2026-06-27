// api/manga.js
// Proxy for MangaDex API — avoids browser CORS issues when calling
// api.mangadex.org directly from the client side.
// Usage: /api/manga?path=/manga&limit=24&order[followedCount]=desc&...
//        /api/manga?path=/manga/ID/feed&translatedLanguage[]=en&...
//        /api/manga?path=/at-home/server/CHAPTER_ID

const https = require('https');
const { URL } = require('url');

const ALLOWED_PATHS = [
  '/manga',
  '/manga/',
  '/at-home/server/',
];

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS') { res.statusCode = 200; res.end(); return; }

  // Extract `path` param then forward everything else as-is to MangaDex
  const parsed = require('url').parse(req.url, true);
  const mdxPath = parsed.query.path;

  if (!mdxPath) {
    res.statusCode = 400;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'Missing path param' }));
    return;
  }

  // Safety check — only proxy MangaDex manga / chapter endpoints
  const allowed = ALLOWED_PATHS.some(p => mdxPath.startsWith(p));
  if (!allowed) {
    res.statusCode = 403;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'Path not allowed' }));
    return;
  }

  // Rebuild query string without our `path` param
  const fwdParams = Object.entries(parsed.query)
    .filter(([k]) => k !== 'path')
    .map(([k, v]) => Array.isArray(v)
      ? v.map(i => `${k}=${encodeURIComponent(i)}`).join('&')
      : `${k}=${encodeURIComponent(v)}`)
    .join('&');

  const targetUrl = `https://api.mangadex.org${mdxPath}${fwdParams ? '?' + fwdParams : ''}`;

  return new Promise((resolve) => {
    const options = {
      hostname: 'api.mangadex.org',
      path: mdxPath + (fwdParams ? '?' + fwdParams : ''),
      method: 'GET',
      headers: {
        'Accept':     'application/json',
        'User-Agent': 'JustStreamAnime/1.0 (https://jsanime.site)',
      },
      timeout: 10000,
    };

    const proxyReq = https.request(options, (upstream) => {
      res.statusCode = upstream.statusCode || 502;
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Cache-Control', 'public, max-age=300, stale-while-revalidate=600');

      const chunks = [];
      upstream.on('data', chunk => chunks.push(chunk));
      upstream.on('end', () => {
        res.end(Buffer.concat(chunks));
        resolve();
      });
      upstream.on('error', () => {
        res.statusCode = 502;
        res.end(JSON.stringify({ error: 'Upstream error' }));
        resolve();
      });
    });

    proxyReq.on('timeout', () => {
      proxyReq.destroy();
      res.statusCode = 504;
      res.end(JSON.stringify({ error: 'Timeout' }));
      resolve();
    });
    proxyReq.on('error', (err) => {
      res.statusCode = 500;
      res.end(JSON.stringify({ error: err.message }));
      resolve();
    });
    proxyReq.end();
  });
};
