// api/sitemap.js
const BASE    = 'https://jsanime.site';
const ANILIST = 'https://graphql.anilist.co';

const STATIC_PAGES = [
  { url: BASE + '/',          priority: '1.0', changefreq: 'daily'   },
  { url: BASE + '/trending',  priority: '0.9', changefreq: 'hourly'  },
  { url: BASE + '/popular',   priority: '0.8', changefreq: 'daily'   },
  { url: BASE + '/top',       priority: '0.8', changefreq: 'weekly'  },
  { url: BASE + '/airing',    priority: '0.8', changefreq: 'hourly'  },
  { url: BASE + '/explore',   priority: '0.7', changefreq: 'daily'   },
  { url: BASE + '/schedule',  priority: '0.7', changefreq: 'hourly'  },
  { url: BASE + '/contact',   priority: '0.4', changefreq: 'monthly' },
  { url: BASE + '/dmca',      priority: '0.3', changefreq: 'monthly' },
  { url: BASE + '/privacy',   priority: '0.3', changefreq: 'monthly' },
];

function esc(s) {
  return (s||'').toString().replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function staticXml() {
  const today = new Date().toISOString().split('T')[0];
  return STATIC_PAGES.map(p => [
    '  <url>',
    `    <loc>${esc(p.url)}</loc>`,
    `    <lastmod>${today}</lastmod>`,
    `    <changefreq>${p.changefreq}</changefreq>`,
    `    <priority>${p.priority}</priority>`,
    '  </url>',
  ].join('\n')).join('\n');
}

function indexXml() {
  const today = new Date().toISOString().split('T')[0];
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    `  <sitemap><loc>${BASE}/sitemap.xml</loc><lastmod>${today}</lastmod></sitemap>`,
    `  <sitemap><loc>${BASE}/sitemap-anime.xml</loc><lastmod>${today}</lastmod></sitemap>`,
    '</sitemapindex>',
  ].join('\n');
}

// Fetch with a hard timeout so one slow/hanging AniList response can never
// hang the whole serverless function past Vercel's limit.
async function fetchPage(sort, page, perPage, status) {
  const query = `query($page:Int,$perPage:Int,$sort:[MediaSort],$status:MediaStatus){
    Page(page:$page,perPage:$perPage){
      pageInfo{hasNextPage}
      media(type:ANIME,sort:$sort,status:$status,isAdult:false){
        id title{english romaji} popularity status updatedAt coverImage{large}
      }
    }
  }`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    const r = await fetch(ANILIST, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ query, variables: { page, perPage, sort: [sort], ...(status?{status}:{}) } }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!r.ok) return { media: [], pageInfo: { hasNextPage: false } };
    const d = await r.json();
    return d.data?.Page || { media: [], pageInfo: { hasNextPage: false } };
  } catch {
    clearTimeout(timer);
    return { media: [], pageInfo: { hasNextPage: false } };
  }
}

function animeEntry(a) {
  const title = esc(a.title?.english || a.title?.romaji || '');
  const slug  = (a.title?.english || a.title?.romaji || '').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
  const loc   = esc(`${BASE}/anime/${a.id}${slug?'/'+slug:''}`);
  const mod   = a.updatedAt ? new Date(a.updatedAt*1000).toISOString().split('T')[0] : new Date().toISOString().split('T')[0];
  const pri   = a.popularity>50000?'0.9':a.popularity>10000?'0.8':a.popularity>1000?'0.7':'0.6';
  const img   = a.coverImage?.large ? esc(a.coverImage.large) : null;
  const parts = ['  <url>',`    <loc>${loc}</loc>`,`    <lastmod>${mod}</lastmod>`,
                 `    <changefreq>${a.status==='RELEASING'?'daily':'weekly'}</changefreq>`,
                 `    <priority>${pri}</priority>`];
  if (img) parts.push('    <image:image>',`      <image:loc>${img}</image:loc>`,`      <image:title>${title}</image:title>`,'    </image:image>');
  parts.push('  </url>');
  return parts.join('\n');
}

// Coverage plan, run fully in parallel:
//   POPULARITY_DESC × 15 pages × 50 = up to 750  — everything anyone would
//     plausibly search for, popular long-runners included
//   TRENDING_DESC   × 5  pages × 50 = up to 250  — whatever's hot right now
//   START_DATE_DESC × 5  pages × 50 = up to 250  — newly added/airing titles
//     that haven't built up popularity yet (this is what catches something
//     like a recently-aired show before it becomes "popular")
// All de-duplicated by id. ~25 parallel AniList calls, each with its own
// 6s timeout, comfortably finishes inside the 30s function budget.
async function fetchAllAnimeEntries() {
  const jobs = [];
  for (let p = 1; p <= 15; p++) jobs.push(fetchPage('POPULARITY_DESC', p, 50));
  for (let p = 1; p <= 5;  p++) jobs.push(fetchPage('TRENDING_DESC',   p, 50));
  for (let p = 1; p <= 5;  p++) jobs.push(fetchPage('START_DATE_DESC', p, 50));

  const results = await Promise.all(jobs);
  const seen = new Set(), entries = [];
  for (const data of results) {
    for (const a of data.media || []) {
      if (!seen.has(a.id)) { seen.add(a.id); entries.push(animeEntry(a)); }
    }
  }
  return entries;
}

module.exports = async function handler(req, res) {
  const qs   = require('url').parse(req.url, true).query;
  const type = qs.type || (req.url.includes('type=anime')?'anime':req.url.includes('type=index')?'index':'static');

  res.setHeader('Content-Type',  'application/xml; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400');

  try {
    if (type === 'index') { res.statusCode = 200; res.end(indexXml()); return; }

    if (type === 'anime') {
      const entries = await fetchAllAnimeEntries();
      res.statusCode = 200;
      res.end(['<?xml version="1.0" encoding="UTF-8"?>',
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">',
        entries.join('\n'), '</urlset>'].join('\n'));
      return;
    }

    res.statusCode = 200;
    res.end(['<?xml version="1.0" encoding="UTF-8"?>',
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
      staticXml(), '</urlset>'].join('\n'));

  } catch (err) {
    console.error('Sitemap error:', err?.message);
    res.statusCode = 200;
    res.end('<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>');
  }
};
