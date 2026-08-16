// api/download.js — AnimePahe + kwik.si direct MP4 download
// Debug: /api/download?title=X&ep=1&lang=sub&debug=1  → shows each step's raw result

const ANIMEPAHE_API = (process.env.ANIMEPAHE_URL || 'https://animepahe-api-liard.vercel.app').replace(/\/$/, '');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36';

// ── Kwik decryption (ported from anime-dl/anime-downloader kwik.py) ───────────
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
  while (acc > 0) { k = slice2[Math.floor(acc % s2)] + k; acc = Math.floor(acc / s2); }
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
  if (!pageRes.ok) throw new Error(`kwik page status ${pageRes.status}`);
  const html = await pageRes.text();
  const cookies = pageRes.headers.get('set-cookie') || '';

  const m = html.match(/\("(\w+)",\d+,"(\w+)",(\d+),(\d+),\d+\)/);
  if (!m) throw new Error('kwik: obfuscated params pattern not found in page HTML');

  const decrypted = decryptKwik(m[1], m[2], m[3], m[4]);
  const actionM = decrypted.match(/action="([^"]+)"/);
  const tokenM  = decrypted.match(/value="([^"]+)"/);
  if (!actionM || !tokenM) throw new Error('kwik: form action or token not found after decryption');

  const dlRes = await fetch(actionM[1], {
    method: 'POST', redirect: 'manual',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Referer': kwikUrl, 'Cookie': cookies, 'User-Agent': UA
    },
    body: `_token=${encodeURIComponent(tokenM[1])}`
  });

  const location = dlRes.headers.get('location');
  if (!location) throw new Error(`kwik: POST returned ${dlRes.status}, no Location header`);
  return location;
}

// ── Helper: normalise AnimePahe API response to array ─────────────────────────
function toArr(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v;
  if (Array.isArray(v.data)) return v.data;
  if (v.data && typeof v.data === 'object') return Object.values(v.data);
  if (typeof v === 'object') return Object.values(v);
  return [];
}

// ── Main handler ──────────────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { title, ep, lang = 'sub', debug } = req.query;
  if (!title || !ep) return res.status(400).json({ error: 'title and ep required' });

  const log = [];
  const step = (name, data) => { log.push({ step: name, data }); console.log(`[download] ${name}:`, JSON.stringify(data).slice(0, 200)); };

  try {
    const epNum = parseInt(ep, 10);
    const wantDub = lang === 'dub';

    // ── Step 1: Search ────────────────────────────────────────────────────────
    const sr = await fetch(`${ANIMEPAHE_API}/search?q=${encodeURIComponent(title)}`, {
      headers: { 'User-Agent': UA, 'Referer': 'https://animepahe.ru/' }
    });
    const searchRaw = await sr.json();
    const results = toArr(searchRaw);
    step('search', { status: sr.status, count: results.length, first: results[0] });

    if (!results.length) {
      if (debug) return res.json({ log, error: 'search returned no results' });
      return res.status(404).json({ error: 'Anime not found on AnimePahe' });
    }

    const anime = results[0];
    const animeSession = anime.session || anime.id;

    // ── Step 2: Episodes ──────────────────────────────────────────────────────
    const page = Math.ceil(epNum / 30);
    const er = await fetch(`${ANIMEPAHE_API}/episodes?session=${animeSession}&page=${page}`, {
      headers: { 'User-Agent': UA, 'Referer': 'https://animepahe.ru/' }
    });
    const epRaw = await er.json();
    const episodes = toArr(epRaw);
    step('episodes', { status: er.status, page, count: episodes.length, firstEp: episodes[0], lastEp: episodes[episodes.length - 1] });

    const episode = episodes.find(e =>
      parseInt(e.number, 10) === epNum ||
      parseInt(e.episode, 10) === epNum ||
      parseInt(e.ep, 10) === epNum
    );

    if (!episode) {
      if (debug) return res.json({ log, error: `ep ${epNum} not matched in ${episodes.length} results` });
      return res.status(404).json({ error: `Episode ${ep} not found` });
    }

    const epSession = episode.session || episode.id;
    step('episode-match', { episode, epSession });

    // ── Step 3: Sources ───────────────────────────────────────────────────────
    const srcr = await fetch(
      `${ANIMEPAHE_API}/sources?anime_session=${animeSession}&episode_session=${epSession}`, {
      headers: { 'User-Agent': UA, 'Referer': 'https://animepahe.ru/' }
    });
    const srcRaw = await srcr.json();
    const sources = toArr(srcRaw);
    step('sources', { status: srcr.status, count: sources.length, samples: sources.slice(0, 2) });

    if (debug) {
      // In debug mode, stop here and return everything so far
      return res.json({ log, sources_raw: srcRaw });
    }

    const byLang = sources.filter(s => wantDub ? s.audio === 'eng' : s.audio === 'jpn');
    const toProcess = byLang.length ? byLang : sources;
    if (!toProcess.length) return res.status(404).json({ error: 'No sources found' });

    // ── Step 4: Kwik extraction ───────────────────────────────────────────────
    const downloadLinks = [];
    for (const src of toProcess.slice(0, 4)) {
      const kwikUrl = src.url || src.kwik || src.source || src.link;
      const quality = String(src.quality || src.resolution || '?').replace(/p$/, '') + 'p';
      if (!kwikUrl) { step('kwik-skip', { reason: 'no url field', src }); continue; }
      try {
        const mp4 = await getKwikDownloadUrl(kwikUrl);
        downloadLinks.push({ quality, url: mp4 });
        step('kwik-ok', { quality, mp4: mp4.slice(0, 60) + '...' });
      } catch (e) {
        step('kwik-fail', { quality, kwikUrl, error: e.message });
      }
    }

    if (!downloadLinks.length) return res.status(404).json({ error: 'kwik extraction failed' });
    return res.status(200).json({ sources: downloadLinks });

  } catch (err) {
    console.error('[api/download] fatal:', err.message);
    if (debug) return res.json({ log, fatal: err.message });
    return res.status(500).json({ error: err.message });
  }
};
