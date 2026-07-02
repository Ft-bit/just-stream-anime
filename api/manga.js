// api/manga.js — Action-based MangaDex proxy (CommonJS)
const https = require('https');

function mdxFetch(path) {
  return new Promise((resolve) => {
    const opts = {
      hostname: 'api.mangadex.org',
      path,
      method:   'GET',
      headers:  { 'Accept': 'application/json', 'User-Agent': 'JustStreamAnime/1.0 (jsanime.site)' },
      timeout:  12000,
    };
    const req = https.request(opts, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end',  ()  => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString())); }
        catch { resolve({}); }
      });
      res.on('error', () => resolve({}));
    });
    req.on('timeout', () => { req.destroy(); resolve({}); });
    req.on('error',   () => resolve({}));
    req.end();
  });
}

function buildCoverUrl(manga) {
  const rel = (manga.relationships||[]).find(r => r.type==='cover_art');
  const fn  = rel?.attributes?.fileName;
  return fn ? `https://uploads.mangadex.org/covers/${manga.id}/${fn}.512.jpg` : null;
}

function formatManga(m) {
  const a = m.attributes || {};
  const title = a.title?.en || Object.values(a.title||{})[0] || 'Unknown';
  // Aggressively strip ALL MangaDex spam from descriptions
  const rawDesc = (a.description?.en || Object.values(a.description||{})[0] || '')
    .replace(/<[^>]+>/g, '')           // strip HTML tags
    .replace(/https?:\/\/\S+/g, '')  // strip all URLs
    .replace(/read (more|this|it|now)?\s*(at|on|here)?\s*mangadex[^\n]*/gi, '')
    .replace(/visit mangadex[^\n]*/gi, '')
    .replace(/available (on|at) mangadex[^\n]*/gi, '')
    .replace(/you can read this[^\n]*/gi, '')
    .replace(/continue reading[^\n]*/gi, '')
    .replace(/\(source:[^)]*\)/gi, '')
    .replace(/source:\s*[^\n]*/gi, '')
    .replace(/note:\s*[^\n]*/gi, '')
    .replace(/^[-—–*=\s]+$/gm, '')    // lines that are only separators
    .replace(/\n{3,}/g, '\n\n')
    .trim().slice(0, 500);
  const author = (m.relationships||[]).find(r=>r.type==='author')?.attributes?.name || '';
  return {
    id: m.id, title, desc: rawDesc, author,
    cover: buildCoverUrl(m),
    status: a.status, year: a.year,
    lastChapter: a.lastChapter, lastVolume: a.lastVolume,
    genres: (a.tags||[]).filter(t=>t.attributes?.group==='genre').map(t=>t.attributes?.name?.en||'').filter(Boolean),
    themes: (a.tags||[]).filter(t=>t.attributes?.group==='theme').map(t=>t.attributes?.name?.en||'').filter(Boolean),
  };
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS') { res.statusCode = 200; res.end(); return; }

  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'public, max-age=300, stale-while-revalidate=600');

  const qs     = new URLSearchParams(req.url.includes('?') ? req.url.split('?')[1] : '');
  const action = qs.get('action') || 'list';
  const id     = qs.get('id') || '';
  const q      = qs.get('q') || '';
  const page   = parseInt(qs.get('page') || '1');
  const sort   = qs.get('sort') || 'followedCount';
  const genre  = qs.get('genre') || '';
  const limit  = 24;
  const offset = (page - 1) * limit;

  try {
    // ── LIST / BROWSE ────────────────────────────────────────────────────────
    if (action === 'list') {
      const p = new URLSearchParams();
      p.append('limit', limit); p.append('offset', offset);
      p.append('includes[]', 'cover_art'); p.append('includes[]', 'author');
      p.append('contentRating[]', 'safe'); p.append('contentRating[]', 'suggestive');
      p.append('availableTranslatedLanguage[]', 'en');
      if (sort === 'followedCount') p.append('order[followedCount]', 'desc');
      else if (sort === 'updatedAt') p.append('order[latestUploadedChapter]', 'desc');
      else if (sort === 'rating')    p.append('order[rating]', 'desc');
      else if (sort === 'createdAt') p.append('order[createdAt]', 'desc');
      if (genre) p.append('includedTags[]', genre);
      if (q)     p.append('title', q);
      const d = await mdxFetch(`/manga?${p.toString()}`);
      res.statusCode = 200;
      res.end(JSON.stringify({ manga: (d.data||[]).map(formatManga), total: d.total||0 }));
      return;
    }

    // ── LATEST UPDATES ───────────────────────────────────────────────────────
    if (action === 'latest') {
      const p = new URLSearchParams();
      p.append('limit', 20); p.append('order[readableAt]', 'desc');
      p.append('translatedLanguage[]', 'en'); p.append('includes[]', 'manga');
      const chData = await mdxFetch(`/chapter?${p.toString()}`);

      const mangaIds = [...new Set((chData.data||[])
        .map(ch => (ch.relationships||[]).find(r=>r.type==='manga')?.id)
        .filter(Boolean))];

      const mp = new URLSearchParams();
      mp.append('limit', 20); mp.append('includes[]', 'cover_art');
      mangaIds.forEach(mid => mp.append('ids[]', mid));
      const mData = await mdxFetch(`/manga?${mp.toString()}`);
      const mMap  = {};
      (mData.data||[]).forEach(m => { mMap[m.id] = formatManga(m); });

      const seen = new Set(), latest = [];
      for (const ch of (chData.data||[])) {
        const mid = (ch.relationships||[]).find(r=>r.type==='manga')?.id;
        if (!mid || seen.has(mid)) continue;
        seen.add(mid);
        const manga = mMap[mid];
        if (manga) latest.push({ ...manga, latestChapter: ch.attributes?.chapter });
      }
      res.statusCode = 200;
      res.end(JSON.stringify({ manga: latest }));
      return;
    }

    // ── CHAPTERS ─────────────────────────────────────────────────────────────
    if (action === 'chapters' && id) {
      const enP = new URLSearchParams();
      enP.append('limit', 500); enP.append('translatedLanguage[]', 'en');
      enP.append('order[chapter]', 'asc'); enP.append('order[volume]', 'asc');
      let d = await mdxFetch(`/manga/${id}/feed?${enP.toString()}`);

      if (!(d.data?.length)) {
        const anyP = new URLSearchParams();
        anyP.append('limit', 500); anyP.append('order[chapter]', 'asc'); anyP.append('order[volume]', 'asc');
        d = await mdxFetch(`/manga/${id}/feed?${anyP.toString()}`);
      }

      const seen = new Map();
      for (const ch of (d.data||[])) {
        const num = ch.attributes?.chapter ?? ch.id;
        if (!seen.has(num)) seen.set(num, ch);
      }
      const chapters = [...seen.values()]
        .sort((a,b) => (parseFloat(a.attributes?.chapter)||0) - (parseFloat(b.attributes?.chapter)||0))
        .map(ch => ({
          id: ch.id,
          chapter:  ch.attributes?.chapter,
          volume:   ch.attributes?.volume,
          title:    ch.attributes?.title,
          language: ch.attributes?.translatedLanguage,
          pages:    ch.attributes?.pages,
          group:    (ch.relationships||[]).find(r=>r.type==='scanlation_group')?.attributes?.name,
        }));

      res.statusCode = 200;
      res.end(JSON.stringify({ chapters, hasEnglish: chapters.some(c=>c.language==='en') }));
      return;
    }

    // ── PAGES (at-home server) ────────────────────────────────────────────────
    if (action === 'pages' && id) {
      const d = await mdxFetch(`/at-home/server/${id}`);
      if (!d?.chapter) { res.statusCode = 404; res.end('{}'); return; }
      const base = d.baseUrl, hash = d.chapter.hash;
      const pages = (d.chapter.data||[]).map(f => `${base}/data/${hash}/${f}`);
      const saver = (d.chapter.dataSaver||[]).map(f => `${base}/data-saver/${hash}/${f}`);
      res.statusCode = 200;
      res.end(JSON.stringify({ pages, dataSaver: saver }));
      return;
    }

    // ── DETAIL ────────────────────────────────────────────────────────────────
    if (action === 'detail' && id) {
      const d = await mdxFetch(`/manga/${id}?includes[]=cover_art&includes[]=author`);
      if (!d?.data) { res.statusCode = 404; res.end('{}'); return; }
      res.statusCode = 200;
      res.end(JSON.stringify(formatManga(d.data)));
      return;
    }

    res.statusCode = 400;
    res.end(JSON.stringify({ error: 'Unknown action' }));

  } catch(err) {
    console.error('manga api error:', err.message);
    res.statusCode = 500;
    res.end(JSON.stringify({ error: err.message }));
  }
};
