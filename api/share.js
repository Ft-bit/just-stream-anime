// api/share.js — JustStreamAnime universal share handler
// Supports both anime (?a=anilistId) and manga (?m=mangaDexId)
// Serves OG HTML to everyone — bots read meta tags, users get JS redirect

const SITE_URL     = 'https://jsanime.site';
const FALLBACK_IMG = 'https://jsanime.site/og-image.jpg';

const ANIME_QUERY = `query($id:Int){Media(id:$id,type:ANIME){
  id title{english romaji} description(asHtml:false)
  coverImage{extraLarge large} bannerImage averageScore
  episodes status nextAiringEpisode{episode} seasonYear season format genres
}}`;

function esc(s) {
  if (!s) return '';
  return String(s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function cleanDesc(raw) {
  return (raw || '')
    .replace(/<[^>]+>/g, '')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/read (more|this|it)?\s*(at|on|here)?\s*mangadex[^\n]*/gi, '')
    .replace(/\(source:[^)]*\)/gi, '')
    .replace(/\[written by[^\]]*\]/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, 250);
}

// ── Fetch helpers ─────────────────────────────────────────────────────────────
async function fetchAnime(id) {
  try {
    const r = await fetch('https://graphql.anilist.co', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body:    JSON.stringify({ query: ANIME_QUERY, variables: { id } }),
    });
    const json = await r.json();
    return json?.data?.Media || null;
  } catch { return null; }
}

async function fetchManga(id) {
  const https = require('https');
  return new Promise((resolve) => {
    const opts = {
      hostname: 'api.mangadex.org',
      path:     `/manga/${encodeURIComponent(id)}?includes[]=cover_art&includes[]=author`,
      method:   'GET',
      headers:  { 'Accept': 'application/json', 'User-Agent': 'JustStreamAnime/1.0' },
      timeout:  10000,
    };
    const req = https.request(opts, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString())?.data || null); }
        catch { resolve(null); }
      });
      res.on('error', () => resolve(null));
    });
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.on('error',   () => resolve(null));
    req.end();
  });
}

function getMangaCover(m, size = 512) {
  const rel = (m?.relationships || []).find(r => r.type === 'cover_art');
  const fn  = rel?.attributes?.fileName;
  return fn ? `https://uploads.mangadex.org/covers/${m.id}/${fn}.${size}.jpg` : FALLBACK_IMG;
}

