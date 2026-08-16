// api/download.js
// Gets direct MP4 download URLs via AnimePahe + kwik.si token extraction.

const ANIMEPAHE_API = process.env.ANIMEPAHE_URL || 'https://animepahe-api-liard.vercel.app';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36';

// ── Kwik.si decryption ────────────────────────────────────────────────────────
const CHAR_MAP = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ+/';

function getString(content, s1, s2) {
  const slice2 = CHAR_MAP.slice(0, s2);
  let acc = 0;
  const chars = content.split('').reverse();
  for (let n = 0; n < chars.length; n++) {
    const c = chars[n];
    acc += (/\d/.test(c) ? parseInt(c, 10) : 0) * Math.pow(s1, n);
  }
  let k = '';
  while (acc > 0) {
    k = slice2[Math.floor(acc % s2)] + k;
    acc = Math.floor(acc / s2);
  }
  return k || '0';
}

function decryptKwik(fullStr, key, v1, v2) {
  v1 = parseInt(v1, 10); v2 = parseInt(v2, 10);
  let result = '', i = 0;
  while (i < fullStr.length) {
    let s = '';
    while (fullStr[i] !== key[v2]) { s += fullStr[i++]; }
    for (let j = 0; j < key.length; j++) s = s.split(key[j]).join(String(j));
    result += String.fromCharCode(parseInt(getString(s, v2, 10), 10) - v1);
    i++;
  }
  return result;
}

async function getKwikDownloadUrl(kwikUrl) {
  const pageRes = await fetch(kwikUrl, {
    headers: { 'Referer': 'https://animepahe.ru/', 'User-Agent': UA }
  });
  if (!pageRes.ok) throw new Error(`kwik page ${pageRes.status}`);
  const html = await pageRes.text();
  const cookies = pageRes.headers.get('set-cookie') || '';

  const m = html.match(/\("(\w+)",\d+,"(\w+)",(\d+),(\d+),\d+\)/);
  if (!m) throw new Error('kwik: params pattern not found');

  const decrypted = decryptKwik(m[1], m[2], m[3], m[4]);
  const actionM = decrypted.match(/action="([^"]+)"/);
  const tokenM  = decrypted.match(/value="([^"]+)"/);
  if (!actionM || !tokenM) throw new Error('kwik: form not found in decrypted content');

  const dlRes = await fetch(actionM[1], {
    method: 'POST',
    redirect: 'manual',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Referer': kwikUrl,
      'Cookie': cookies,
      'User-Agent': UA
    },
    body: `_token=${encodeURIComponent(tokenM[1])}`
  });

  const location = dlRes.headers.get('location');
  if (!location) throw new Error('kwik: no redirect location');
  return location;
}

// ── Main handler ──────────────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { title, ep, lang = 'sub' } = req.query;
  if (!title || !ep) return res.status(400).json({ error: 'title and ep required' });

  try {
    const epNum = parseInt(ep, 10);
    const wantDub = lang === 'dub';

    // 1. Search
    const sr = await fetch(`${ANIMEPAHE_API}/search?q=${encodeURIComponent(title)}`);
    const searchRaw = await sr.json();
    // Handle both { data: [...] } and [...] response shapes
    const results = searchRaw.data || searchRaw;
    if (!Array.isArray(results) || !results.length) {
      return res.status(404).json({ error: 'Anime not found on AnimePahe' });
    }
    const anime = results[0];
    const animeSession = anime.session || anime.id;
    console.log('[download] anime found:', anime.title, 'session:', animeSession);

    // 2. Episodes — AnimePahe paginates at 30/page
    const page = Math.ceil(epNum / 30);
    const er = await fetch(`${ANIMEPAHE_API}/episodes?session=${animeSession}&page=${page}`);
    const epRaw = await er.json();
    const episodes = epRaw.data || epRaw;
    const epArr = Array.isArray(episodes) ? episodes : Object.values(episodes);
    console.log('[download] episodes on page', page, ':', epArr.length, 'found');

    // Match by number or episode field — APIs use different names
    const episode = epArr.find(e =>
      parseInt(e.number, 10) === epNum ||
      parseInt(e.episode, 10) === epNum ||
      parseInt(e.ep, 10) === epNum
    );
    if (!episode) return res.status(404).json({ error: `Episode ${ep} not found` });
    const epSession = episode.session || episode.id;
    console.log('[download] episode session:', epSession);

    // 3. Sources
    const srcr = await fetch(
      `${ANIMEPAHE_API}/sources?anime_session=${animeSession}&episode_session=${epSession}`
    );
    const srcRaw = await srcr.json();
    // Sources can be { data: [...] } or [...] or { "0": {...}, "1": {...} }
    let sources = [];
    if (Array.isArray(srcRaw.data))       sources = srcRaw.data;
    else if (Array.isArray(srcRaw))       sources = srcRaw;
    else if (srcRaw.data)                 sources = Object.values(srcRaw.data);
    else                                  sources = Object.values(srcRaw);
    console.log('[download] sources raw count:', sources.length, JSON.stringify(sources[0]));

    // Filter by audio language
    const byLang = sources.filter(s => wantDub ? s.audio === 'eng' : s.audio === 'jpn');
    const toProcess = byLang.length ? byLang : sources;

    if (!toProcess.length) return res.status(404).json({ error: 'No sources for this episode' });

    // 4. Extract MP4 download URLs from kwik
    // Field name varies: url, kwik, source, link
    const downloadLinks = [];
    for (const src of toProcess.slice(0, 4)) {
      const kwikUrl = src.url || src.kwik || src.source || src.link;
      const quality  = src.quality || src.resolution || src.fansub || '?';
      if (!kwikUrl) { console.warn('[download] no kwik URL in source:', src); continue; }
      console.log('[download] processing kwik:', kwikUrl);
      try {
        const mp4 = await getKwikDownloadUrl(kwikUrl);
        downloadLinks.push({ quality: quality.toString().replace(/p$/,'') + 'p', url: mp4 });
      } catch (e) {
        console.warn('[download] kwik failed:', e.message);
      }
    }

    if (!downloadLinks.length) {
      return res.status(404).json({ error: 'kwik extraction failed for all qualities' });
    }

    return res.status(200).json({ sources: downloadLinks });

  } catch (err) {
    console.error('[api/download]', err.message);
    return res.status(500).json({ error: err.message });
  }
};
