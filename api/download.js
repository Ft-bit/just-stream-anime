// api/download.js
const ANILIST  = 'https://graphql.anilist.co';
const PAHE_API = 'https://animepahe-api-liard.vercel.app';

const PAHE_HEADERS = {
  'Origin':  'https://jsanime.site',
  'Referer': 'https://jsanime.site/',
  'Accept':  'application/json',
};
const BROWSER_HEADERS = {
  'Referer':    'https://jsanime.site/',
  'Origin':     'https://jsanime.site',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept':     'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
};

async function getTitle(aniId) {
  try {
    const r = await fetch(ANILIST, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query:     'query($id:Int){Media(id:$id,type:ANIME){title{english romaji}}}',
        variables: { id: parseInt(aniId) },
      }),
    });
    const d = await r.json();
    return d.data?.Media?.title?.english || d.data?.Media?.title?.romaji || null;
  } catch { return null; }
}

async function resolveViaScraper(title, epNum) {
  try {
    // 1. Search
    const sR = await fetch(`${PAHE_API}/search?q=${encodeURIComponent(title)}`, { headers: PAHE_HEADERS });
    if (!sR.ok) return null;
    const list = await sR.json();
    if (!Array.isArray(list) || !list.length) return null;

    const t     = title.toLowerCase();
    const anime = list.find(a => (a.title || '').toLowerCase().includes(t)) || list[0];

    // 2. Episodes  (API uses `number` not `episode`)
    const eR  = await fetch(`${PAHE_API}/episodes?session=${anime.session || anime.id}`, { headers: PAHE_HEADERS });
    if (!eR.ok) return null;
    const eps = await eR.json();
    if (!Array.isArray(eps) || !eps.length) return null;

    const ep = eps.find(e => Math.round(parseFloat(e.number ?? e.episode ?? 0)) === epNum)
               || eps[epNum - 1];
    if (!ep) return null;

    // 3. Sources
    const srcR = await fetch(
      `${PAHE_API}/sources?anime_session=${anime.session || anime.id}&episode_session=${ep.session || ep.id}`,
      { headers: PAHE_HEADERS }
    );
    if (!srcR.ok) return null;
    const sources = await srcR.json();
    if (!Array.isArray(sources) || !sources.length) return null;

    const best    = sources[sources.length - 1];   // highest quality last
    const kwikUrl = best.url || best.kwik;
    if (!kwikUrl) return null;

    // 4. Resolve kwik → m3u8  (returns { m3u8, referer, proxy_url })
    const mR  = await fetch(`${PAHE_API}/m3u8?url=${encodeURIComponent(kwikUrl)}`, { headers: PAHE_HEADERS });
    if (!mR.ok) return null;
    const mD  = await mR.json();
    const url = mD.m3u8 || mD.url || mD.source || (typeof mD === 'string' ? mD : null);

    return url ? { url, referer: mD.referer || null, quality: best.quality || '720p' } : null;

  } catch (e) {
    console.error('Scraper error:', e.message);
    return null;
  }
}

async function resolveFromVidnest(aniId, epNum, lang) {
  const playerUrl = `https://vidnest.fun/animepahe/${aniId}/${epNum}/${lang}`;
  try {
    const r = await fetch(playerUrl, { headers: BROWSER_HEADERS });
    if (!r.ok) return null;
    const html = await r.text();
    const pats = [
      /["'`]([^"'`\s]*\.m3u8[^"'`\s]*)[`'"]/g,
      /"url"\s*:\s*"([^"]*\.m3u8[^"]*)"/g,
      /(https?:\/\/[^\s"'`<>]+\.m3u8[^\s"'`<>]*)/g,
    ];
    for (const pat of pats) {
      let m;
      while ((m = pat.exec(html)) !== null) {
        let u = m[1];
        if (!u) continue;
        if (u.startsWith('//')) u = 'https:' + u;
        if (u.startsWith('http') && u.includes('m3u8')) return { url: u, referer: null };
      }
    }
  } catch (_) {}
  return null;
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

    // Strategy 1 — full AnimePahe chain
    if (title) {
      const result = await resolveViaScraper(title, epNum);
      if (result?.url) {
        return res.status(200).json({
          success:  true,
          title,
          episode:  epNum,
          quality:  result.quality,
          url:      result.url,
          referer:  result.referer,          // ← CDN needs correct Referer
          filename: `${title.replace(/[^\w\s]/g, '')} EP${String(epNum).padStart(3, '0')}.mp4`,
        });
      }
    }

    // Strategy 2 — scrape vidnest page
    const vr = await resolveFromVidnest(aniId, epNum, L);
    if (vr?.url) {
      return res.status(200).json({
        success:  true,
        title:    title || 'Anime',
        episode:  epNum,
        quality:  'auto',
        url:      vr.url,
        referer:  vr.referer,
        filename: `${(title || 'Anime').replace(/[^\w\s]/g, '')} EP${String(epNum).padStart(3, '0')}.mp4`,
      });
    }

    // Strategy 3 — fallback: let client embed the player
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
}
