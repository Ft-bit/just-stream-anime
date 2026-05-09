// api/share.js — Universal share page for JustStreamAnime
// Works on ALL platforms: Telegram, Discord, WhatsApp, Twitter, Facebook, iMessage, etc.
//
// How it works:
// - Bots (Telegram, Discord, etc.) fetch this URL and read the OG meta tags
// - Real users hit this URL and get instantly redirected to the actual watch page
// - No JavaScript needed for the OG tags — pure HTML that every bot can read

const ANILIST_URL = 'https://graphql.anilist.co';
const SITE_URL    = 'https://jsanime.site';
const FALLBACK_IMG = 'https://jsanime.site/og-image.jpg';

const QUERY = `
query($id:Int){
  Media(id:$id, type:ANIME){
    id idMal
    title{ english romaji }
    description(asHtml:false)
    coverImage{ extraLarge large }
    bannerImage
    averageScore episodes status
    nextAiringEpisode{ episode timeUntilAiring }
    seasonYear season format genres
  }
}`;

function esc(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;');
}

export default async function handler(req, res) {
  const animeId = parseInt(req.query.a || '0');

  // No ID → redirect home
  if (!animeId) {
    res.writeHead(302, { Location: SITE_URL });
    res.end();
    return;
  }

  const watchUrl = `${SITE_URL}/#watch/${animeId}/watch`;

  // Fetch anime data from AniList
  let anime = null;
  try {
    const r = await fetch(ANILIST_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ query: QUERY, variables: { id: animeId } }),
    });
    const data = await r.json();
    anime = data?.data?.Media || null;
  } catch(e) {
    // If AniList is down, redirect to watch page anyway
    res.writeHead(302, { Location: watchUrl });
    res.end();
    return;
  }

  if (!anime) {
    res.writeHead(302, { Location: watchUrl });
    res.end();
    return;
  }

  // Build metadata
  const title   = anime.title?.english || anime.title?.romaji || 'Anime';
  const rawDesc = (anime.description || '').replace(/<[^>]+>/g, '').trim();
  const desc    = rawDesc.slice(0, 200) + (rawDesc.length > 200 ? '...' : '');
  const image   = anime.coverImage?.extraLarge || anime.coverImage?.large || FALLBACK_IMG;
  const season  = anime.season
    ? anime.season.charAt(0) + anime.season.slice(1).toLowerCase() + ' ' + anime.seasonYear
    : (anime.seasonYear || '');
  const eps     = anime.nextAiringEpisode
    ? anime.nextAiringEpisode.episode - 1
    : (anime.episodes || null);
  const shareUrl = `${SITE_URL}/share?a=${animeId}`;

  // Build rich description for the preview card
  const metaParts = [
    season,
    anime.format,
    eps ? `${eps} Episodes` : null,
    anime.averageScore ? `⭐ ${anime.averageScore}%` : null,
    (anime.genres || []).slice(0,3).join(', '),
  ].filter(Boolean).join(' • ');

  const fullDesc = metaParts ? `${metaParts}\n\n${desc}` : desc;

  // Detect bots vs real users
  const ua = (req.headers['user-agent'] || '').toLowerCase();
  const isBot = /telegrambot|facebookexternalhit|twitterbot|whatsapp|discordbot|linkedinbot|slackbot|applebot|googlebot|bingbot|bot|crawler|spider|preview|scraper/i.test(ua);

  // Cache for 1 hour — bots read from cache, so OG tags are stable
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=7200');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');

  // Return full HTML — bots read OG tags, users get redirected
  const html = `<!DOCTYPE html>
<html lang="en" prefix="og: https://ogp.me/ns#">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>

  <!-- Primary meta -->
  <title>${esc(title)} — Watch on JustStreamAnime</title>
  <meta name="description" content="${esc(fullDesc)}"/>

  <!-- Open Graph — works on Facebook, Discord, Telegram, WhatsApp, iMessage, Slack -->
  <meta property="og:type"               content="website"/>
  <meta property="og:site_name"          content="JustStreamAnime"/>
  <meta property="og:url"                content="${esc(shareUrl)}"/>
  <meta property="og:title"              content="${esc(title)} — JustStreamAnime"/>
  <meta property="og:description"        content="${esc(fullDesc)}"/>
  <meta property="og:image"              content="${esc(image)}"/>
  <meta property="og:image:secure_url"   content="${esc(image)}"/>
  <meta property="og:image:type"         content="image/jpeg"/>
  <meta property="og:image:width"        content="460"/>
  <meta property="og:image:height"       content="650"/>
  <meta property="og:image:alt"          content="${esc(title)} cover art"/>

  <!-- Twitter Card -->
  <meta name="twitter:card"        content="summary_large_image"/>
  <meta name="twitter:site"        content="@juststreamanime"/>
  <meta name="twitter:title"       content="${esc(title)} — JustStreamAnime"/>
  <meta name="twitter:description" content="${esc(fullDesc)}"/>
  <meta name="twitter:image"       content="${esc(image)}"/>
  <meta name="twitter:image:alt"   content="${esc(title)} cover art"/>

  <!-- Telegram specifically reads og: tags. These extras help. -->
  <meta property="og:locale" content="en_US"/>

  <!-- Redirect real users immediately -->
  <meta http-equiv="refresh" content="0; url=${esc(watchUrl)}"/>

  <style>
    body{margin:0;padding:0;background:#07070e;color:#e4e4f0;font-family:sans-serif;
      display:flex;align-items:center;justify-content:center;min-height:100vh;text-align:center}
    .card{max-width:400px;padding:2rem}
    img{width:120px;border-radius:12px;margin-bottom:1rem}
    h1{font-size:1.2rem;margin:0 0 .5rem}
    p{font-size:.85rem;color:#8888a6;margin:0 0 1.5rem}
    a{display:inline-block;padding:.6rem 1.4rem;background:#e11d48;color:#fff;
      border-radius:8px;text-decoration:none;font-weight:700;font-size:.9rem}
  </style>
</head>
<body>
  <div class="card">
    <img src="${esc(image)}" alt="${esc(title)}"/>
    <h1>${esc(title)}</h1>
    <p>${esc(metaParts)}</p>
    <a href="${esc(watchUrl)}">▶ Watch on JustStreamAnime</a>
  </div>
  <script>
    // Instant JS redirect for real users (faster than meta refresh)
    window.location.replace(${JSON.stringify(watchUrl)});
  </script>
</body>
</html>`;

  res.status(200).send(html);
}
