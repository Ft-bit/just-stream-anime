// api/download.js
const ANILIST  = 'https://graphql.anilist.co';
const PAHE_API = 'https://animepahe-api-liard.vercel.app';

async function getTitle(aniId) {
  try {
    const r = await fetch(ANILIST, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        query:     'query($id:Int){Media(id:$id,type:ANIME){title{english romaji}}}',
        variables: { id: parseInt(aniId) },
      }),
    });
    const d = await r.json();
    return d.data?.Media?.title?.english || d.data?.Media?.title?.romaji || null;
  } catch (e) {
    console.error('getTitle error:', e.message);
    return null;
  }
}

async function resolveViaScraper(title, epNum) {
  try {
    // 1. Search
    const sR   = await fetch(`${PAHE_API}/search?q=${encodeURIComponent(title)}`);
    if (!sR.ok) { console.error('search failed:', sR.status); return null; }
    const list = await sR.json();
    if (!Array.isArray(list) || !list.length) { console.error('search empty'); return null; }

    const t     = title.toLowerCase();
    const anime = list.find(a => (a.title || '').toLowerCase().includes(t)) || list[0];
    console.log('Found anime:', anime.title, 'session:', anime.session);

    // 2. Episodes — API returns either an array OR { data:[...], total, pages }
    const eR     = await fetch(`${PAHE_API}/episodes?session=${anime.session || anime.id}`);
    if (!eR.ok) { console.error('episodes failed:', eR.status); return null; }
    const epsRaw = await eR.json();
    const eps    = Array.isArray(epsRaw) ? epsRaw : (epsRaw.data || []);
    if (!eps.length) { console.error('no episodes found'); return null; }
    console.log('Total episodes:', eps.length, 'looking for ep', epNum);

    // Match by number field (API uses `number`, not `episode`)
    const ep = eps.find(e => {
      const n = parseFloat(e.number ?? e.episode ?? 0);
      return Math.round(n) === epNum;
    }) || eps[epNum - 1];
    if (!ep) { console.error('episode not found'); return null; }
    console.log('Matched ep session:', ep.session || ep.id);

    // 3. Sources
    const srcR   = await fetch(
      `${PAHE_API}/sources?anime_session=${anime.session || anime.id}&episode_session=${ep.session || ep.id}`
    );
    if (!srcR.ok) { console.error('sources failed:', srcR.status); return null; }
    const sources = await srcR.json();
    const list2   = Array.isArray(sources) ? sources : (sources.data || []);
    if (!list2.length) { console.error('no sources'); return null; }

    const best    = list2[list2.length - 1];   // highest quality last
    const kwikUrl = best.url || best.kwik;
    if (!kwikUrl) { console.error('no kwik url'); return null; }
    console.log('kwik url:', kwikUrl.substring(0, 60));

    // 4. Resolve kwik → m3u8
    const mR  = await fetch(`${PAHE_API}/m3u8?url=${encodeURIComponent(kwikUrl)}`);
    if (!mR.ok) { console.error('m3u8 failed:', mR.status); return null; }
    const mD  = await mR.json();
    const url = mD.m3u8 || mD.url || mD.source || (typeof mD === 'string' ? mD : null);
    if (!url) { console.error('no m3u8 url in response:', JSON.stringify(mD).substring(0, 100)); return null; }

    console.log('Resolved m3u8:', url.substring(0, 60));
    return { url, referer: mD.referer || null, quality: best.quality || '720p' };

  } catch (e) {
    console.error('resolveViaScraper error:', e.message);
    return null;
  }
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  const { aniId, ep = '1', lang = 'sub' } = req.query;
  if (!aniId) return res.status(400).json({ error: 'aniId required' });

  const epNum     = parseInt(ep) || 1;
  const L         = lang === 'dub' ? 'dub' : 'sub';
  const playerUrl = `https://vidnest.fun/animepahe/${aniId}/${epNum}/${L}`;

  try {
    const title = await getTitle(aniId);
    console.log('Title for aniId', aniId, ':', title);

    if (title) {
      const result = await resolveViaScraper(title, epNum);
      if (result?.url) {
        return res.status(200).json({
          success:  true,
          title,
          episode:  epNum,
          quality:  result.quality,
          url:      result.url,
          referer:  result.referer,
          filename: `${title.replace(/[^\w\s]/g, '')} EP${String(epNum).padStart(3, '0')}.mp4`,
        });
      }
    }

    // Fallback: send player URL so user can use built-in download
    console.log('All strategies failed, returning fallback');
    return res.status(200).json({
      success:     false,
      title:       title || 'Anime',
      episode:     epNum,
      playerUrl,
      useFallback: true,
    });

  } catch (err) {
    console.error('Handler error:', err.message);
    return res.status(500).json({ error: err.message });
  }
};