function makeSlug(title) {
  return (title || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

// ── HTML builder ──────────────────────────────────────────────────────────────
function buildHtml({ title, desc, image, metaParts, watchUrl, shareUrl, imgW = '460', imgH = '650' }) {
  const cardDesc = metaParts ? `${metaParts}\n\n${desc}` : desc;
  return `<!DOCTYPE html>
<html lang="en" prefix="og: https://ogp.me/ns#">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>${esc(title)} — JustStreamAnime</title>
  <meta name="description" content="${esc(cardDesc.slice(0,200))}"/>

  <meta property="og:type"             content="website"/>
  <meta property="og:site_name"        content="JustStreamAnime"/>
  <meta property="og:url"              content="${esc(shareUrl)}"/>
  <meta property="og:title"            content="${esc(title)} — JustStreamAnime"/>
  <meta property="og:description"      content="${esc(cardDesc.slice(0,200))}"/>
  <meta property="og:image"            content="${esc(image)}"/>
  <meta property="og:image:secure_url" content="${esc(image)}"/>
  <meta property="og:image:type"       content="image/jpeg"/>
  <meta property="og:image:width"      content="${imgW}"/>
  <meta property="og:image:height"     content="${imgH}"/>
  <meta property="og:image:alt"        content="${esc(title)} cover"/>
  <meta property="og:locale"           content="en_US"/>

  <meta name="twitter:card"        content="summary_large_image"/>
  <meta name="twitter:site"        content="@juststreamanime"/>
  <meta name="twitter:title"       content="${esc(title)} — JustStreamAnime"/>
  <meta name="twitter:description" content="${esc(cardDesc.slice(0,200))}"/>
  <meta name="twitter:image"       content="${esc(image)}"/>
  <meta name="twitter:image:alt"   content="${esc(title)} cover"/>

  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{background:#07070e;color:#e4e4f0;font-family:system-ui,sans-serif;
      min-height:100vh;display:flex;align-items:center;justify-content:center;padding:1rem}
    .card{max-width:340px;width:100%;text-align:center}
    img{width:130px;border-radius:12px;box-shadow:0 8px 32px rgba(0,0,0,.7);
      margin:0 auto 1.1rem;display:block;object-fit:cover}
    h1{font-size:1.15rem;font-weight:800;letter-spacing:-.02em;margin-bottom:.35rem;line-height:1.25}
    p{font-size:.78rem;color:#8888a6;margin-bottom:1.3rem;line-height:1.5}
    a{display:inline-flex;align-items:center;gap:.4rem;padding:.65rem 1.6rem;
      background:#e11d48;color:#fff;border-radius:9px;text-decoration:none;
      font-weight:700;font-size:.9rem;box-shadow:0 4px 18px rgba(225,29,72,.35)}
  </style>
</head>
<body>
  <div class="card">
    <img src="${esc(image)}" alt="${esc(title)}"/>
    <h1>${esc(title)}</h1>
    <p>${esc(metaParts)}</p>
    <a href="${esc(watchUrl)}">▶ Open on JustStreamAnime</a>
  </div>
  <script>window.location.replace(${JSON.stringify(watchUrl)});</script>
</body>
</html>`;
}

// ── Main handler ──────────────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=7200');
  res.setHeader('Content-Type',  'text/html; charset=utf-8');

  const animeId = parseInt(req.query.a || '0');
  const mangaId = req.query.m || '';

  // ── MANGA share ─────────────────────────────────────────────────────────────
  if (mangaId) {
    const slug     = makeSlug(mangaId);
    const watchUrl = `${SITE_URL}/manga/${mangaId}`;
    const shareUrl = `${SITE_URL}/share?m=${encodeURIComponent(mangaId)}`;

    const m = await fetchManga(mangaId);
    if (!m) {
      res.writeHead(302, { Location: watchUrl });
      return res.end();
    }

    const attr   = m.attributes || {};
    const title  = attr.title?.en || Object.values(attr.title || {})[0] || 'Manga';
    const desc   = cleanDesc(attr.description?.en || Object.values(attr.description || {})[0] || '');
    const cover  = getMangaCover(m);
    const author = (m.relationships || []).find(r => r.type === 'author')?.attributes?.name || '';
    const status = attr.status ? attr.status.charAt(0).toUpperCase() + attr.status.slice(1) : '';
    const lastCh = attr.lastChapter || '';
    const genres = (attr.tags || [])
      .filter(t => t.attributes?.group === 'genre')
      .map(t => t.attributes?.name?.en || '').filter(Boolean).slice(0, 3).join(', ');

    const metaParts = [
      author ? `By ${author}` : '',
      status,
      lastCh ? `${lastCh} Chapters` : '',
      genres,
    ].filter(Boolean).join(' · ');

    return res.end(buildHtml({
      title: `${title} – Read Free`,
      desc, image: cover, metaParts,
      watchUrl: `${SITE_URL}/manga/${mangaId}/${makeSlug(title)}`,
      shareUrl, imgW: '512', imgH: '728',
    }));
  }

  // ── ANIME share ─────────────────────────────────────────────────────────────
  if (!animeId) {
    res.writeHead(302, { Location: SITE_URL });
    return res.end();
  }

  const watchUrl = `${SITE_URL}/anime/${animeId}`;
  const shareUrl = `${SITE_URL}/share?a=${animeId}`;

  const anime = await fetchAnime(animeId);

  const title  = anime ? (anime.title?.english || anime.title?.romaji || 'Anime') : 'Watch Anime Free';
  const desc   = cleanDesc(anime?.description || '');
  const image  = anime?.coverImage?.extraLarge || anime?.coverImage?.large || FALLBACK_IMG;
  const season = anime?.season
    ? anime.season.charAt(0) + anime.season.slice(1).toLowerCase() + ' ' + anime.seasonYear
    : (anime?.seasonYear ? String(anime.seasonYear) : '');
  const eps    = anime?.nextAiringEpisode
    ? anime.nextAiringEpisode.episode - 1
    : (anime?.episodes || null);

  const metaParts = [
    season,
    anime?.format,
    eps ? `${eps} Episodes` : null,
    anime?.averageScore ? `⭐ ${anime.averageScore}%` : null,
    (anime?.genres || []).slice(0, 3).join(', '),
  ].filter(Boolean).join(' · ');

  return res.end(buildHtml({
    title: `${title} – Watch Free`,
    desc, image, metaParts, watchUrl, shareUrl,
  }));
};
