// api/anime-page.js
// Server-side meta injection for /anime/:id/:slug
// Reads index.html from disk (not via HTTP) and swaps in anime-specific
// title, description, og tags and schema before serving — so Google sees
// the right content from the first byte instead of generic homepage text.
const fs   = require('fs');
const path = require('path');

const SITE_URL = 'https://jsanime.site';

// index.html sits at the repo root; Vercel makes it available at process.cwd()
function getBaseHtml() {
  try {
    return fs.readFileSync(path.join(process.cwd(), 'index.html'), 'utf8');
  } catch {
    return null;
  }
}

function esc(s) {
  return (s||'').toString()
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function makeSlug(title) {
  return (title||'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
}

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

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400');

  const baseHtml = getBaseHtml();
  if (!baseHtml) { res.statusCode = 500; res.end('Base HTML not found'); return; }

  const qs      = require('url').parse(req.url, true).query;
  const animeId = qs.id;

  // No ID — just serve the base HTML as-is
  if (!animeId || isNaN(parseInt(animeId))) {
    res.statusCode = 200; res.end(baseHtml); return;
  }

  const anime = await fetchAnime(animeId);

  // AniList unavailable — serve base HTML (React will handle the page client-side)
  if (!anime) {
    res.statusCode = 200; res.end(baseHtml); return;
  }

  const title        = anime.title?.english || anime.title?.romaji || 'Anime';
  const rawDesc      = (anime.description || '').replace(/<[^>]+>/g, '').trim();
  const desc         = rawDesc.slice(0, 200) || `Watch ${title} free online with subtitles or dub on JustStreamAnime.`;
  const image        = anime.bannerImage || anime.coverImage?.extraLarge || anime.coverImage?.large || `${SITE_URL}/og-image.jpg`;
  const slug         = makeSlug(title);
  const canonicalUrl = `${SITE_URL}/anime/${anime.id}/${slug}`;
  const pageTitle    = `${title} – JustStreamAnime`;

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

  // Inject TVSeries + BreadcrumbList JSON-LD
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
  html = html.replace('</head>',
    `<script type="application/ld+json">${JSON.stringify(schema)}</script>\n</head>`);

  res.statusCode = 200;
  res.end(html);
};
