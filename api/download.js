// api/download.js — JustStreamAnime Download Handler
// Extracts m3u8 stream URL from vidnest.fun (AnimePahe source)
// Returns the URL so the client can download segments and merge in-browser

const ANILIST = 'https://graphql.anilist.co';

async function getAnimeTitle(aniId) {
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

// Try to fetch the vidnest.fun embed page and extract the m3u8 URL
async function getM3u8(aniId, ep, lang) {
  const embedUrl = `https://vidnest.fun/animepahe/${aniId}/${ep}/${lang}`;

  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,*/*;q=0.9',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': 'https://jsanime.site/',
    'Origin': 'https://jsanime.site',
    'Cache-Control': 'no-cache',
  };

  const r = await fetch(embedUrl, { headers });
  if (!r.ok) return null;
  const html = await r.text();

  // Pattern 1: direct .m3u8 URL in quotes
  const p1 = html.match(/["'`](https?:\/\/[^"'`\s]+\.m3u8[^"'`\s]*)['"` ]/);
  if (p1) return p1[1];

  // Pattern 2: source: "url" or file: "url"
  const p2 = html.match(/(?:source|file|src)\s*[:=]\s*["'`](https?:\/\/[^"'`\s]+)['"` ]/i);
  if (p2 && (p2[1].includes('m3u8') || p2[1].includes('.ts'))) return p2[1];

  // Pattern 3: hls: or hlsUrl:
  const p3 = html.match(/(?:hls|hlsUrl|streamUrl)\s*[:=]\s*["'`](https?:\/\/[^"'`\s]+)['"` ]/i);
  if (p3) return p3[1];

  // Pattern 4: any kwik or pahe CDN URL
  const p4 = html.match(/https?:\/\/[a-z0-9\-\.]+(?:kwik|pahe|ani|cdn)[a-z0-9\-\.]*\/[^"'\s]+\.m3u8[^"'\s]*/i);
  if (p4) return p4[0];

  return null;
}

// Try megaplay.buzz as secondary source
async function getM3u8FromMegaplay(aniId, ep, lang) {
  const embedUrl = `https://megaplay.buzz/stream/ani/${aniId}/${ep}/${lang}`;
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Referer': 'https://jsanime.site/',
    'Origin': 'https://jsanime.site',
  };
  try {
    const r = await fetch(embedUrl, { headers });
    if (!r.ok) return null;
    const html = await r.text();
    const m = html.match(/["'`](https?:\/\/[^"'`\s]+\.m3u8[^"'`\s]*)['"` ]/);
    return m ? m[1] : null;
  } catch { return null; }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  const { aniId, ep = '1', lang = 'sub' } = req.query;
  if (!aniId) return res.status(400).json({ error: 'aniId required' });

  const epNum = parseInt(ep) || 1;
  const L = lang === 'dub' ? 'dub' : 'sub';

  try {
    // Get title for filename
    const title = await getAnimeTitle(aniId);

    // Try vidnest.fun first (Server 1 — AnimePahe)
    let m3u8Url = await getM3u8(aniId, epNum, L);

    // Try megaplay.buzz as fallback
    if (!m3u8Url) {
      m3u8Url = await getM3u8FromMegaplay(aniId, epNum, L);
    }

    if (m3u8Url) {
      const filename = title
        ? `${title.replace(/[^\w\s]/g,'').trim()} EP${String(epNum).padStart(3,'0')}.ts`
        : `Anime_EP${String(epNum).padStart(3,'0')}.ts`;

      return res.status(200).json({
        success: true,
        url: m3u8Url,
        m3u8Url,
        title: title || 'Anime',
        episode: epNum,
        filename,
        type: 'm3u8',
      });
    }

    // Nothing worked — return vidnest URL as kwik fallback for the UI
    return res.status(200).json({
      success: false,
      kwikUrl: `https://vidnest.fun/animepahe/${aniId}/${epNum}/${L}`,
      title: title || 'Anime',
      episode: epNum,
      useFallback: true,
    });

  } catch (err) {
    console.error('[download]', err.message);
    return res.status(500).json({
      error: 'Server error',
      useFallback: true,
      kwikUrl: `https://vidnest.fun/animepahe/${aniId}/${ep}/${L}`,
    });
  }
}
