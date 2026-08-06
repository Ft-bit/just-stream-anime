// api/download.js
// Gets direct anime episode download links via Consumet/GoGoAnime API
// Falls back to external download site links if API unavailable
const https = require('https');

function httpsGet(url) {
  return new Promise((resolve) => {
    const req = https.get(url, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
      timeout: 8000,
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ ok: res.statusCode < 400, data: JSON.parse(data), status: res.statusCode }); }
        catch { resolve({ ok: false, data: null, status: res.statusCode }); }
      });
    });
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, data: null }); });
    req.on('error', () => resolve({ ok: false, data: null }));
  });
}

// Convert anime title + episode to GoGoAnime episode ID
// e.g. "Solo Leveling", 5 → "solo-leveling-episode-5"
function makeGogoId(title, ep, isDub = false) {
  const slug = title.toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return isDub ? `${slug}-dub-episode-${ep}` : `${slug}-episode-${ep}`;
}

// Try multiple Consumet public instances
const CONSUMET_INSTANCES = [
  'https://api.consumet.org',
  'https://consumet.amanoteam.com',
  'https://consumet-api-pied.vercel.app',
];

async function getDownloadLinks(gogoId) {
  for (const base of CONSUMET_INSTANCES) {
    const url = `${base}/anime/gogoanime/watch/${encodeURIComponent(gogoId)}`;
    const res = await httpsGet(url);
    if (res.ok && res.data?.sources) {
      return res.data;
    }
  }
  return null;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS') { res.statusCode = 200; res.end(); return; }
  res.setHeader('Content-Type', 'application/json');

  const qs    = new URLSearchParams(req.url.includes('?') ? req.url.split('?')[1] : '');
  const title  = qs.get('title') || '';
  const ep     = qs.get('ep')    || '1';
  const malId  = qs.get('malId') || '';
  const isDub  = qs.get('dub') === 'true';

  if (!title) {
    res.statusCode = 400;
    res.end(JSON.stringify({ error: 'title required' }));
    return;
  }

  // ── Try GoGoAnime via Consumet ────────────────────────────────────────────
  const gogoId = makeGogoId(title, ep, isDub);
  const data   = await getDownloadLinks(gogoId);

  // External fallback links (always included)
  const titleSlug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const externals = [
    {
      name:  'GoGoAnime',
      url:   `https://anitaku.pe/${titleSlug}-episode-${ep}`,
      icon:  '🎬',
    },
    {
      name:  'AnimePahe',
      url:   `https://animepahe.ru/anime/${titleSlug}`,
      icon:  '📺',
    },
    {
      name:  'AnimeOut',
      url:   `https://www.animeout.xyz/?s=${encodeURIComponent(title)}`,
      icon:  '⬇️',
    },
  ];

  if (!data?.sources) {
    // API failed — return external links only
    res.statusCode = 200;
    res.end(JSON.stringify({
      found: false,
      gogoId,
      externals,
    }));
    return;
  }

  // ── Parse download links by quality ──────────────────────────────────────
  const downloads = [];

  // Consumet returns sources array with quality labels
  for (const src of (data.sources || [])) {
    if (src.url && src.quality) {
      downloads.push({
        quality: src.quality,
        url:     src.url,
        isM3U8:  src.isM3U8 || src.url.includes('.m3u8'),
      });
    }
  }

  // Also check download property if present
  if (data.download) {
    downloads.push({ quality: 'Direct', url: data.download, isM3U8: false });
  }

  // Sort by quality descending: 1080p, 720p, 480p, 360p
  const ORDER = ['1080p', '720p', '480p', '360p', 'default', 'backup'];
  downloads.sort((a, b) => {
    const ai = ORDER.indexOf(a.quality);
    const bi = ORDER.indexOf(b.quality);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });

  res.statusCode = 200;
  res.end(JSON.stringify({
    found:     downloads.length > 0,
    gogoId,
    title,
    episode:   ep,
    downloads,
    externals,
  }));
};
