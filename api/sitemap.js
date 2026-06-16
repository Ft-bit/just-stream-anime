// api/sitemap.js
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
  return (str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
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

// simplified AniList fetcher
async function fetchAnimePage(sort, page = 1) {
  const query = `
    query($page:Int,$perPage:Int,$sort:[MediaSort]){
      Page(page:$page,perPage:50){
        pageInfo{hasNextPage}
        media(type:ANIME,sort:$sort,isAdult:false){
          id title{english romaji} updatedAt popularity status coverImage{large}
        }
      }
    }
  `;
  try {
    const r = await fetch(ANILIST, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables: { page, perPage: 50, sort: [sort] } })
    });
    const json = await r.json();
    return json.data?.Page || { media: [], pageInfo: { hasNextPage: false } };
  } catch {
    return { media: [], pageInfo: { hasNextPage: false } };
  }
}

function animeUrl(id, title) {
  const slug = (title || '').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
  return slug ? `${BASE}/anime/${id}/${slug}` : `${BASE}/anime/${id}`;
}

function animeXmlEntry(a) {
  const loc = escapeXml(animeUrl(a.id, a.title?.english || a.title?.romaji || ''));
  const lastmod = a.updatedAt ? new Date(a.updatedAt * 1000).toISOString().split('T')[0] : new Date().toISOString().split('T')[0];
  return [
    '  <url>',
    `    <loc>${loc}</loc>`,
    `    <lastmod>${lastmod}</lastmod>`,
    '  </url>'
  ].join('\n');
}

module.exports = async function handler(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const type = url.searchParams.get('type') || 'static';

  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=3600');

  try {
    if (type === 'index') {
      res.statusCode = 200;
      res.end(sitemapIndexXml());
      return;
    }

    if (type === 'anime') {
      const seen = new Set();
      const entries = [];
      for (let p = 1; p <= 3; p++) {
        const data = await fetchAnimePage('POPULARITY_DESC', p);
        for (const a of data.media || []) {
          if (!seen.has(a.id)) {
            seen.add(a.id);
            entries.push(animeXmlEntry(a));
          }
        }
        if (!data.pageInfo?.hasNextPage) break;
        await new Promise(r => setTimeout(r, 250));
      }
      const xml = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
        entries.join('\n'),
        '</urlset>'
      ].join('\n');
      res.statusCode = 200;
      res.end(xml);
      return;
    }

    // default: static sitemap
    const xml = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
      staticXml(),
      '</urlset>'
    ].join('\n');
    res.statusCode = 200;
    res.end(xml);

  } catch (err) {
    console.error('Sitemap error:', err.message);
    res.statusCode = 500;
    res.end('<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>');
  }
};
