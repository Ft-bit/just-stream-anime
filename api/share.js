/**
 * Vercel Serverless Function — /api/share?a=ANIME_ID
 * 
 * When WhatsApp/Facebook/Twitter crawlers open a share link,
 * this function fetches the anime from AniList and returns
 * HTML with the correct og:image, og:title, og:description.
 * 
 * Real users get a 302 redirect to the watch page instantly.
 */

const CRAWLERS = [
  'whatsapp', 'facebookexternalhit', 'twitterbot', 'telegrambot',
  'linkedinbot', 'discordbot', 'slackbot', 'redditbot', 'googlebot',
  'bingbot', 'applebot', 'ia_archiver', 'crawler', 'spider', 'preview'
];

function isCrawler(ua = '') {
  const lower = ua.toLowerCase();
  return CRAWLERS.some(bot => lower.includes(bot));
}

async function getAnime(id) {
  const query = `query($id:Int){Media(id:$id,type:ANIME){
    id title{english romaji}
    description(asHtml:false)
    coverImage{extraLarge large}
    bannerImage averageScore seasonYear genres format
  }}`;
  const res = await fetch('https://graphql.anilist.co', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables: { id: parseInt(id) } }),
  });
  const json = await res.json();
  return json.data?.Media || null;
}

function ogHTML(anime, shareUrl) {
  const title = anime.title?.english || anime.title?.romaji || 'Anime';
  const rawDesc = (anime.description || '').replace(/<[^>]+>/g, '').trim();
  const desc = rawDesc.slice(0, 220) || 'Watch free on JustStreamAnime.';
  const image = anime.bannerImage || anime.coverImage?.extraLarge || anime.coverImage?.large || 'https://jsanime.site/og-image.jpg';
  const watchUrl = `https://jsanime.site/#watch/${anime.id}/watch`;
  const score = anime.averageScore ? `${anime.averageScore}% · ` : '';
  const year = anime.seasonYear || '';

  return `<!DOCTYPE html>
<html prefix="og: https://ogp.me/ns#">
<head>
<meta charset="UTF-8"/>
<title>${title} – Watch Free on JustStreamAnime</title>
<meta name="description" content="${desc}"/>

<!-- Open Graph -->
<meta property="og:type" content="video.other"/>
<meta property="og:site_name" content="JustStreamAnime"/>
<meta property="og:url" content="${shareUrl}"/>
<meta property="og:title" content="${title}"/>
<meta property="og:description" content="${score}${year} · ${desc}"/>
<meta property="og:image" content="${image}"/>
<meta property="og:image:secure_url" content="${image}"/>
<meta property="og:image:type" content="image/jpeg"/>
<meta property="og:image:width" content="460"/>
<meta property="og:image:height" content="650"/>

<!-- Twitter Card -->
<meta name="twitter:card" content="summary_large_image"/>
<meta name="twitter:site" content="@JustStreamAnime"/>
<meta name="twitter:title" content="${title}"/>
<meta name="twitter:description" content="${desc}"/>
<meta name="twitter:image" content="${image}"/>
<meta name="twitter:image:alt" content="${title} cover"/>

<!-- Redirect real users immediately -->
<meta http-equiv="refresh" content="0;url=${watchUrl}"/>
<script>window.location.replace("${watchUrl}");</script>
</head>
<body style="background:#07070e;color:#fff;font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0">
  <div style="text-align:center">
    <p style="opacity:.6;font-size:14px">Redirecting to ${title}…</p>
    <a href="${watchUrl}" style="color:#e11d48">Click here if not redirected</a>
  </div>
</body>
</html>`;
}

export default async function handler(req, res) {
  const { a: animeId } = req.query;

  if (!animeId) {
    return res.redirect(302, 'https://jsanime.site/');
  }

  const ua = req.headers['user-agent'] || '';
  const shareUrl = `https://jsanime.site/share?a=${animeId}`;

  // Real user — redirect straight to the watch page
  if (!isCrawler(ua)) {
    return res.redirect(302, `https://jsanime.site/#watch/${animeId}/watch`);
  }

  // Crawler — serve OG HTML
  try {
    const anime = await getAnime(animeId);
    if (!anime) {
      return res.redirect(302, 'https://jsanime.site/');
    }
    const html = ogHTML(anime, shareUrl);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');
    return res.status(200).send(html);
  } catch (err) {
    return res.redirect(302, 'https://jsanime.site/');
  }
}
