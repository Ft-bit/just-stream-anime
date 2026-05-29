// api/download.js — Robust AnimePahe Download Handler
// Resolves direct m3u8 links server-side so the client doesn't have to "detect" anything.

const ANILIST = 'https://graphql.anilist.co';
const PAHE_API = 'https://jsanime-dl.onrender.com';

const PAHE_HEADERS = {
  'Origin': 'https://jsanime.site',
  'Referer': 'https://jsanime.site/',
  'Accept': 'application/json',
};

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

async function searchAnime(title) {
  const r = await fetch(`${PAHE_API}/search?q=${encodeURIComponent(title)}`, { headers: PAHE_HEADERS });
  if (!r.ok) return null;
  const d = await r.json();
  const list = Array.isArray(d) ? d : (d.results || d.data || []);
  if (!list.length) return null;
  const t = title.toLowerCase();
  return list.find(a => (a.title || '').toLowerCase().includes(t)) || list[0];
}

async function getEpisodes(session) {
  const r = await fetch(`${PAHE_API}/episodes?session=${session}`, { headers: PAHE_HEADERS });
  if (!r.ok) return [];
  const d = await r.json();
  return Array.isArray(d) ? d : (d.data || d.episodes || []);
}

async function getSources(animeSession, episodeSession) {
  const r = await fetch(`${PAHE_API}/sources?anime_session=${animeSession}&episode_session=${episodeSession}`, { headers: PAHE_HEADERS });
  if (!r.ok) return [];
  const d = await r.json();
  return Array.isArray(d) ? d : (d.data || d.sources || []);
}

async function resolveM3u8(kwikUrl) {
  try {
    const r = await fetch(`${PAHE_API}/m3u8?url=${encodeURIComponent(kwikUrl)}`, { headers: PAHE_HEADERS });
    if (!r.ok) return null;
    const d = await r.json();
    return d.url || d.m3u8 || d.source || (typeof d === 'string' ? d : null);
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  const { aniId, ep = '1' } = req.query;
  if (!aniId) return res.status(400).json({ error: 'aniId required' });

  try {
    const epNum = parseInt(ep) || 1;
    const title = await getTitle(aniId);
    if (!title) return res.status(404).json({ error: 'Anime not found' });

    const anime = await searchAnime(title);
    if (!anime) return res.status(404).json({ error: 'Anime not found on provider' });

    const episodes = await getEpisodes(anime.session || anime.id);
    const episode = episodes.find(e => Math.round(parseFloat(e.episode || 0)) === epNum) || episodes[epNum - 1];
    if (!episode) return res.status(404).json({ error: 'Episode not found' });

    const sources = await getSources(anime.session || anime.id, episode.session || episode.id);
    if (!sources.length) return res.status(404).json({ error: 'No sources found' });

    // Pick best quality (usually last in list)
    const bestSource = sources[sources.length - 1];
    const kwikUrl = bestSource.kwik || bestSource.url;
    
    // CRITICAL: Resolve the direct link here so the frontend doesn't have to "detect" it
    const directUrl = await resolveM3u8(kwikUrl);

    return res.status(200).json({
      success: true,
      title,
      episode: epNum,
      quality: bestSource.quality || '720p',
      url: directUrl,
      filename: `${title.replace(/[^\w\s]/g,'')} EP${String(epNum).padStart(3,'0')}.ts`
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
