// api/anime-page.js
const SITE_URL = 'https://jsanime.site';

function esc(s) {
  return (s || '').toString()
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function makeSlug(title) {
  return (title || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

async function fetchAnime(id) {
  const query = `query($id:Int){Media(id:$id,type:ANIME){
    id idMal title{romaji english} description(asHtml:false)
    coverImage{extraLarge large} bannerImage episodes genres
    season seasonYear format status
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

async function fetchBaseHtml(req) {
  const host = req.headers.host || 'jsanime.site';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    const r = await fetch(`https://${host}/index.html`, { signal: controller.signal });
    clearTimeout(timer);
    if (!r.ok) return null;
    return await r.text();
  } catch {
    clearTimeout(timer);
    return null;
  }
}

module.exports = async function handler(req, res) {
  const qs      = require('url').parse(req.url, true).query;
  const animeId = qs.id;

  const baseHtml = await fetchBaseHtml(req);
  if (!baseHtml) { res.statusCode = 502; res.end('Could not load base page'); return; }

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400');

  if (!animeId || isNaN(parseInt(animeId))) {
    res.statusCode = 200;
    res.end(baseHtml);
    return;
  }

  const anime = await fetchAnime(animeId);
  if (!anime) {
    res.statusCode = 200;
    res.end(baseHtml);
    return;
  }

  const title   = anime.title?.english || anime.title?.romaji || 'Anime';
  const rawDesc = (anime.description || '').replace(/<[^>]+>/g, '').trim();
  const desc    = rawDesc.slice(0, 200) || `Watch ${title} online free with subtitles or dub on JustStreamAnime.`;
  const image   = anime.bannerImage || anime.coverImage?.extraLarge || anime.coverImage?.large || `${SITE_URL}/og-image.jpg`;
  const slug    = makeSlug(title);
  const canonicalUrl = `${SITE_URL}/anime/${anime.id}/${slug}`;
  const pageTitle = `${title} – JustStreamAnime`;

  let html = baseHtml;
  html = html.replace(/<title>[^<]*<\/title>/, `<title>${esc(pageTitle)}</title>`);
  html = html.replace(/<meta name="description" content="[^"]*"\/>/, `<meta name="description" content="${esc(desc)}"/>`);
  html = html.replace(/<link rel="canonical" href="[^"]*"\/>/, `<link rel="canonical" href="${esc(canonicalUrl)}"/>`);
  html = html.replace(/(id="og-url" property="og:url" content=")[^"]*(")/, `$1${esc(canonicalUrl)}$2`);
  html = html.replace(/(id="og-title" property="og:title" content=")[^"]*(")/, `$1${esc(pageTitle)}$2`);
  html = html.replace(/(id="og-desc" property="og:description" content=")[^"]*(")/, `$1${esc(desc)}$2`);
  html = html.replace(/(id="og-image" property="og:image" content=")[^"]*(")/, `$1${esc(image)}$2`);
  html = html.replace(/(name="twitter:url" content=")[^"]*(")/, `$1${esc(canonicalUrl)}$2`);
  html = html.replace(/(name="twitter:title" content=")[^"]*(")/, `$1${esc(pageTitle)}$2`);
  html = html.replace(/(name="twitter:description" content=")[^"]*(")/, `$1${esc(desc)}$2`);
  html = html.replace(/(id="tw-image" name="twitter:image" content=")[^"]*(")/, `$1${esc(image)}$2`);

  const schema = {
    "@context": "https://schema.org",
    "@type": "TVSeries",
    "name": title,
    "url": canonicalUrl,
    "image": image,
    "description": desc,
    "genre": anime.genres || [],
    "numberOfEpisodes": anime.episodes || undefined,
  };
  html = html.replace('</head>', `<script type="application/ld+json">${JSON.stringify(schema)}</script>\n</head>`);

  res.statusCode = 200;
  res.end(html);
};
