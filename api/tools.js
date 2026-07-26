// api/tools.js — replaces the separate sitemap.js, feed.js, and indexnow.js
// files (merged to save Vercel Hobby-plan function slots; cap is 12 total).
// Routes on ?tool=sitemap|feed|indexnow — each behaves exactly as its
// original standalone file did, just living under one function now
//
// Routing (set in vercel.json):
//   /sitemap.xml        -> /api/tools?tool=sitemap
//   /sitemap-anime.xml  -> /api/tools?tool=sitemap&type=anime
//   /sitemap-index.xml  -> /api/tools?tool=sitemap&type=index
//   /feed               -> /api/tools?tool=feed            (+ original ?type=)
//   /indexnow           -> /api/tools?tool=indexnow         (+ ?secret=)

// ════════════════════════════════════════════════════════════════════════════
// SITEMAP
// ════════════════════════════════════════════════════════════════════════════
const SITEMAP_BASE    = 'https://jsanime.site';
const SITEMAP_ANILIST = 'https://graphql.anilist.co';

const SITEMAP_STATIC_PAGES = [
  { url: SITEMAP_BASE + '/',          priority: '1.0', changefreq: 'daily'   },
  { url: SITEMAP_BASE + '/trending',  priority: '0.9', changefreq: 'hourly'  },
  { url: SITEMAP_BASE + '/popular',   priority: '0.8', changefreq: 'daily'   },
  { url: SITEMAP_BASE + '/top',       priority: '0.8', changefreq: 'weekly'  },
  { url: SITEMAP_BASE + '/airing',    priority: '0.8', changefreq: 'hourly'  },
  { url: SITEMAP_BASE + '/explore',   priority: '0.7', changefreq: 'daily'   },
  { url: SITEMAP_BASE + '/schedule',  priority: '0.7', changefreq: 'hourly'  },
  { url: SITEMAP_BASE + '/contact',   priority: '0.4', changefreq: 'monthly' },
  { url: SITEMAP_BASE + '/dmca',      priority: '0.3', changefreq: 'monthly' },
  { url: SITEMAP_BASE + '/privacy',   priority: '0.3', changefreq: 'monthly' },
];

function xmlEsc(s) {
  return (s||'').toString().replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function sitemapStaticXml() {
  const today = new Date().toISOString().split('T')[0];
  return SITEMAP_STATIC_PAGES.map(p => [
    '  <url>',
    `    <loc>${xmlEsc(p.url)}</loc>`,
    `    <lastmod>${today}</lastmod>`,
    `    <changefreq>${p.changefreq}</changefreq>`,
    `    <priority>${p.priority}</priority>`,
    '  </url>',
  ].join('\n')).join('\n');
}

function sitemapIndexXml() {
  const today = new Date().toISOString().split('T')[0];
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    `  <sitemap><loc>${SITEMAP_BASE}/sitemap.xml</loc><lastmod>${today}</lastmod></sitemap>`,
    `  <sitemap><loc>${SITEMAP_BASE}/sitemap-anime.xml</loc><lastmod>${today}</lastmod></sitemap>`,
    '</sitemapindex>',
  ].join('\n');
}

