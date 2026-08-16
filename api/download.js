// api/download.js
// Fetches direct MP4 download links via self-hosted anbuanime API.
// Usage: GET /api/download?title=One+Piece&ep=1000&lang=sub
//
// Requires env var: ANBUANIME_URL (e.g. https://anbuanime-xxxx.onrender.com)
//
// Flow:
//  1. Search anbuanime for the anime title → get animeId
//  2. Get anime details → find episodeId for the requested episode number
//  3. Hit /vidcdn/watch/{episodeId} → returns direct CDN .mp4 links
//  4. Return quality options to the frontend

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { title, ep, lang = 'sub' } = req.query;
  const API = (process.env.ANBUANIME_URL || '').replace(/\/$/, '');

  if (!title || !ep) {
    return res.status(400).json({ error: 'title and ep are required' });
  }
  if (!API) {
    return res.status(500).json({ error: 'ANBUANIME_URL env var not set' });
  }

  try {
    // 1. Search for the anime — append (Dub) for dub requests
    const isDub = lang === 'dub';
    const keyw = isDub ? `${title} (Dub)` : title;
    const sr = await fetch(`${API}/search?keyw=${encodeURIComponent(keyw)}`);
    if (!sr.ok) throw new Error(`Search failed: ${sr.status}`);
    const results = await sr.json();

    if (!Array.isArray(results) || !results.length) {
      return res.status(404).json({ error: 'Anime not found on gogoanime' });
    }

    const match = results[0];

    // 2. Get full episode list for this anime
    const dr = await fetch(`${API}/anime-details/${encodeURIComponent(match.animeId)}`);
    if (!dr.ok) throw new Error(`Details failed: ${dr.status}`);
    const details = await dr.json();

    const epNum = parseInt(ep, 10);
    const episode = (details.episodesList || []).find(
      e => parseInt(e.episodeNum, 10) === epNum
    );

    if (!episode) {
      return res.status(404).json({ error: `Episode ${ep} not found on gogoanime` });
    }

    // 3. Get VIDCDN sources — these are direct .mp4 CDN links, not HLS
    const wr = await fetch(`${API}/vidcdn/watch/${encodeURIComponent(episode.episodeId)}`);
    if (!wr.ok) throw new Error(`Watch failed: ${wr.status}`);
    const watch = await wr.json();

    // Filter to mp4 only, normalize label format (e.g. "360 P" → "360p")
    const sources = (watch.data || [])
      .filter(s => s.type === 'mp4' && s.file)
      .map(s => ({
        quality: s.label.replace(/\s+/g, '').toLowerCase(),
        url: s.file
      }));

    if (!sources.length) {
      return res.status(404).json({ error: 'No direct MP4 links available for this episode' });
    }

    return res.status(200).json({ sources });

  } catch (err) {
    console.error('[api/download]', err.message);
    return res.status(500).json({ error: 'Failed to fetch download links' });
  }
};
