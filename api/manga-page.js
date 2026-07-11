// api/manga-page.js — Server-side meta injection for /manga/:id/:slug
// Fetches manga from MangaDex, injects OG/Twitter/JSON-LD tags into index.html
// so Google, Telegram, Discord, Twitter/X see manga-specific content from first byte

const fs   = require('fs');
const path = require('path');
const https = require('https');

const SITE_URL     = 'https://jsanime.site';
const FALLBACK_IMG = 'https://jsanime.site/og-image.jpg';

// ── Fetch from MangaDex — shorter timeout so social bots don't give up ───────
function mdxFetch(endpoint) {
  return new Promise((resolve) => {
    const opts = {
      hostname: 'api.mangadex.org',
      path:     endpoint,
      method:   'GET',
      headers:  {
        'Accept':     'application/json',
        'User-Agent': 'JustStreamAnime/1.0 (jsanime.site)',
      },
      timeout: 6000, // was 10000 — X/Twitter's bot often times out well before that
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

// ── Helpers ───────────────────────────────────────────────────────────────────
function getCoverUrl(manga, size = 512) {
  const rel = (manga.relationships || []).find(r => r.type === 'cover_art');
  const fn  = rel?.attributes?.fileName;
  return fn ? `https://uploads.mangadex.org/covers/${manga.id}/${fn}.${size}.jpg` : null;
}

function makeSlug(title) {
  return (title || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function esc(s) {
  if (!s) return '';
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
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

// ── Handler ───────────────────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  const { id } = req.query;

  // Read base index.html
  let html;
  try {
    html = fs.readFileSync(path.join(process.cwd(), 'index.html'), 'utf8');
  } catch (e) {
    res.statusCode = 500;
    return res.end('Cannot read index.html');
  }

  // No ID → serve plain index.html (catches /manga browse page)
  if (!id || id === 'undefined') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.end(html);
  }

  // Fetch manga detail from MangaDex — race against a hard 6.5s cutoff so we
  // NEVER hang past what social-media crawlers are willing to wait for.
  const data = await Promise.race([
    mdxFetch(`/manga/${encodeURIComponent(id)}?includes[]=cover_art&includes[]=author`),
    new Promise(resolve => setTimeout(() => resolve(null), 6500)),
  ]);

  if (!data?.data) {
    // MangaDex didn't respond in time or manga not found — serve the page
    // with safe fallback OG tags rather than broken/undefined ones.
    const fallbackTitle = 'Read Manga Free';
    html = html
      .replace(/id="og-title" property="og:title" content="[^"]*"/,
        `id="og-title" property="og:title" content="${esc(fallbackTitle)} \u2013 JustStreamAnime"`)
      .replace(/id="og-image" property="og:image" content="[^"]*"/,
        `id="og-image" property="og:image" content="${FALLBACK_IMG}"`)
      .replace(/id="tw-image" name="twitter:image" content="[^"]*"/,
        `id="tw-image" name="twitter:image" content="${FALLBACK_IMG}"`);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.end(html);
  }

  const m    = data.data;
  const attr = m.attributes || {};

  const title       = attr.title?.en || Object.values(attr.title || {})[0] || 'Manga';
  const rawDesc     = attr.description?.en || Object.values(attr.description || {})[0] || '';
  const desc        = cleanDesc(rawDesc);
  const cover       = getCoverUrl(m, 512) || FALLBACK_IMG; // guaranteed non-empty
  const author      = (m.relationships || []).find(r => r.type === 'author')?.attributes?.name || '';
  const status      = attr.status ? (attr.status.charAt(0).toUpperCase() + attr.status.slice(1)) : '';
  const lastChapter = attr.lastChapter || '';
  const year        = attr.year || '';
  const genres      = (attr.tags || [])
    .filter(t => t.attributes?.group === 'genre')
    .map(t => t.attributes?.name?.en || '')
    .filter(Boolean)
    .slice(0, 4)
    .join(', ');

  const slug      = makeSlug(title);
  const canonical = `${SITE_URL}/manga/${id}/${slug}`;

  const pageTitle = `${title} \u2013 Read Free on JustStreamAnime`;
  const metaParts = [
    author      ? `By ${author}`        : '',
    status      ? status                 : '',
    lastChapter ? `${lastChapter} Ch`   : '',
    year        ? String(year)           : '',
    genres,
  ].filter(Boolean).join(' \u00b7 ');
  const fullDesc  = desc
    ? `${desc}${metaParts ? ` | ${metaParts}` : ''}`
    : `Read ${title} online free with English translation on JustStreamAnime. ${metaParts}`;

  // ── JSON-LD Schema ──────────────────────────────────────────────────────────
  const schema = JSON.stringify({
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type':       'Book',
        'bookFormat':  'https://schema.org/GraphicNovel',
        'name':        title,
        'url':         canonical,
        'image':       cover,
        'description': desc || undefined,
        'inLanguage':  'en',
        'author':      author ? { '@type': 'Person', 'name': author } : undefined,
        'genre':       genres || undefined,
        'potentialAction': { '@type': 'ReadAction', 'target': canonical },
        'publisher': {
          '@type': 'Organization',
          'name':  'JustStreamAnime',
          'url':   SITE_URL,
        },
      },
      {
        '@type': 'BreadcrumbList',
        'itemListElement': [
          { '@type': 'ListItem', 'position': 1, 'name': 'Home',  'item': SITE_URL + '/'      },
          { '@type': 'ListItem', 'position': 2, 'name': 'Manga', 'item': SITE_URL + '/manga' },
          { '@type': 'ListItem', 'position': 3, 'name': title,   'item': canonical           },
        ],
      },
    ],
  });

  // ── Inject into HTML ────────────────────────────────────────────────────────
  html = html
    // Title
    .replace(/<title>[^<]*<\/title>/,
      `<title>${esc(pageTitle)}</title>`)
    // Meta description
    .replace(/<meta name="description" content="[^"]*"\/?>/,
      `<meta name="description" content="${esc(fullDesc.slice(0, 155))}"/>`)
    // Canonical
    .replace(/(<link rel="canonical" href=")[^"]*(")/,
      `$1${canonical}$2`)
    // OG tags
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
    // Twitter/X — explicit reinforcement so a stripped-down crawler still sees
    // everything it needs even if it only reads twitter:* tags, not og:*
    .replace(/<meta name="twitter:card" content="[^"]*"\/?>/,
      `<meta name="twitter:card" content="summary_large_image"/>`)
    .replace(/<meta name="twitter:title" content="[^"]*"\/?>/,
      `<meta name="twitter:title" content="${esc(pageTitle)}"/>`)
    .replace(/<meta name="twitter:description" content="[^"]*"\/?>/,
      `<meta name="twitter:description" content="${esc(fullDesc.slice(0, 200))}"/>`)
    .replace(/id="tw-image" name="twitter:image" content="[^"]*"/,
      `id="tw-image" name="twitter:image" content="${cover}"`)
    // Inject manga JSON-LD before </head>
    .replace('</head>', `<script type="application/ld+json">${schema}</script>\n</head>`);

  res.setHeader('Content-Type',  'text/html; charset=utf-8');
  // Shorter cache so a broken/fallback card gets replaced quickly once fixed,
  // instead of X/Telegram serving a stale broken preview for a full day.
  res.setHeader('Cache-Control', 'public, max-age=600, stale-while-revalidate=3600');
  res.end(html);
};
