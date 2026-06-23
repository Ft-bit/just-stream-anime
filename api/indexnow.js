// api/indexnow.js
// Submits your URLs to Bing (and Google, Yandex, etc.) via IndexNow protocol.
// Call this endpoint manually after publishing new content:
//   https://jsanime.site/api/indexnow?secret=jsa2026
// Or POST to it. The `secret` param prevents random people from triggering it.

const SITE_URL    = 'https://jsanime.site';
const INDEXNOW_KEY = '5155e1e3056b48aeb391399be3da189b';
const KEY_LOCATION = `${SITE_URL}/${INDEXNOW_KEY}.txt`;
const SUBMIT_SECRET = 'jsa2026'; // change this to something only you know

const STATIC_URLS = [
  SITE_URL + '/',
  SITE_URL + '/trending',
  SITE_URL + '/popular',
  SITE_URL + '/top',
  SITE_URL + '/airing',
  SITE_URL + '/explore',
  SITE_URL + '/schedule',
  SITE_URL + '/contact',
  SITE_URL + '/dmca',
  SITE_URL + '/privacy',
];

async function fetchAnimeUrls() {
  const query = `query($page:Int){Page(page:$page,perPage:50){
    pageInfo{hasNextPage}
    media(type:ANIME,sort:POPULARITY_DESC,isAdult:false){
      id title{english romaji}
    }
  }}`;

  const seen = new Set();
  const urls = [];

  // Fetch top 10 pages (500 anime) — enough for a meaningful initial submission
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
      urls.push(`${SITE_URL}/anime/${a.id}${slug?'/'+slug:''}`);
    }
  }
  return urls;
}

module.exports = async function handler(req, res) {
  // Simple secret check to prevent abuse
  const qs = require('url').parse(req.url, true).query;
  if (qs.secret !== SUBMIT_SECRET) {
    res.statusCode = 401;
    res.end(JSON.stringify({error:'Unauthorized — pass ?secret=YOUR_SECRET'}));
    return;
  }

  res.setHeader('Content-Type', 'application/json');

  try {
    const animeUrls  = await fetchAnimeUrls();
    const allUrls    = [...STATIC_URLS, ...animeUrls];

    // IndexNow accepts max 10,000 URLs per request; chunk if needed
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
          key:          INDEXNOW_KEY,
          keyLocation:  KEY_LOCATION,
          urlList:      chunk,
        }),
      });
      results.push({status: r.status, urls_submitted: chunk.length});
    }

    res.statusCode = 200;
    res.end(JSON.stringify({
      success: true,
      total_urls: allUrls.length,
      static_urls: STATIC_URLS.length,
      anime_urls: animeUrls.length,
      results,
    }));

  } catch (err) {
    res.statusCode = 500;
    res.end(JSON.stringify({error: err.message}));
  }
};
