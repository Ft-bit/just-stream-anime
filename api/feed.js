// api/feed.js — JustStreamAnime RSS Feed
// Deploy this file to /api/feed.js in your Vercel project
// Access at: https://jsanime.site/api/feed
//
// Supports these query params:
//   ?type=trending   (default) — top trending anime
//   ?type=airing     — currently airing anime
//   ?type=popular    — most popular anime
//   ?type=top        — top rated anime

const GRAPHQL_URL = 'https://graphql.anilist.co';
const SITE_URL    = 'https://jsanime.site';
const SITE_NAME   = 'JustStreamAnime';
const SITE_DESC   = 'Stream anime free online — trending, popular and top-rated anime with subtitles or dub.';

const QUERIES = {
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

function escapeXml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g,  '&amp;')
    .replace(/</g,  '&lt;')
    .replace(/>/g,  '&gt;')
    .replace(/"/g,  '&quot;')
    .replace(/'/g,  '&apos;');
}

function fmtCountdown(seconds) {
  if (!seconds || seconds <= 0) return null;
  const d  = Math.floor(seconds / 86400);
  const hr = Math.floor((seconds % 86400) / 3600);
  const mn = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${hr}h ${mn}m`;
  if (hr > 0) return `${hr}h ${mn}m`;
  return `${mn}m`;
}

function buildItem(a) {
  const title  = a.title?.english || a.title?.romaji || 'Unknown';
  const season = a.season
    ? a.season.charAt(0) + a.season.slice(1).toLowerCase() + ' ' + a.seasonYear
    : (a.seasonYear || '');
  const desc   = (a.description || '').replace(/<[^>]+>/g, '').trim().slice(0, 400);
  const image  = a.coverImage?.extraLarge || '';
  const url    = `${SITE_URL}/anime/${a.id}`;
  const score  = a.averageScore ? `${a.averageScore}%` : '';
  const genres = (a.genres || []).slice(0, 4).join(', ');
  const status = a.status || '';
  const eps    = a.nextAiringEpisode
    ? a.nextAiringEpisode.episode - 1
    : (a.episodes || null);
  const nextEp = a.nextAiringEpisode ? a.nextAiringEpisode.episode : null;
  const eta    = a.nextAiringEpisode ? fmtCountdown(a.nextAiringEpisode.timeUntilAiring) : null;

  // Build a rich description for the RSS item
  const descParts = [];
  if (image) descParts.push(`<img src="${escapeXml(image)}" alt="${escapeXml(title)}" style="max-width:100%;border-radius:8px;margin-bottom:10px;"/>`);
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
  if (desc) descParts.push(`<p style="margin:8px 0;">${escapeXml(desc)}${desc.length >= 400 ? '...' : ''}</p>`);
  descParts.push(`<p><a href="${escapeXml(url)}" style="color:#e11d48;font-weight:bold;">▶ Watch on JustStreamAnime</a></p>`);

  // pubDate strategy (in priority order):
  // 1. The PREVIOUS episode's air date (nextAiringEpisode.airingAt minus one episode's worth)
  //    — this is the actual date the latest episode dropped
  // 2. Season year + season start month → a fixed calendar date
  // 3. Deterministic fallback using the anime's AniList ID so it never changes
  let pubDate;
  if (a.nextAiringEpisode?.airingAt) {
    // airingAt is the NEXT episode's air time — subtract one week to get the last aired date
    const lastAiredTs = a.nextAiringEpisode.airingAt - 7 * 24 * 60 * 60;
    pubDate = new Date(lastAiredTs * 1000).toUTCString();
  } else if (a.seasonYear) {
    // Map AniList season names to approximate start months
    const monthMap = { WINTER: 0, SPRING: 3, SUMMER: 6, FALL: 9 };
    const month = a.season ? (monthMap[a.season] ?? 0) : 0;
    pubDate = new Date(Date.UTC(a.seasonYear, month, 1)).toUTCString();
  } else {
    // Last resort: derive a stable date from the anime ID so it never changes
    // Uses Jan 1 2010 + (id mod 5000) days — fully deterministic, never "now"
    const stableMs = Date.UTC(2010, 0, 1) + (a.id % 5000) * 86400 * 1000;
    pubDate = new Date(stableMs).toUTCString();
  }

  return `
    <item>
      <title>${escapeXml(title)}${season ? ` — ${escapeXml(season)}` : ''}</title>
      <link>${escapeXml(url)}</link>
      <guid isPermaLink="false">jsanime-${a.id}</guid>
      <description><![CDATA[${descParts.join('\n')}]]></description>
      <pubDate>${pubDate}</pubDate>
      ${genres ? genres.split(', ').map(g => `<category>${escapeXml(g)}</category>`).join('\n      ') : ''}
      ${image ? `<enclosure url="${escapeXml(image)}" type="image/jpeg" length="0"/>` : ''}
      ${score ? `<rating>${escapeXml(score)}</rating>` : ''}
    </item>`;
}

module.exports = async function handler(req, res) {
  // CORS headers so feed readers can access it
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=3600'); // cache 30 min

  const type  = (req.query.type || 'trending').toLowerCase();
  const query = QUERIES[type] || QUERIES.trending;
  const feedTitle = FEED_TITLES[type] || FEED_TITLES.trending;

  let mediaList = [];
  try {
    const response = await fetch(GRAPHQL_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body:    JSON.stringify({ query }),
    });
    const data = await response.json();
    mediaList  = data?.data?.Page?.media || [];
  } catch (err) {
    res.status(500).send('Failed to fetch anime data from AniList.');
    return;
  }

  const items   = mediaList.map(buildItem).join('');
  const nowUtc  = new Date().toUTCString();
  const feedUrl = `${SITE_URL}/api/feed?type=${type}`;

  const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"
  xmlns:atom="http://www.w3.org/2005/Atom"
  xmlns:media="http://search.yahoo.com/mrss/"
  xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel>
    <title>${escapeXml(SITE_NAME)} — ${escapeXml(feedTitle)}</title>
    <link>${escapeXml(SITE_URL)}</link>
    <description>${escapeXml(SITE_DESC)}</description>
    <language>en-us</language>
    <lastBuildDate>${nowUtc}</lastBuildDate>
    <ttl>30</ttl>
    <atom:link href="${escapeXml(feedUrl)}" rel="self" type="application/rss+xml"/>
    <image>
      <url>${SITE_URL}/og-image.jpg</url>
      <title>${escapeXml(SITE_NAME)}</title>
      <link>${escapeXml(SITE_URL)}</link>
    </image>
    ${items}
  </channel>
</rss>`;

  res.setHeader('Content-Type', 'application/rss+xml; charset=utf-8');
  res.status(200).send(rss);
}
