// api/manga.js — MangaDex proxy
// Uses URLSearchParams to cleanly forward bracket-notation params
// (includes[], order[chapter], etc.) that browsers encode as %5B%5D.
// MangaDex's PHP backend decodes %5B/%5D back to [] automatically.
const https = require('https');

module.exports = function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS') { res.statusCode = 200; res.end(); return; }

  // Parse query string with URLSearchParams for correct bracket handling
  const qs     = req.url.includes('?') ? req.url.split('?')[1] : '';
  const params = new URLSearchParams(qs);
  const mdxPath = params.get('path');

  if (!mdxPath || !mdxPath.startsWith('/')) {
    res.statusCode = 400;
    res.end(JSON.stringify({ error: 'Missing or invalid path' }));
    return;
  }

  // Only allow manga-related paths
  const ALLOWED = ['/manga', '/at-home/server/'];
  if (!ALLOWED.some(p => mdxPath.startsWith(p))) {
    res.statusCode = 403;
    res.end(JSON.stringify({ error: 'Path not allowed' }));
    return;
  }

  // Forward everything except our 'path' param
  params.delete('path');
  const fwdQuery = params.toString(); // correctly encoded for MangaDex
  const mdxFullPath = mdxPath + (fwdQuery ? '?' + fwdQuery : '');

  return new Promise((resolve) => {
    const options = {
      hostname: 'api.mangadex.org',
      path:     mdxFullPath,
      method:   'GET',
      headers:  {
        'Accept':     'application/json',
        'User-Agent': 'JustStreamAnime/1.0 (jsanime.site)',
      },
      timeout: 12000,
    };

    const proxyReq = https.request(options, (upstream) => {
      res.statusCode = upstream.statusCode || 502;
      res.setHeader('Content-Type',  'application/json');
      res.setHeader('Cache-Control', 'public, max-age=300, stale-while-revalidate=600');
      const chunks = [];
      upstream.on('data',  c => chunks.push(c));
      upstream.on('end',   ()  => { res.end(Buffer.concat(chunks)); resolve(); });
      upstream.on('error', ()  => { res.statusCode = 502; res.end('{}'); resolve(); });
    });

    proxyReq.on('timeout', () => { proxyReq.destroy(); res.statusCode = 504; res.end('{}'); resolve(); });
    proxyReq.on('error',   (e) => { res.statusCode = 500; res.end(JSON.stringify({error:e.message})); resolve(); });
    proxyReq.end();
  });
};
