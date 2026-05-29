// api/proxy.js — Optimized CORS proxy for HLS segments and m3u8 playlists
// Fixes memory issues by streaming the response instead of buffering it.

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  const { url } = req.query;
  if (!url) return res.status(400).send('URL required');

  // Allowed domains and extensions
  const allowed = [
    'akamaized.net', 'cloudfront.net', 'fastly.net', 'cdnfile',
    'kwik', 'pahe', 'animepahe', 'megaplay', 'vidnest',
    '.m3u8', '.ts', '.mp4', '.m4s',
  ];
  
  const isAllowed = allowed.some(s => url.includes(s));
  if (!isAllowed) return res.status(403).send('URL not allowed');

  try {
    const response = await fetch(url, {
      headers: {
        'Referer': 'https://jsanime.site/',
        'Origin': 'https://jsanime.site',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      }
    });

    if (!response.ok) {
      return res.status(response.status).send(`Upstream error: ${response.status}`);
    }

    // Set headers from upstream
    const contentType = response.headers.get('content-type') || 'application/octet-stream';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=3600');
    
    // Use the Web Streams API to pipe the response directly to the client
    // This prevents the "memory limit exceeded" error on Vercel/Node for large files
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