async function sitemapFetchPage(sort, page, perPage, status) {
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
    const r = await fetch(SITEMAP_ANILIST, {
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

function sitemapAnimeEntry(a) {
  const title = xmlEsc(a.title?.english || a.title?.romaji || '');
  const slug  = (a.title?.english || a.title?.romaji || '').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
  const loc   = xmlEsc(`${SITEMAP_BASE}/anime/${a.id}${slug?'/'+slug:''}`);
  const mod   = a.updatedAt ? new Date(a.updatedAt*1000).toISOString().split('T')[0] : new Date().toISOString().split('T')[0];
  const pri   = a.popularity>50000?'0.9':a.popularity>10000?'0.8':a.popularity>1000?'0.7':'0.6';
  const img   = a.coverImage?.large ? xmlEsc(a.coverImage.large) : null;
  const parts = ['  <url>',`    <loc>${loc}</loc>`,`    <lastmod>${mod}</lastmod>`,
                 `    <changefreq>${a.status==='RELEASING'?'daily':'weekly'}</changefreq>`,
                 `    <priority>${pri}</priority>`];
  if (img) parts.push('    <image:image>',`      <image:loc>${img}</image:loc>`,`      <image:title>${title}</image:title>`,'    </image:image>');
  parts.push('  </url>');
  return parts.join('\n');
}

async function sitemapFetchAllAnimeEntries() {
  const jobs = [];
  for (let p = 1; p <= 15; p++) jobs.push(sitemapFetchPage('POPULARITY_DESC', p, 50));
  for (let p = 1; p <= 5;  p++) jobs.push(sitemapFetchPage('TRENDING_DESC',   p, 50));
  for (let p = 1; p <= 5;  p++) jobs.push(sitemapFetchPage('START_DATE_DESC', p, 50));

  const results = await Promise.all(jobs);
  const seen = new Set(), entries = [];
  for (const data of results) {
    for (const a of data.media || []) {
      if (!seen.has(a.id)) { seen.add(a.id); entries.push(sitemapAnimeEntry(a)); }
    }
  }
  return entries;
}

async function handleSitemap(req, res, qs) {
  const type = qs.type || 'static';

  res.setHeader('Content-Type',  'application/xml; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400');

  try {
    if (type === 'index') { res.statusCode = 200; res.end(sitemapIndexXml()); return; }

    if (type === 'anime') {
      const entries = await sitemapFetchAllAnimeEntries();
      res.statusCode = 200;
      res.end(['<?xml version="1.0" encoding="UTF-8"?>',
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">',
        entries.join('\n'), '</urlset>'].join('\n'));
      return;
    }

    res.statusCode = 200;
    res.end(['<?xml version="1.0" encoding="UTF-8"?>',
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
      sitemapStaticXml(), '</urlset>'].join('\n'));

  } catch (err) {
    console.error('Sitemap error:', err?.message);
    res.statusCode = 200;
    res.end('<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>');
  }
}

// ════════════════════════════════════════════════════════════════════════════
// FEED
// ════════════════════════════════════════════════════════════════════════════
const FEED_GRAPHQL_URL = 'https://graphql.anilist.co';
const FEED_SITE_URL    = 'https://jsanime.site';
const FEED_SITE_NAME   = 'JustStreamAnime';
const FEED_SITE_DESC   = 'Stream anime free online — trending, popular and top-rated anime with subtitles or dub.';

const FEED_QUERIES = {
  trending: `{
    Page(page:1,perPage:25){
      media(type:ANIME,sort:TRENDING_DESC,isAdult:false){
        id idMal title{english romaji}
        coverImage{extraLarge}
        bannerImage
        description(asHtml:false)
        averageScore episodes status
        nextAiringEpisode{episode airingAt timeUntilAiring}
        seasonYear season format genres
        siteUrl
      }
    }
  }`,
  airing: `{
    Page(page:1,perPage:25){
      media(type:ANIME,status:RELEASING,sort:TRENDING_DESC,isAdult:false){
        id idMal title{english romaji}
        coverImage{extraLarge}
        bannerImage
        description(asHtml:false)
        averageScore episodes status
        nextAiringEpisode{episode airingAt timeUntilAiring}
        seasonYear season format genres
        siteUrl
      }
    }
  }`,
  popular: `{
    Page(page:1,perPage:25){
      media(type:ANIME,sort:POPULARITY_DESC,isAdult:false){
        id idMal title{english romaji}
        coverImage{extraLarge}
        bannerImage
        description(asHtml:false)
        averageScore episodes status
        nextAiringEpisode{episode airingAt timeUntilAiring}
        seasonYear season format genres
        siteUrl
      }
    }
  }`,
  top: `{
    Page(page:1,perPage:25){
      media(type:ANIME,sort:SCORE_DESC,isAdult:false){
        id idMal title{english romaji}
        coverImage{extraLarge}
        bannerImage
        description(asHtml:false)
        averageScore episodes status
        nextAiringEpisode{episode airingAt timeUntilAiring}
        seasonYear season format genres
        siteUrl
      }
    }
  }`,
};

const FEED_TITLES = {
  trending: 'Trending Anime',
  airing:   'Currently Airing Anime',
  popular:  'Most Popular Anime',
  top:      'Top Rated Anime',
};

function feedEscapeXml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g,  '&amp;')
    .replace(/</g,  '&lt;')
    .replace(/>/g,  '&gt;')
    .replace(/"/g,  '&quot;')
    .replace(/'/g,  '&apos;');
}

function feedFmtCountdown(seconds) {
  if (!seconds || seconds <= 0) return null;
  const d  = Math.floor(seconds / 86400);
  const hr = Math.floor((seconds % 86400) / 3600);
  const mn = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${hr}h ${mn}m`;
  if (hr > 0) return `${hr}h ${mn}m`;
  return `${mn}m`;
}

function feedBuildItem(a) {
  const title  = a.title?.english || a.title?.romaji || 'Unknown';
  const season = a.season
    ? a.season.charAt(0) + a.season.slice(1).toLowerCase() + ' ' + a.seasonYear
    : (a.seasonYear || '');
  const desc   = (a.description || '').replace(/<[^>]+>/g, '').trim().slice(0, 400);
  const image  = a.coverImage?.extraLarge || '';
  const url    = `${FEED_SITE_URL}/anime/${a.id}`;
  const score  = a.averageScore ? `${a.averageScore}%` : '';
  const genres = (a.genres || []).slice(0, 4).join(', ');
  const status = a.status || '';
  const eps    = a.nextAiringEpisode
    ? a.nextAiringEpisode.episode - 1
    : (a.episodes || null);
  const nextEp = a.nextAiringEpisode ? a.nextAiringEpisode.episode : null;
  const eta    = a.nextAiringEpisode ? feedFmtCountdown(a.nextAiringEpisode.timeUntilAiring) : null;

  const descParts = [];
  if (image) descParts.push(`<img src="${feedEscapeXml(image)}" alt="${feedEscapeXml(title)}" style="max-width:100%;border-radius:8px;margin-bottom:10px;"/>`);
  const meta = [
    season && `📅 ${season}`,
    a.format,
    eps && `${eps} Episodes`,
    score && `⭐ ${score}`,
    genres,
    nextEp && eta ? `🔔 EP ${nextEp} airs in ${eta}` : null,
    status === 'RELEASING' ? '🟢 Currently Airing' : status === 'FINISHED' ? '✅ Finished' : null,
  ].filter(Boolean).join(' &nbsp;•&nbsp; ');
  if (meta) descParts.push(`<p style="font-size:13px;color:#666;margin:6px 0;">${meta}</p>`);
  if (desc) descParts.push(`<p style="margin:8px 0;">${feedEscapeXml(desc)}${desc.length >= 400 ? '...' : ''}</p>`);
  descParts.push(`<p><a href="${feedEscapeXml(url)}" style="color:#e11d48;font-weight:bold;">▶ Watch on JustStreamAnime</a></p>`);

  let pubDate;
  if (a.nextAiringEpisode?.airingAt) {
    const lastAiredTs = a.nextAiringEpisode.airingAt - 7 * 24 * 60 * 60;
    pubDate = new Date(lastAiredTs * 1000).toUTCString();
  } else if (a.seasonYear) {
    const monthMap = { WINTER: 0, SPRING: 3, SUMMER: 6, FALL: 9 };
    const month = a.season ? (monthMap[a.season] ?? 0) : 0;
    pubDate = new Date(Date.UTC(a.seasonYear, month, 1)).toUTCString();
  } else {
    const stableMs = Date.UTC(2010, 0, 1) + (a.id % 5000) * 86400 * 1000;
    pubDate = new Date(stableMs).toUTCString();
  }

  return `
    <item>
      <title>${feedEscapeXml(title)}${season ? ` — ${feedEscapeXml(season)}` : ''}</title>
      <link>${feedEscapeXml(url)}</link>
      <guid isPermaLink="false">jsanime-${a.id}</guid>
      <description><![CDATA[${descParts.join('\n')}]]></description>
      <pubDate>${pubDate}</pubDate>
      ${genres ? genres.split(', ').map(g => `<category>${feedEscapeXml(g)}</category>`).join('\n      ') : ''}
      ${image ? `<enclosure url="${feedEscapeXml(image)}" type="image/jpeg" length="0"/>` : ''}
      ${score ? `<rating>${feedEscapeXml(score)}</rating>` : ''}
    </item>`;
}

async function handleFeed(req, res, qs) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=3600');

  const type  = (qs.type || 'trending').toLowerCase();
  const query = FEED_QUERIES[type] || FEED_QUERIES.trending;
  const feedTitle = FEED_TITLES[type] || FEED_TITLES.trending;

  let mediaList = [];
  try {
    const response = await fetch(FEED_GRAPHQL_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body:    JSON.stringify({ query }),
    });
    const data = await response.json();
    mediaList  = data?.data?.Page?.media || [];
  } catch (err) {
    res.statusCode = 500;
    res.end('Failed to fetch anime data from AniList.');
    return;
  }

  const items   = mediaList.map(feedBuildItem).join('');
  const nowUtc  = new Date().toUTCString();
  const feedUrl = `${FEED_SITE_URL}/api/feed?type=${type}`;

  const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"
  xmlns:atom="http://www.w3.org/2005/Atom"
  xmlns:media="http://search.yahoo.com/mrss/"
  xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel>
    <title>${feedEscapeXml(FEED_SITE_NAME)} — ${feedEscapeXml(feedTitle)}</title>
    <link>${feedEscapeXml(FEED_SITE_URL)}</link>
    <description>${feedEscapeXml(FEED_SITE_DESC)}</description>
    <language>en-us</language>
    <lastBuildDate>${nowUtc}</lastBuildDate>
    <ttl>30</ttl>
    <atom:link href="${feedEscapeXml(feedUrl)}" rel="self" type="application/rss+xml"/>
    <image>
      <url>${FEED_SITE_URL}/og-image.jpg</url>
      <title>${feedEscapeXml(FEED_SITE_NAME)}</title>
      <link>${feedEscapeXml(FEED_SITE_URL)}</link>
    </image>
    ${items}
  </channel>
</rss>`;

  res.setHeader('Content-Type', 'application/rss+xml; charset=utf-8');
  res.statusCode = 200;
  res.end(rss);
}

// ════════════════════════════════════════════════════════════════════════════
// INDEXNOW
// ════════════════════════════════════════════════════════════════════════════
const IDXN_SITE_URL     = 'https://jsanime.site';
const IDXN_KEY          = '959052f29efd46f2b6c6ca540fd7c0ee';
const IDXN_KEY_LOCATION = `${IDXN_SITE_URL}/${IDXN_KEY}.txt`;
const IDXN_SECRET       = 'jsa2026';

const IDXN_STATIC_URLS = [
  IDXN_SITE_URL + '/',
  IDXN_SITE_URL + '/trending',
  IDXN_SITE_URL + '/popular',
  IDXN_SITE_URL + '/top',
  IDXN_SITE_URL + '/airing',
  IDXN_SITE_URL + '/explore',
  IDXN_SITE_URL + '/schedule',
  IDXN_SITE_URL + '/contact',
  IDXN_SITE_URL + '/dmca',
  IDXN_SITE_URL + '/privacy',
];

async function idxnFetchAnimeUrls() {
  const query = `query($page:Int){Page(page:$page,perPage:50){
    pageInfo{hasNextPage}
    media(type:ANIME,sort:POPULARITY_DESC,isAdult:false){
      id title{english romaji}
    }
  }}`;

  const seen = new Set();
  const urls = [];

  const jobs = Array.from({length:10},(_,i) => i+1).map(p =>
    fetch('https://graphql.anilist.co', {
      method: 'POST',
      headers: {'Content-Type':'application/json','Accept':'application/json'},
      body: JSON.stringify({query, variables:{page:p}}),
    }).then(r=>r.json()).catch(()=>null)
  );

  const results = await Promise.all(jobs);
  for (const d of results) {
    for (const a of d?.data?.Page?.media || []) {
      if (seen.has(a.id)) continue;
      seen.add(a.id);
      const slug = (a.title?.english||a.title?.romaji||'')
        .toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
      urls.push(`${IDXN_SITE_URL}/anime/${a.id}${slug?'/'+slug:''}`);
    }
  }
  return urls;
}

async function handleIndexNow(req, res, qs) {
  if (qs.secret !== IDXN_SECRET) {
    res.statusCode = 401;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({error:'Unauthorized — pass ?secret=YOUR_SECRET'}));
    return;
  }

  res.setHeader('Content-Type', 'application/json');

  try {
    const animeUrls  = await idxnFetchAnimeUrls();
    const allUrls    = [...IDXN_STATIC_URLS, ...animeUrls];

    const CHUNK = 10000;
    const chunks = [];
    for (let i = 0; i < allUrls.length; i += CHUNK) {
      chunks.push(allUrls.slice(i, i + CHUNK));
    }

    const results = [];
    for (const chunk of chunks) {
      const r = await fetch('https://api.indexnow.org/IndexNow', {
        method: 'POST',
        headers: {'Content-Type':'application/json; charset=utf-8'},
        body: JSON.stringify({
          host:        'jsanime.site',
          key:          IDXN_KEY,
          keyLocation:  IDXN_KEY_LOCATION,
          urlList:      chunk,
        }),
      });
      results.push({status: r.status, urls_submitted: chunk.length});
    }

    res.statusCode = 200;
    res.end(JSON.stringify({
      success: true,
      total_urls: allUrls.length,
      static_urls: IDXN_STATIC_URLS.length,
      anime_urls: animeUrls.length,
      results,
    }));

  } catch (err) {
    res.statusCode = 500;
    res.end(JSON.stringify({error: err.message}));
  }
}

// ════════════════════════════════════════════════════════════════════════════
// ROUTER
// ════════════════════════════════════════════════════════════════════════════
module.exports = async function handler(req, res) {
  const qs   = require('url').parse(req.url, true).query;
  const tool = qs.tool;

  if (tool === 'sitemap')  return handleSitemap(req, res, qs);
  if (tool === 'feed')     return handleFeed(req, res, qs);
  if (tool === 'indexnow') return handleIndexNow(req, res, qs);

  res.statusCode = 400;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ error: 'Unknown tool. Use ?tool=sitemap|feed|indexnow' }));
};
