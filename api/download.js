// api/download.js — JustStreamAnime Download Handler
// Flow: AniList ID → AnimePahe search → episode session → kwik URL → direct video URL

const ANILIST = 'https://graphql.anilist.co';
const PAHE    = 'https://animepahe.ru';

const HEADERS = {
  'Cookie':     'av=0; res=1080',
  'Referer':    'https://animepahe.ru/',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept':     'application/json, text/html, */*',
};

// ── 1. Get anime title from AniList ──────────────────────────────────────────
async function getTitle(aniId) {
  const r = await fetch(ANILIST, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: `query($id:Int){Media(id:$id,type:ANIME){title{english romaji}}}`,
      variables: { id: parseInt(aniId) }
    })
  });
  const d = await r.json();
  return d.data?.Media?.title?.english || d.data?.Media?.title?.romaji || null;
}

// ── 2. Search AnimePahe ───────────────────────────────────────────────────────
async function searchPahe(title) {
  const r = await fetch(`${PAHE}/api?m=search&q=${encodeURIComponent(title)}`, { headers: HEADERS });
  const d = await r.json();
  if (!d.data?.length) return null;
  // Find best match (exact title match preferred)
  const t = title.toLowerCase();
  return d.data.find(a => a.title.toLowerCase().includes(t) || t.includes(a.title.toLowerCase()))
      || d.data[0];
}

// ── 3. Get episode session ────────────────────────────────────────────────────
async function getEpisodeSession(animeSession, epNum) {
  const page = Math.ceil(epNum / 30);
  const r    = await fetch(
    `${PAHE}/api?m=release&id=${animeSession}&sort=episode_asc&page=${page}`,
    { headers: HEADERS }
  );
  const d = await r.json();
  const eps = d.data || [];
  // Find matching episode
  const ep = eps.find(e => Math.round(e.episode) === epNum) || eps[epNum % 30 - 1] || eps[0];
  return ep?.session || null;
}

// ── 4. Get kwik download links ────────────────────────────────────────────────
async function getKwikLinks(animeSession, epSession) {
  const r = await fetch(
    `${PAHE}/api?m=links&id=${animeSession}&ep=${epSession}&p=kwik`,
    { headers: HEADERS }
  );
  return await r.json(); // { data: { "1080": { kwik: "..." }, "720": {...}, ... } }
}

// ── 5. Decode PACKER obfuscation (kwik.cx uses eval-packed JS) ────────────────
function decodePacker(packed) {
  // Extract the payload: eval(function(p,a,c,k,e,d){...}('PAYLOAD','|',COUNT,COUNT,...))
  const match = packed.match(
    /eval\s*\(function\s*\(p,a,c,k,e,[dr]\)\s*\{[\s\S]+?\}\s*\(\s*'([\s\S]+?)'\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*'([\s\S]+?)'\s*\.split/
  );
  if (!match) return null;

  const [, encoded, radixStr,, wordsStr] = match;
  const radix = parseInt(radixStr);
  const words = wordsStr.split('|');

  // Replace each base-radix token with its word
  const decode = (n) => {
    const alpha = '0123456789abcdefghijklmnopqrstuvwxyz';
    let s = '';
    while (n > 0) { s = alpha[n % radix] + s; n = Math.floor(n / radix); }
    return s || '0';
  };

  let result = encoded.replace(/\b(\w+)\b/g, (token) => {
    const idx = parseInt(token, radix);
    return (idx < words.length && words[idx]) ? words[idx] : token;
  });

  return result;
}

// ── 6. Extract direct video URL from kwik page ────────────────────────────────
async function getDirectUrl(kwikUrl) {
  // Must include Referer or kwik returns 403
  const r = await fetch(kwikUrl, {
    headers: {
      ...HEADERS,
      'Referer': 'https://animepahe.ru/',
    },
    redirect: 'follow',
  });

  const html = await r.text();

  // Try direct m3u8 match first
  const m3u8Direct = html.match(/https?:\/\/[^\s"']+\.m3u8[^\s"']*/);
  if (m3u8Direct) return { url: m3u8Direct[0], type: 'm3u8' };

  // Try unpacking PACKER
  const packerMatch = html.match(/eval\s*\(function\s*\(p,a,c,k,e,[dr]\)[\s\S]+?\)\)/);
  if (packerMatch) {
    const unpacked = decodePacker(packerMatch[0]);
    if (unpacked) {
      const m3u8 = unpacked.match(/https?:\/\/[^\s"'\\]+\.m3u8[^\s"'\\]*/);
      if (m3u8) return { url: m3u8[0], type: 'm3u8' };
      const mp4 = unpacked.match(/https?:\/\/[^\s"'\\]+\.mp4[^\s"'\\]*/);
      if (mp4) return { url: mp4[0], type: 'mp4' };
    }
  }

  // Try finding source in script tags
  const srcMatch = html.match(/source\s+src=['"](https?:\/\/[^'"]+)['"]/);
  if (srcMatch) return { url: srcMatch[1], type: 'mp4' };

  return null;
}

// ── Main handler ──────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  const { aniId, ep = '1', quality = 'best' } = req.query;

  if (!aniId) return res.status(400).json({ error: 'aniId is required' });

  try {
    // Step 1: Title from AniList
    const title = await getTitle(aniId);
    if (!title) return res.status(404).json({ error: 'Anime not found on AniList' });

    // Step 2: Search AnimePahe
    const anime = await searchPahe(title);
    if (!anime) return res.status(404).json({ error: 'Anime not found on AnimePahe' });

    // Step 3: Episode session
    const epNum = parseInt(ep) || 1;
    const epSession = await getEpisodeSession(anime.session, epNum);
    if (!epSession) return res.status(404).json({ error: `Episode ${epNum} not found` });

    // Step 4: Kwik links
    const linksData = await getKwikLinks(anime.session, epSession);
    const links = linksData?.data || {};

    if (!Object.keys(links).length) {
      return res.status(404).json({ error: 'No download links available' });
    }

    // Build quality list (highest first)
    const qualityOrder = ['1080', '720', '480', '360'];
    const available = qualityOrder.filter(q => links[q]?.kwik);

    if (!available.length) return res.status(404).json({ error: 'No kwik links found' });

    // Pick quality
    const chosen = (quality !== 'best' && available.includes(quality))
      ? quality
      : available[0];

    const kwikUrl = links[chosen].kwik;

    // Step 5: Get direct URL
    const direct = await getDirectUrl(kwikUrl);

    const filename = `${title.replace(/[^a-zA-Z0-9 ]/g,'')} EP${String(epNum).padStart(3,'0')} ${chosen}p.mp4`;

    return res.status(200).json({
      success: true,
      title,
      episode: epNum,
      quality: chosen,
      availableQualities: available,
      filename,
      // Direct URL if decrypted, kwik URL as fallback
      url:     direct?.url  || null,
      type:    direct?.type || null,
      kwikUrl,             // fallback — always include
      useFallback: !direct?.url,
    });

  } catch (err) {
    console.error('[download]', err.message);
    return res.status(500).json({ error: 'Server error', detail: err.message });
  }
}
