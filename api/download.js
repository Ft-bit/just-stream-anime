// api/download.js — server-side AnimePahe resolution
const ANILIST  = 'https://graphql.anilist.co';
const PAHE_API = 'https://animepahe-api-liard.vercel.app';

// Headers that identify us as coming from jsanime.site
const H = {
  'Origin':     'https://jsanime.site',
  'Referer':    'https://jsanime.site/',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36',
  'Accept':     'application/json',
};

async function getTitle(aniId) {
  try {
    const r = await fetch(ANILIST, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: 'query($id:Int){Media(id:$id,type:ANIME){title{english romaji}}}',
        variables: { id: parseInt(aniId) },
      }),
    });
    const d = await r.json();
    return d.data?.Media?.title?.english || d.data?.Media?.title?.romaji || null;
  } catch { return null; }
}

async function resolveM3u8(title, epNum) {
  // 1 — Search
  const sR = await fetch(`${PAHE_API}/search?q=${encodeURIComponent(title)}`, { headers: H });
  if (!sR.ok) throw new Error(`Search ${sR.status}`);
  const list = await sR.json();
  if (!Array.isArray(list) || !list.length) throw new Error('Anime not found');

  const anime = list.find(a => (a.title||'').toLowerCase().includes(title.toLowerCase())) || list[0];
  const animeSession = anime.session || anime.id;

  // 2 — Episodes (API returns array or {data:[...]})
  const eR     = await fetch(`${PAHE_API}/episodes?session=${animeSession}`, { headers: H });
  if (!eR.ok) throw new Error(`Episodes ${eR.status}`);
  const eBody  = await eR.json();
  const eps    = Array.isArray(eBody) ? eBody : (eBody.data || []);
  if (!eps.length) throw new Error('No episodes');

  const ep = eps.find(e => Math.round(parseFloat(e.number ?? e.episode ?? 0)) === epNum)
             || eps[epNum - 1];
  if (!ep) throw new Error(`EP${epNum} not found`);

  // 3 — Sources
  const srcR = await fetch(
    `${PAHE_API}/sources?anime_session=${animeSession}&episode_session=${ep.session||ep.id}`,
    { headers: H }
  );
  if (!srcR.ok) throw new Error(`Sources ${srcR.status}`);
  const srcBody = await srcR.json();
  const sources = Array.isArray(srcBody) ? srcBody : (srcBody.data || []);
  if (!sources.length) throw new Error('No sources');

  const best    = sources[sources.length - 1]; // highest quality last
  const kwikUrl = best.url || best.kwik;
  if (!kwikUrl) throw new Error('No kwik URL');

  // 4 — Resolve kwik → m3u8
  const mR = await fetch(`${PAHE_API}/m3u8?url=${encodeURIComponent(kwikUrl)}`, { headers: H });
  if (!mR.ok) throw new Error(`m3u8 ${mR.status}`);
  const mD = await mR.json();
  const url = mD.m3u8 || mD.url || mD.source;
  if (!url) throw new Error('No m3u8 URL');

  return { url, referer: mD.referer || null, quality: best.quality || '720p' };
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  const { aniId, ep = '1', lang = 'sub' } = req.query;
  if (!aniId) return res.status(400).json({ error: 'aniId required' });

  const epNum     = parseInt(ep) || 1;
  const playerUrl = `https://vidnest.fun/animepahe/${aniId}/${epNum}/${lang === 'dub' ? 'dub' : 'sub'}`;

  try {
    const title = await getTitle(aniId);
    if (!title) throw new Error('Could not get title from AniList');

    const result = await resolveM3u8(title, epNum);
    return res.status(200).json({
      success: true,
      title,
      episode: epNum,
      quality: result.quality,
      url:     result.url,
      referer: result.referer,
    });

  } catch (err) {
    console.error('[download]', err.message);
    // Fallback — client opens the player page
    return res.status(200).json({ success: false, playerUrl });
  }
};
