// api/download.js
const ANILIST = 'https://graphql.anilist.co';
const PAHE_API = 'https://animepahe-api-liard.vercel.app';

const PAHE_HEADERS = {
  'Origin': 'https://jsanime.site',
  'Referer': 'https://jsanime.site/',
  'Accept': 'application/json',
};

const BROWSER_HEADERS = {
  'Referer': 'https://jsanime.site/',
  'Origin': 'https://jsanime.site',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
};

async function getTitle(aniId) {
  try {
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
  } catch { return null; }
}

async function resolveViaScraper(title, epNum) {
  try {
    // Step 1: Search anime by title
    const searchR = await fetch(
      `${PAHE_API}/search?q=${encodeURIComponent(title)}`,
      { headers: PAHE_HEADERS }
    );
    if (!searchR.ok) return null;
    const list = await searchR.json();
    if (!Array.isArray(list) || !list.length) return null;

    const t = title.toLowerCase();
    const anime = list.find(a => (a.title || '').toLowerCase().includes(t)) || list[0];

    // Step 2: Get episodes
    const epsR = await fetch(
      `${PAHE_API}/episodes?session=${anime.session || anime.id}`,
      { headers: PAHE_HEADERS }
    );
    if (!epsR.ok) return null;
    const epsList = await epsR.json();
    if (!Array.isArray(epsList) || !epsList.length) return null;

    // Pal-droid/AnimepaheApi uses `number` field (not `episode`)
    const episode =
      epsList.find(e => Math.round(parseFloat(e.number ?? e.episode ?? 0)) === epNum)
      || epsList[epNum - 1];
    if (!episode) return null;

    // Step 3: Get sources (kwik URLs)
    const srcR = await fetch(
      `${PAHE_API}/sources?anime_session=${anime.session || anime.id}&episode_session=${episode.session || episode.id}`,
      { headers: PAHE_HEADERS }
    );
    if (!srcR.ok) return null;
    const srcList = await srcR.json();
    if (!Array.isArray(srcList) || !srcList.length) return null;

    // Pick best quality (last in array = highest)
    const best = srcList[srcList.length - 1];
    const kwikUrl = best.url || best.kwik;
    if (!kwikUrl) return null;

    // Step 4: Resolve kwik URL → direct m3u8
    const m3u8R = await fetch(
      `${PAHE_API}/m3u8?url=${encodeURIComponent(kwikUrl)}`,
      { headers: PAHE_HEADERS }
    );
    if (!m3u8R.ok) return null;
    const m3u8D = await m3u8R.json();

    // API returns { m3u8: "...", referer: "..." }
    const url = m3u8D.m3u8 || m3u8D.url || m3u8D.source
      || (typeof m3u8D === 'string' ? m3u8D : null);

    return url ? { url, quality: best.quality || '720p' } : null;

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
    const patterns = [
      /["'`]([^"'`\s]*\.m3u8[^"'`\s]*)[`'"]/g,
      /"url"\s*:\s*"([^"]*\.m3u8[^"]*)"/g,
      /file\s*:\s*["']([^"']+\.m3u8[^"']*)['"]/g,
      /(https?:\/\/[^\s"'`<>]+\.m3u8[^\s"'`<>]*)/g,
    ];
    for (const pattern of patterns) {
      let m;
      while ((m = pattern.exec(html)) !== null) {
        let u = m[1];
        if (!u) continue;
        if (u.startsWith('//')) u = 'https:' + u;
        if (u.startsWith('http') && u.includes('m3u8')) return u;
      }
    }
  } catch (e) {}
  return null;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  const { aniId, ep = '1', lang = 'sub' } = req.query;
  if (!aniId) return res.status(400).json({ error: 'aniId required' });

  const epNum = parseInt(ep) || 1;
  const L = lang === 'dub' ? 'dub' : 'sub';
  const playerUrl = `https://vidnest.fun/animepahe/${aniId}/${epNum}/${L}`;

  try {
    const title = await getTitle(aniId);

    // Strategy 1: Full AnimePahe chain via Pal-droid/AnimepaheApi on Render
    if (title) {
      const result = await resolveViaScraper(title, epNum);
      if (result?.url) {
        return res.status(200).json({
          success: true,
          title,
          episode: epNum,
          quality: result.quality,
          url: result.url,
          filename: `${title.replace(/[^\w\s]/g, '')} EP${String(epNum).padStart(3, '0')}.ts`
        });
      }
    }

    // Strategy 2: Scrape vidnest player page for m3u8
    const vidnestUrl = await resolveFromVidnest(aniId, epNum, L);
    if (vidnestUrl) {
      return res.status(200).json({
        success: true,
        title: title || 'Anime',
        episode: epNum,
        quality: 'auto',
        url: vidnestUrl,
        filename: `${(title || 'Anime').replace(/[^\w\s]/g, '')} EP${String(epNum).padStart(3, '0')}.ts`
      });
    }

    // Strategy 3: Fallback — return player URL for embedded modal
    return res.status(200).json({
      success: false,
      title: title || 'Anime',
      episode: epNum,
      playerUrl,
      useFallback: true,
    });

  } catch (err) {
    console.error('Handler error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
