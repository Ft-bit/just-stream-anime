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

function escape(str) {
  return (str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function staticXml() {
  const today = new Date().toISOString().split('T')[0];
  return STATIC_PAGES.map(p => [
    '  <url>',
    `    <loc>${escape(p.url)}</loc>`,
    `    <lastmod>${today}</lastmod>`,
    `    <changefreq>${p.changefreq}</changefreq>`,
    `    <priority>${p.priority}</priority>`,
    '  </url>',
  ].join('\n')).join('\n');
}

function sitemapIndex() {
  const today = new Date().toISOString().split('T')[0];
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    `  <sitemap><loc>${BASE}/sitemap.xml</loc><lastmod>${today}</lastmod></sitemap>`,
    `  <sitemap><loc>${BASE}/sitemap-anime.xml</loc><lastmod>${today}</lastmod></sitemap>`,
    '</sitemapindex>',
  ].join('\n');
}

module.exports = async function handler(req, res) {
  const type = req.url.includes('type=anime') ? 'anime' : req.url.includes('type=index') ? 'index' : 'static';
  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=3600');

  try {
    if (type === 'index') {
      res.statusCode = 200;
      res.end(sitemapIndex());
    } else if (type === 'anime') {
      // Simplified: you can plug in your AniList fetch here
      res.statusCode = 200;
      res.end('<?xml version="1.0"?><urlset></urlset>');
    } else {
      res.statusCode = 200;
      res.end([
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
        staticXml(),
        '</urlset>',
      ].join('\n'));
    }
  } catch (err) {
    res.statusCode = 500;
    res.end('<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>');
  }
};
