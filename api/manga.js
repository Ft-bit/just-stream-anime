// api/manga.js — Fixed version

const BASE = 'https://api.mangadex.org';

function buildCoverUrl(manga) {
  const rel = (manga.relationships || []).find(r => r.type === 'cover_art');
  const fn = rel?.attributes?.fileName;
  return fn ? `https://uploads.mangadex.org/covers/${manga.id}/${fn}.512.jpg` : null;
}

function formatManga(m) {
  const attr = m.attributes || {};
  return {
    id: m.id,
    title: attr.title?.en || Object.values(attr.title || {})[0] || 'Unknown',
    description: (attr.description?.en || Object.values(attr.description || {})[0] || '').slice(0, 400),
    status: attr.status,
    year: attr.year,
    contentRating: attr.contentRating,
    tags: (attr.tags || []).map(t => t.attributes?.name?.en).filter(Boolean),
    coverUrl: buildCoverUrl(m),
    lastVolume: attr.lastVolume,
    lastChapter: attr.lastChapter,
  };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=60');

  const { action, id, q, page = 1, genre, status, sort = 'followedCount' } = req.query;
  const limit = 28;
  const offset = (parseInt(page) - 1) * limit;

  try {
    // ── LIST / BROWSE ────────────────────────────────────────────────────────
    if (action === 'list' || !action) {
      const params = new URLSearchParams({
        limit,
        offset,
        'includes[]': 'cover_art',          // FIX #1: always include cover_art
        'contentRating[]': 'safe',
        'contentRating[]': 'suggestive',
        'order[followedCount]': 'desc',
      });
      if (sort === 'latest')    params.set('order[latestUploadedChapter]', 'desc');
      if (sort === 'rating')    params.set('order[rating]', 'desc');
      if (sort === 'new')       params.set('order[createdAt]', 'desc');
      if (genre)                params.append('includedTags[]', genre);
      if (status)               params.set('status[]', status);
      if (q)                    params.set('title', q);

      const r = await fetch(`${BASE}/manga?${params}`);
      const data = await r.json();
      return res.json({
        manga: (data.data || []).map(formatManga),
        total: data.total || 0,
      });
    }

    // ── LATEST UPDATES ───────────────────────────────────────────────────────
    if (action === 'latest') {
      const params = new URLSearchParams({
        limit: 20,
        'order[readableAt]': 'desc',
        'translatedLanguage[]': 'en',
        'includes[]': 'manga',
      });
      const r = await fetch(`${BASE}/chapter?${params}`);
      const data = await r.json();

      // Collect unique manga IDs and batch-fetch them WITH cover_art
      const mangaIds = [...new Set((data.data || [])
        .map(ch => ch.relationships?.find(r => r.type === 'manga')?.id)
        .filter(Boolean)
      )];

      const mangaParams = new URLSearchParams({ limit: 20, 'includes[]': 'cover_art' });
      mangaIds.forEach(id => mangaParams.append('ids[]', id));
      const mr = await fetch(`${BASE}/manga?${mangaParams}`);
      const md = await mr.json();
      const mangaMap = {};
      (md.data || []).forEach(m => { mangaMap[m.id] = formatManga(m); });

      const seen = new Set();
      const latest = [];
      for (const ch of (data.data || [])) {
        const mangaId = ch.relationships?.find(r => r.type === 'manga')?.id;
        if (!mangaId || seen.has(mangaId)) continue;
        seen.add(mangaId);
        const manga = mangaMap[mangaId];
        if (manga) latest.push({
          ...manga,
          latestChapter: ch.attributes?.chapter,
        });
      }
      return res.json({ manga: latest });
    }

    // ── CHAPTERS FOR A MANGA ─────────────────────────────────────────────────
    if (action === 'chapters' && id) {
      // FIX #2: sort chapters numerically asc
      const enParams = new URLSearchParams({
        limit: 500,
        'translatedLanguage[]': 'en',
        'order[chapter]': 'asc',       // FIX #2: always sort ascending
        'order[volume]': 'asc',
      });
      let r = await fetch(`${BASE}/manga/${id}/feed?${enParams}`);
      let data = await r.json();

      // FIX #3: fallback if no English chapters
      if (!data.data?.length) {
        const anyParams = new URLSearchParams({
          limit: 500,
          'order[chapter]': 'asc',
          'order[volume]': 'asc',
        });
        r = await fetch(`${BASE}/manga/${id}/feed?${anyParams}`);
        data = await r.json();
      }

      // Deduplicate by chapter number (keep first/best group per chapter)
      const seen = new Map();
      for (const ch of (data.data || [])) {
        const num = ch.attributes?.chapter ?? ch.attributes?.volume ?? ch.id;
        if (!seen.has(num)) seen.set(num, ch);
      }

      const chapters = [...seen.values()]
        .sort((a, b) => {
          const na = parseFloat(a.attributes?.chapter) || 0;
          const nb = parseFloat(b.attributes?.chapter) || 0;
          return na - nb;
        })
        .map(ch => ({
          id: ch.id,
          chapter: ch.attributes?.chapter,
          volume: ch.attributes?.volume,
          title: ch.attributes?.title,
          language: ch.attributes?.translatedLanguage,
          publishedAt: ch.attributes?.publishAt,
          externalUrl: ch.attributes?.externalUrl,
        }));

      return res.json({
        chapters,
        totalChapters: data.total || chapters.length,
        hasEnglish: chapters.some(c => c.language === 'en'),
      });
    }

    // ── SINGLE MANGA DETAIL ──────────────────────────────────────────────────
    if (action === 'detail' && id) {
      const r = await fetch(`${BASE}/manga/${id}?includes[]=cover_art&includes[]=author&includes[]=artist`);
      const data = await r.json();
      if (!data.data) return res.status(404).json({ error: 'Not found' });
      return res.json(formatManga(data.data));
    }

    return res.status(400).json({ error: 'Unknown action' });

  } catch (err) {
    console.error('manga api error:', err);
    return res.status(500).json({ error: 'Internal error', message: err.message });
  }
}
