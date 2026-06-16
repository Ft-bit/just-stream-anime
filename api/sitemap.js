// api/sitemap.js
// Generates three outputs depending on query: static (default), anime, index
const BASE = 'https://jsanime.site';
const ANILIST = 'https://graphql.anilist.co';

const STATIC_PAGES = [
  { url: BASE + '/', priority: '1.0', changefreq: 'daily' },
  { url: BASE + '/trending', priority: '0.9', changefreq: 'hourly' },
  { url: BASE + '/popular', priority: '0.8', changefreq: 'daily' },
  { url: BASE + '/top', priority: '0.8', changefreq: 'weekly' },
  { url: BASE + '/airing', priority: '0.8', changefreq: 'hourly' },
  { url: BASE + '/explore', priority: '0.7', changefreq: 'daily' },
  { url: BASE + '/schedule', priority: '0.7', changefreq: 'hourly' },
  { url: BASE + '/contact', priority: '0.4', changefreq: 'monthly' },
  { url: BASE + '/dmca', priority: '0.3', changefreq: 'monthly' },
  { url: BASE + '/privacy', priority: '0.3', changefreq: 'monthly' },
];

function escapeXml(str) {
  return (str || '').toString()
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function staticXml() {
  const today = new Date().toISOString().split('T')[0];
  return STATIC_PAGES.map(p => [
    '  <url>',
    `    <loc>${escapeXml(p.url)}</loc>`,
    `    <lastmod>${today}</lastmod>`,
    `    <changefreq>${p.changefreq}</changefreq>`,
    `    <priority>${p.priority}</priority>`,
    '  </url>'
  ].join('\n')).join('\n');
}

function sitemapIndexXml() {
  const today = new Date().toISOString().split('T')[0];
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    `  <sitemap><loc>${BASE}/sitemap.xml</loc><lastmod>${today}</lastmod></sitemap>`,
    `  <sitemap><loc>${BASE}/sitemap-anime.xml</loc><lastmod>${today}</lastmod></sitemap>`,
    '</sitemapindex>'
  ].join('\n');
}

// Minimal, rate-friendly AniList fetcher with pagination and safe defaults
async function fetchAnimePage(sort, page = 1, perPage = 50, status = null) {
  const query = `
    query($page:Int,$perPage:Int,$sort:[MediaSort],$status:MediaStatus){
      Page(page:$page,perPage:$perPage){
        pageInfo{hasNextPage}
        media(type:ANIME,sort:$sort,status:$status,isAdult:false){
          id title { english romaji } popularity status updatedAt coverImage { large }
        }
      }
    }
  `;
  const variables = { page, perPage, sort: [sort], ...(status ? { status } : {}) };
  try {
    const r = await fetch(ANILIST, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ query, variables })
    });
    if (!r.ok) return { media: [], pageInfo: { hasNextPage: false } };
    const json = await r.json();
    return json.data?.Page || { media: [], pageInfo: { hasNextPage: false } };
  } catch (err) {
    return { media: [], pageInfo: { hasNextPage: false } };
  }
}

function animeUrl(id, title) {
  const slug = (title || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return slug ? `${BASE}/anime/${id}/${slug}` : `${BASE}/anime/${id}`;
}

function animeXmlEntry(a) {
  const title = escapeXml(a.title?.english || a.title?.romaji || '');
  const loc = escapeXml(animeUrl(a.id, a.title?.english || a.title?.romaji || ''));
  const lastmod = a.updatedAt ? new Date(a.updatedAt * 1000).toISOString().split('T')[0] : new Date().toISOString().split('T')[0];
  const image = a.coverImage?.large ? escapeXml(a.coverImage.large) : null;

  const parts = [
    '  <url>',
    `    <loc>${loc}</loc>`,
    `    <lastmod>${lastmod}</lastmod>`,
    `    <changefreq>${a.status === 'RELEASING' ? 'daily' : 'weekly'}</changefreq>`,
    `    <priority>${a.popularity > 50000 ? '0.9' : a.popularity > 10000 ? '0.8' : a.popularity > 1000 ? '0.7' : '0.6'}</priority>`
  ];
  if (image) {
    parts.push('    <image:image>');
    parts.push(`      <image:loc>${image}</image:loc>`);
    parts.push(`      <image:title>${title}</image:title>`);
    parts.push('    </image:image>');
  }
  parts.push('  </url>');
  return parts.join('\n');
}

module.exports = async function handler(req, res) {
  // determine type from query string
  const url = require('url').parse(req.url, true);
  const type = url.query?.type || (req.url.includes('type=anime') ? 'anime' : req.url.includes('type=index') ? 'index' : 'static');

  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400');

  try {
    if (type === 'index') {
      res.statusCode = 200;
      res.end(sitemapIndexXml());
      return;
    }

    if (type === 'anime') {
      // Controlled fetch: small number of pages to avoid rate limits
      const jobs = [
        { sort: 'POPULARITY_DESC', pages: 3 },
        { sort: 'TRENDING_DESC', pages: 2 }
      ];
      const seen = new Set();
      const entries = [];

      for (const job of jobs) {
        for (let p = 1; p <= job.pages; p++) {
          const data = await fetchAnimePage(job.sort, p, 50, job.status || null);
          for (const a of data.media || []) {
            if (!seen.has(a.id)) {
              seen.add(a.id);
              entries.push(animeXmlEntry(a));
            }
          }
          if (!data.pageInfo?.hasNextPage) break;
          // gentle delay
          await new Promise(r => setTimeout(r, 250));
        }
      }

      const xml = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">',
        entries.join('\n'),
        '</urlset>'
      ].join('\n');

      res.statusCode = 200;
      res.end(xml);
      return;
    }

    // default static sitemap
    const xml = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
      staticXml(),
      '</urlset>'
    ].join('\n');

    res.statusCode = 200;
    res.end(xml);
  } catch (err) {
    console.error('Sitemap error:', err && err.message ? err.message : err);
    res.statusCode = 500;
    res.end('<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>');
  }
};
