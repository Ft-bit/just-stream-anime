// api/download.js — JustStreamAnime Download Handler
// Uses: https://jsanime-dl.onrender.com (AnimePahe API on Render)
// Endpoints from github.com/ElijahCodes12345/animepahe-api

const ANILIST    = 'https://graphql.anilist.co';
const PAHE_API   = 'https://jsanime-dl.onrender.com';

// Headers that satisfy the Render API allowlist
const PAHE_HEADERS = {
  'Origin':  'https://jsanime.site',
  'Referer': 'https://jsanime.site/',
  'Accept':  'application/json',
};

// ── Get anime title from AniList ID ──────────────────────────────────────────
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

// ── Search AnimePahe via Render API ──────────────────────────────────────────
async function searchAnime(title) {
  const r = await fetch(`${PAHE_API}/search?q=${encodeURIComponent(title)}`, { headers: PAHE_HEADERS });
  if (!r.ok) throw new Error(`Search failed: ${r.status}`);
  const d = await r.json();
  // d is array of results
  const list = Array.isArray(d) ? d : (d.results || d.data || []);
  if (!list.length) return null;
  const t = title.toLowerCase();
  return list.find(a =>
    (a.title||'').toLowerCase().includes(t) ||
    t.includes((a.title||'').toLowerCase())
  ) || list[0];
}

// ── Get all episodes via Render API ──────────────────────────────────────────
async function getEpisodes(session) {
  const r = await fetch(`${PAHE_API}/episodes?session=${session}`, { headers: PAHE_HEADERS });
  if (!r.ok) throw new Error(`Episodes failed: ${r.status}`);
  const d = await r.json();
  return Array.isArray(d) ? d : (d.data || d.episodes || []);
}

// ── Get sources (kwik links) via Render API ───────────────────────────────────
async function getSources(animeSession, episodeSession) {
  const r = await fetch(
    `${PAHE_API}/sources?anime_session=${animeSession}&episode_session=${episodeSession}`,
    { headers: PAHE_HEADERS }
  );
  if (!r.ok) throw new Error(`Sources failed: ${r.status}`);
  return await r.json();
}

// ── Resolve kwik → direct m3u8 via Render API ────────────────────────────────
async function resolveM3u8(kwikUrl) {
  const r = await fetch(`${PAHE_API}/m3u8?url=${encodeURIComponent(kwikUrl)}`, { headers: PAHE_HEADERS });
  if (!r.ok) throw new Error(`m3u8 resolve failed: ${r.status}`);
  const d = await r.json();
  return d.url || d.m3u8 || d.source || (typeof d === 'string' ? d : null);
}

// ── Main handler ──────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  const { aniId, ep = '1', quality = 'best' } = req.query;
  if (!aniId) return res.status(400).json({ error: 'aniId required' });

  try {
    const epNum = parseInt(ep) || 1;

    // Step 1 — Get title from AniList
    const title = await getTitle(aniId);
    if (!title) return res.status(404).json({ error: 'Anime not found on AniList' });

    // Step 2 — Search AnimePahe
    const anime = await searchAnime(title);
    if (!anime) return res.status(404).json({ error: `"${title}" not found on AnimePahe` });

    const animeSession = anime.session || anime.id;

    // Step 3 — Get episode list
    const episodes = await getEpisodes(animeSession);
    if (!episodes.length) return res.status(404).json({ error: 'No episodes found' });

    // Find the target episode (1-indexed)
    const episode = episodes.find(e =>
      Math.round(parseFloat(e.episode || e.ep || 0)) === epNum
    ) || episodes[epNum - 1] || episodes[0];

    if (!episode) return res.status(404).json({ error: `Episode ${epNum} not found` });

    const epSession = episode.session || episode.id;

    // Step 4 — Get sources (kwik links per quality)
    const sources = await getSources(animeSession, epSession);
    const sourceList = Array.isArray(sources) ? sources : (sources.data || sources.sources || []);

    if (!sourceList.length) return res.status(404).json({ error: 'No sources available' });

    // Build quality map
    const qualityOrder = ['1080', '720', '480', '360'];
    const qualityMap = {};
    for (const s of sourceList) {
      const q = String(s.quality || s.res || s.resolution || '720').replace('p','');
      qualityMap[q] = s.kwik || s.url || s.link || s.hls;
    }

    const available = qualityOrder.filter(q => qualityMap[q]);
    if (!available.length) return res.status(404).json({ error: 'No quality options found' });

    const chosen = (quality !== 'best' && available.includes(quality))
      ? quality : available[0];

    const kwikUrl = qualityMap[chosen];

    // Step 5 — Resolve kwik → direct m3u8
    let directUrl = null;
    let useFallback = false;
    try {
      directUrl = await resolveM3u8(kwikUrl);
    } catch {
      useFallback = true;
    }
    if (!directUrl) useFallback = true;

    const filename = `${title.replace(/[^\w\s]/g,'').trim()} EP${String(epNum).padStart(3,'0')} ${chosen}p.mp4`;

    return res.status(200).json({
      success: true,
      title,
      episode: epNum,
      quality: chosen,
      availableQualities: available,
      filename,
      url:         directUrl,
      kwikUrl,
      useFallback,
      type:        directUrl ? 'm3u8' : null,
    });

  } catch (err) {
    console.error('[download]', err.message);
    return res.status(500).json({ error: 'Server error', detail: err.message });
  }
}
