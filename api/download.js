// api/download.js
// Gets direct MP4 download URLs via AnimePahe + kwik.si token extraction.
// No npm deps — pure Node.js built-in fetch only.
//
// Flow:
//  1. Search AnimePahe for the anime  → get anime session
//  2. Get episodes (paginated)        → find episode session
//  3. Get sources                     → get kwik.si URLs per quality
//  4. For each kwik URL: decrypt obfuscated JS → POST form → get MP4 redirect
//  5. Return quality options to frontend

const ANIMEPAHE_API = process.env.ANIMEPAHE_URL || 'https://animepahe-api-liard.vercel.app';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36';

// ── Kwik.si decryption (ported from anime-downloader/extractors/kwik.py) ────

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
  v1 = parseInt(v1, 10);
  v2 = parseInt(v2, 10);
  let result = '';
  let i = 0;
  while (i < fullStr.length) {
    let s = '';
    while (fullStr[i] !== key[v2]) { s += fullStr[i++]; }
    for (let j = 0; j < key.length; j++) {
      s = s.split(key[j]).join(String(j));
    }
    result += String.fromCharCode(parseInt(getString(s, v2, 10), 10) - v1);
    i++;
  }
  return result;
}

async function getKwikDownloadUrl(kwikUrl) {
  // Step 1: Fetch the kwik embed page
  const pageRes = await fetch(kwikUrl, {
    headers: { 'Referer': 'https://animepahe.ru/', 'User-Agent': UA }
  });
  if (!pageRes.ok) throw new Error(`kwik page returned ${pageRes.status}`);

  const html = await pageRes.text();
  const cookies = pageRes.headers.get('set-cookie') || '';

  // Step 2: Find the obfuscated JS params
  const m = html.match(/\("(\w+)",\d+,"(\w+)",(\d+),(\d+),\d+\)/);
  if (!m) throw new Error('kwik: obfuscated params not found');

  // Step 3: Decrypt to get the download form HTML
  const decrypted = decryptKwik(m[1], m[2], m[3], m[4]);

  // Step 4: Extract form action URL and CSRF token
  const actionM = decrypted.match(/action="([^"]+)"/);
  const tokenM  = decrypted.match(/value="([^"]+)"/);
  if (!actionM || !tokenM) throw new Error('kwik: download form not found in decrypted content');

  // Step 5: POST to download endpoint — don't follow the redirect
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

  // Step 6: The Location header on the 302/303 is the actual MP4 URL
  const location = dlRes.headers.get('location');
  if (!location) throw new Error('kwik: no redirect location in download response');
  return location;
}

// ── Main handler ─────────────────────────────────────────────────────────────

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { title, ep, lang = 'sub' } = req.query;
  if (!title || !ep) return res.status(400).json({ error: 'title and ep are required' });

  try {
    const epNum = parseInt(ep, 10);
    const wantDub = lang === 'dub';

    // 1. Search AnimePahe for the anime
    const sr = await fetch(`${ANIMEPAHE_API}/search?q=${encodeURIComponent(title)}`);
    if (!sr.ok) throw new Error(`AnimePahe search: ${sr.status}`);
    const search = await sr.json();
    const results = search.data || search;
    if (!Array.isArray(results) || !results.length) {
      return res.status(404).json({ error: 'Anime not found on AnimePahe' });
    }

    const anime = results[0];
    const animeSession = anime.session;

    // 2. Get episodes — AnimePahe paginates at 30 per page
    const page = Math.ceil(epNum / 30);
    const er = await fetch(`${ANIMEPAHE_API}/episodes?session=${animeSession}&page=${page}`);
    if (!er.ok) throw new Error(`AnimePahe episodes: ${er.status}`);
    const epData = await er.json();
    const episodes = epData.data || epData;

    const episode = (Array.isArray(episodes) ? episodes : Object.values(episodes))
      .find(e => parseInt(e.episode, 10) === epNum);
    if (!episode) return res.status(404).json({ error: `Episode ${ep} not found on AnimePahe` });

    // 3. Get sources (kwik URLs per quality)
    const srcr = await fetch(
      `${ANIMEPAHE_API}/sources?anime_session=${animeSession}&episode_session=${episode.session}`
    );
    if (!srcr.ok) throw new Error(`AnimePahe sources: ${srcr.status}`);
    const srcData = await srcr.json();

    // Normalise to array regardless of response shape
    let sources = [];
    if (Array.isArray(srcData.data))         sources = srcData.data;
    else if (srcData.data)                   sources = Object.values(srcData.data);
    else if (Array.isArray(srcData))         sources = srcData;
    else                                     sources = Object.values(srcData);

    // Prefer correct audio language; fall back to all sources
    const byLang = sources.filter(s => wantDub ? s.audio === 'eng' : s.audio === 'jpn');
    const toProcess = byLang.length ? byLang : sources;

    if (!toProcess.length) return res.status(404).json({ error: 'No sources found for this episode' });

    // 4. Extract direct MP4 download URLs from kwik (process up to 4 qualities)
    const downloadLinks = [];
    for (const src of toProcess.slice(0, 4)) {
      if (!src.kwik) continue;
      try {
        const url = await getKwikDownloadUrl(src.kwik);
        downloadLinks.push({
          quality: `${src.resolution || src.quality || '?'}p`,
          url
        });
      } catch (e) {
        console.warn(`[download] kwik failed (${src.resolution}p):`, e.message);
      }
    }

    if (!downloadLinks.length) {
      return res.status(404).json({ error: 'Could not extract download links from kwik' });
    }

    return res.status(200).json({ sources: downloadLinks });

  } catch (err) {
    console.error('[api/download]', err.message);
    return res.status(500).json({ error: 'Failed to fetch download links' });
  }
};
