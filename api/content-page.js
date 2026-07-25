// api/content-page.js — replaces the separate anime-page.js and manga-page.js
// files (merged to save a Vercel Hobby-plan function slot; the cap is 12
// total functions and every consolidation like this buys room for future
// features without needing to pay for Pro).
//
// Server-side meta injection for /anime/:id/:slug AND /manga/:id/:slug.
// Reads index.html from disk, fetches the real title/description/cover from
// AniList (anime) or MangaDex (manga), and injects proper OG/Twitter/JSON-LD
// tags before serving — so Google, Discord, Telegram, X, etc. see the real
// content from the first byte instead of generic homepage text.
//
// Routing (set in vercel.json):
//   /anime/:id/:slug -> /api/content-page?type=anime&id=$1
//   /manga/:id/:slug -> /api/content-page?type=manga&id=$1

const fs    = require('fs');
const path  = require('path');
const https = require('https');

const SITE_URL     = 'https://jsanime.site';
const FALLBACK_IMG = 'https://jsanime.site/og-image.jpg';

function getBaseHtml() {
  try {
    return fs.readFileSync(path.join(process.cwd(), 'index.html'), 'utf8');
  } catch {
    return null;
  }
}

function esc(s) {
  return (s || '').toString()
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function makeSlug(title) {
  return (title || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

// ── ANIME: fetch from AniList ─────────────────────────────────────────────────
async function fetchAnime(id) {
  const query = `query($id:Int){Media(id:$id,type:ANIME){
    id idMal title{romaji english} description(asHtml:false)
    coverImage{extraLarge large} bannerImage episodes genres
    season seasonYear format status averageScore
  }}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    const r = await fetch('https://graphql.anilist.co', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ query, variables: { id: parseInt(id) } }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!r.ok) return null;
    const d = await r.json();
    return d.data?.Media || null;
  } catch {
    clearTimeout(timer);
    return null;
  }
}

function renderAnimeHtml(baseHtml, anime) {
  const title        = anime.title?.english || anime.title?.romaji || 'Anime';
  const rawDesc       = (anime.description || '').replace(/<[^>]+>/g, '').trim();
  const desc          = rawDesc.slice(0, 200) || `Watch ${title} free online with subtitles or dub on JustStreamAnime.`;
  const image         = anime.bannerImage || anime.coverImage?.extraLarge || anime.coverImage?.large || `${SITE_URL}/og-image.jpg`;
  const slug          = makeSlug(title);
  const canonicalUrl  = `${SITE_URL}/anime/${anime.id}/${slug}`;
  const pageTitle     = `${title} – JustStreamAnime`;

  let html = baseHtml;
  html = html.replace(/<title>[^<]*<\/title>/, `<title>${esc(pageTitle)}</title>`);
  html = html.replace(/<meta name="description" content="[^"]*"\/>/, `<meta name="description" content="${esc(desc)}"/>`);
  html = html.replace(/<link rel="canonical" href="[^"]*"\/>/, `<link rel="canonical" href="${esc(canonicalUrl)}"/>`);
  html = html.replace(/(id="og-url"\s+property="og:url"\s+content=")[^"]*(")/,      `$1${esc(canonicalUrl)}$2`);
  html = html.replace(/(id="og-title"\s+property="og:title"\s+content=")[^"]*(")/,  `$1${esc(pageTitle)}$2`);
  html = html.replace(/(id="og-desc"\s+property="og:description"\s+content=")[^"]*(")/,`$1${esc(desc)}$2`);
  html = html.replace(/(id="og-image"\s+property="og:image"\s+content=")[^"]*(")/,  `$1${esc(image)}$2`);
  html = html.replace(/(name="twitter:url"\s+content=")[^"]*(")/,                    `$1${esc(canonicalUrl)}$2`);
  html = html.replace(/(name="twitter:title"\s+content=")[^"]*(")/,                  `$1${esc(pageTitle)}$2`);
  html = html.replace(/(name="twitter:description"\s+content=")[^"]*(")/,            `$1${esc(desc)}$2`);
  html = html.replace(/(id="tw-image"\s+name="twitter:image"\s+content=")[^"]*(")/,  `$1${esc(image)}$2`);

  const schema = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "TVSeries",
        "name": title,
        "url": canonicalUrl,
        "image": image,
        "description": desc,
        "genre": (anime.genres || []).slice(0, 5),
        "numberOfEpisodes": anime.episodes || undefined,
        "aggregateRating": anime.averageScore ? {
          "@type": "AggregateRating",
          "ratingValue": (anime.averageScore / 10).toFixed(1),
          "bestRating": "10",
          "ratingCount": 1000
        } : undefined,
        "potentialAction": { "@type": "WatchAction", "target": canonicalUrl }
      },
      {
        "@type": "BreadcrumbList",
        "itemListElement": [
          { "@type": "ListItem", "position": 1, "name": "Home",  "item": "https://jsanime.site/" },
          { "@type": "ListItem", "position": 2, "name": title,   "item": canonicalUrl }
        ]
      }
    ]
  };
  html = html.replace('</head>', `<script type="application/ld+json">${JSON.stringify(schema)}</script>\n</head>`);
  return html;
}

// ── MANGA: fetch from MangaDex ─────────────────────────────────────────────────
function mdxFetch(endpoint) {
  return new Promise((resolve) => {
    const opts = {
      hostname: 'api.mangadex.org',
      path:     endpoint,
      method:   'GET',
      headers:  { 'Accept': 'application/json', 'User-Agent': 'JustStreamAnime/1.0 (jsanime.site)' },
      timeout: 6000,
    };
    const req = https.request(opts, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString())); }
        catch { resolve(null); }
      });
      res.on('error', () => resolve(null));
    });
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.on('error',   () => resolve(null));
    req.end();
  });
}

function getCoverUrl(manga, size = 512) {
  const rel = (manga.relationships || []).find(r => r.type === 'cover_art');
  const fn  = rel?.attributes?.fileName;
  return fn ? `https://uploads.mangadex.org/covers/${manga.id}/${fn}.${size}.jpg` : null;
}

function cleanDesc(raw) {
  return (raw || '')
    .replace(/<[^>]+>/g, '')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/read (more|this|it)?\s*(at|on|here)?\s*mangadex[^\n]*/gi, '')
    .replace(/visit mangadex[^\n]*/gi, '')
    .replace(/\(source:[^)]*\)/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, 250);
}

async function renderMangaHtml(baseHtml, id) {
  const data = await Promise.race([
    mdxFetch(`/manga/${encodeURIComponent(id)}?includes[]=cover_art&includes[]=author`),
    new Promise(resolve => setTimeout(() => resolve(null), 6500)),
  ]);

  if (!data?.data) {
    const fallbackTitle = 'Read Manga Free';
    return baseHtml
      .replace(/id="og-title" property="og:title" content="[^"]*"/,
        `id="og-title" property="og:title" content="${esc(fallbackTitle)} – JustStreamAnime"`)
      .replace(/id="og-image" property="og:image" content="[^"]*"/,
        `id="og-image" property="og:image" content="${FALLBACK_IMG}"`)
      .replace(/id="tw-image" name="twitter:image" content="[^"]*"/,
        `id="tw-image" name="twitter:image" content="${FALLBACK_IMG}"`);
  }

  const m    = data.data;
  const attr = m.attributes || {};

  const title       = attr.title?.en || Object.values(attr.title || {})[0] || 'Manga';
  const rawDesc     = attr.description?.en || Object.values(attr.description || {})[0] || '';
  const desc        = cleanDesc(rawDesc);
  const cover       = getCoverUrl(m, 512) || FALLBACK_IMG;
  const author      = (m.relationships || []).find(r => r.type === 'author')?.attributes?.name || '';
  const status      = attr.status ? (attr.status.charAt(0).toUpperCase() + attr.status.slice(1)) : '';
  const lastChapter = attr.lastChapter || '';
  const year        = attr.year || '';
  const genres      = (attr.tags || [])
    .filter(t => t.attributes?.group === 'genre')
    .map(t => t.attributes?.name?.en || '')
    .filter(Boolean).slice(0, 4).join(', ');

  const slug      = makeSlug(title);
  const canonical = `${SITE_URL}/manga/${id}/${slug}`;
  const pageTitle = `${title} – Read Free on JustStreamAnime`;
  const metaParts = [
    author ? `By ${author}` : '', status, lastChapter ? `${lastChapter} Ch` : '',
    year ? String(year) : '', genres,
  ].filter(Boolean).join(' · ');
  const fullDesc  = desc
    ? `${desc}${metaParts ? ` | ${metaParts}` : ''}`
    : `Read ${title} online free with English translation on JustStreamAnime. ${metaParts}`;

  const schema = JSON.stringify({
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Book', 'bookFormat': 'https://schema.org/GraphicNovel',
        'name': title, 'url': canonical, 'image': cover,
        'description': desc || undefined, 'inLanguage': 'en',
        'author': author ? { '@type': 'Person', 'name': author } : undefined,
        'genre': genres || undefined,
        'potentialAction': { '@type': 'ReadAction', 'target': canonical },
        'publisher': { '@type': 'Organization', 'name': 'JustStreamAnime', 'url': SITE_URL },
      },
      {
        '@type': 'BreadcrumbList',
        'itemListElement': [
          { '@type': 'ListItem', 'position': 1, 'name': 'Home',  'item': SITE_URL + '/' },
          { '@type': 'ListItem', 'position': 2, 'name': 'Manga', 'item': SITE_URL + '/manga' },
          { '@type': 'ListItem', 'position': 3, 'name': title,   'item': canonical },
        ],
      },
    ],
  });

  return baseHtml
    .replace(/<title>[^<]*<\/title>/, `<title>${esc(pageTitle)}</title>`)
    .replace(/<meta name="description" content="[^"]*"\/?>/,
      `<meta name="description" content="${esc(fullDesc.slice(0, 155))}"/>`)
    .replace(/(<link rel="canonical" href=")[^"]*(")/, `$1${canonical}$2`)
    .replace(/id="og-title" property="og:title" content="[^"]*"/,
      `id="og-title" property="og:title" content="${esc(pageTitle)}"`)
    .replace(/id="og-desc" property="og:description" content="[^"]*"/,
      `id="og-desc" property="og:description" content="${esc(fullDesc.slice(0, 200))}"`)
    .replace(/id="og-url" property="og:url" content="[^"]*"/,
      `id="og-url" property="og:url" content="${canonical}"`)
    .replace(/id="og-image" property="og:image" content="[^"]*"/,
      `id="og-image" property="og:image" content="${cover}"`)
    .replace(/id="og-image-w" property="og:image:width" content="[^"]*"/,
      `id="og-image-w" property="og:image:width" content="512"`)
    .replace(/id="og-image-h" property="og:image:height" content="[^"]*"/,
      `id="og-image-h" property="og:image:height" content="728"`)
    .replace(/<meta name="twitter:card" content="[^"]*"\/?>/,
      `<meta name="twitter:card" content="summary_large_image"/>`)
    .replace(/<meta name="twitter:title" content="[^"]*"\/?>/,
      `<meta name="twitter:title" content="${esc(pageTitle)}"/>`)
    .replace(/<meta name="twitter:description" content="[^"]*"\/?>/,
      `<meta name="twitter:description" content="${esc(fullDesc.slice(0, 200))}"/>`)
    .replace(/id="tw-image" name="twitter:image" content="[^"]*"/,
      `id="tw-image" name="twitter:image" content="${cover}"`)
    .replace('</head>', `<script type="application/ld+json">${schema}</script>\n</head>`);
}

// ── Handler ─────────────────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  const qs   = require('url').parse(req.url, true).query;
  const type = qs.type;
  const id   = qs.id;

  const baseHtml = getBaseHtml();
  if (!baseHtml) { res.statusCode = 500; res.end('Base HTML not found'); return; }

  if (type === 'manga') {
    // No ID -> plain index.html (catches the /manga browse page)
    if (!id || id === 'undefined') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.end(baseHtml);
    }
    const html = await renderMangaHtml(baseHtml, id);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    // Shorter cache than anime — a broken/fallback card should self-heal fast
    // instead of staying stale in social-media caches for a full day.
    res.setHeader('Cache-Control', 'public, max-age=600, stale-while-revalidate=3600');
    res.end(html);
    return;
  }

  // Default: anime
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400');

  if (!id || isNaN(parseInt(id))) {
    res.statusCode = 200; res.end(baseHtml); return;
  }

  const anime = await fetchAnime(id);
  if (!anime) {
    res.statusCode = 200; res.end(baseHtml); return;
  }

  res.statusCode = 200;
  res.end(renderAnimeHtml(baseHtml, anime));
};
