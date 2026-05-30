// api/download.js — Multi-strategy download resolver
// Strategy 1: AnimePahe scraper chain (jsanime-dl.onrender.com)
// Strategy 2: Scrape the vidnest player page directly for the m3u8
// Strategy 3: Return fallback info for client-side embedded-player download

const ANILIST = 'https://graphql.anilist.co';
const PAHE_API = 'https://jsanime-dl.onrender.com';
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
  'Accept-Language': 'en-US,en;q=0.5',
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

// ── Strategy 1: AnimePahe scraper chain ──────────────────────────────────────
async function resolveViaScraper(title, epNum) {
  try {
    const searchR = await fetch(`${PAHE_API}/search?q=${encodeURIComponent(title)}`, { headers: PAHE_HEADERS });
    if (!searchR.ok) return null;
    const searchD = await searchR.json();
    const list = Array.isArray(searchD) ? searchD : (searchD.results || searchD.data || []);
    if (!list.length) return null;
    const t = title.toLowerCase();
    const anime = list.find(a => (a.title || '').toLowerCase().includes(t)) || list[0];

    const epsR = await fetch(`${PAHE_API}/episodes?session=${anime.session || anime.id}`, { headers: PAHE_HEADERS });
    if (!epsR.ok) return null;
    const epsD = await epsR.json();
    const episodes = Array.isArray(epsD) ? epsD : (epsD.data || epsD.episodes || []);
    const episode = episodes.find(e => Math.round(parseFloat(e.episode || 0)) === epNum) || episodes[epNum - 1];
    if (!episode) return null;

    const srcR = await fetch(`${PAHE_API}/sources?anime_session=${anime.session || anime.id}&episode_session=${episode.session || episode.id}`, { headers: PAHE_HEADERS });
    if (!srcR.ok) return null;
    const srcD = await srcR.json();
    const sources = Array.isArray(srcD) ? srcD : (srcD.data || srcD.sources || []);
    if (!sources.length) return null;

    const best = sources[sources.length - 1];
    const kwikUrl = best.kwik || best.url;

    const m3u8R = await fetch(`${PAHE_API}/m3u8?url=${encodeURIComponent(kwikUrl)}`, { headers: PAHE_HEADERS });
    if (!m3u8R.ok) return null;
    const m3u8D = await m3u8R.json();
    const url = m3u8D.url || m3u8D.m3u8 || m3u8D.source || (typeof m3u8D === 'string' ? m3u8D : null);
    return url ? { url, quality: best.quality || '720p' } : null;
  } catch { return null; }
}

// ── Strategy 2: Scrape the vidnest player page for the m3u8 ──────────────────
async function resolveFromVidnest(aniId, epNum, lang) {
  const playerUrl = `https://vidnest.fun/animepahe/${aniId}/${epNum}/${lang}`;
  try {
    const r = await fetch(playerUrl, { headers: BROWSER_HEADERS });
    if (!r.ok) return null;
    const html = await r.text();

    // Patterns that catch m3u8 URLs and common video source patterns
    const patterns = [
      /["'`]([^"'`\s]*\.m3u8[^"'`\s]*)[`'"]/g,
      /"url"\s*:\s*"([^"]*\.m3u8[^"]*)"/g,
      /file\s*:\s*["']([^"']+\.m3u8[^"']*)['"]/g,
      /source\s*:\s*["']([^"']+\.m3u8[^"']*)['"]/g,
      /src\s*:\s*["']([^"']+\.m3u8[^"']*)['"]/g,
      /"(https?:\/\/[^"]+\.m3u8[^"]*)"/g,
      /'(https?:\/\/[^']+\.m3u8[^']*)'/g,
    ];

    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(html)) !== null) {
        let url = match[1];
        if (!url) continue;
        if (url.startsWith('//')) url = 'https:' + url;
        if (url.startsWith('http') && url.includes('m3u8')) return url;
      }
    }

    // Also scan inline <script> blocks for video URLs
    const scriptRe = /<script(?:\s[^>]*)?>([^<]*)<\/script>/gi;
    let scriptMatch;
    while ((scriptMatch = scriptRe.exec(html)) !== null) {
      const js = scriptMatch[1];
      const urlRe = /(https?:\/\/[^\s"'`]+\.m3u8[^\s"'`]*)/g;
      let um;
      while ((um = urlRe.exec(js)) !== null) {
        if (um[1]) return um[1];
      }
    }
  } catch(e) {}
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

    // ── Strategy 1: AnimePahe scraper chain ────────────────────────────────
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

    // ── Strategy 2: Scrape vidnest page ────────────────────────────────────
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

    // ── Strategy 3: Fallback — let client embed the player ─────────────────
    return res.status(200).json({
      success: false,
      title: title || 'Anime',
      episode: epNum,
      playerUrl,             // client embeds this in the modal iframe
      useFallback: true,
    });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
