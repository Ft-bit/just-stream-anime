// api/share.js — JustStreamAnime universal share handler
//
// ROOT CAUSE OF TELEGRAM BUG (now fixed):
//   The old isLinkBot() had a multiline regex literal — JavaScript regex literals
//   CANNOT span multiple lines. This caused a SyntaxError that crashed the entire
//   function. Vercel returned HTTP 500, so Telegram never got OG tags and fell
//   back to reading your main site's static og-image.jpg.
//
// THIS VERSION: no user-agent detection at all.
//   Serve OG HTML to EVERYONE:
//   • Bots  → read <meta og:...> tags → show anime card preview ✅
//   • Users → <script> redirects them to the watch page instantly ✅
//   Works on Telegram, Discord, WhatsApp, Twitter, Facebook, iMessage, Slack.

const ANILIST_URL  = 'https://graphql.anilist.co';
const SITE_URL     = 'https://jsanime.site';
const FALLBACK_IMG = 'https://jsanime.site/og-image.jpg';

const QUERY = `query($id:Int){Media(id:$id,type:ANIME){id title{english romaji}description(asHtml:false)coverImage{extraLarge large}bannerImage averageScore episodes status nextAiringEpisode{episode}seasonYear season format genres}}`;

function esc(s) {
  if (!s) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

export default async function handler(req, res) {
  const animeId = parseInt(req.query.a || '0');

  if (!animeId) {
    res.writeHead(302, { Location: SITE_URL });
    res.end();
    return;
  }

  const watchUrl = `${SITE_URL}/#watch/${animeId}/watch`;
  const shareUrl = `${SITE_URL}/share?a=${animeId}`;

  // Fetch anime data from AniList
  let anime = null;
  try {
    const r = await fetch(ANILIST_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body:    JSON.stringify({ query: QUERY, variables: { id: animeId } }),
    });
    const json = await r.json();
    anime = json?.data?.Media || null;
  } catch (_) { /* AniList down — fallback values used */ }

  const title     = anime ? (anime.title?.english || anime.title?.romaji || 'Anime') : 'Watch Anime Free';
  const rawDesc   = (anime?.description || '').replace(/<[^>]+>/g, '').trim();
  const desc      = rawDesc.slice(0, 220) + (rawDesc.length > 220 ? '…' : '');
  const image     = anime ? (anime.coverImage?.extraLarge || anime.coverImage?.large || FALLBACK_IMG) : FALLBACK_IMG;
  const season    = anime?.season ? anime.season.charAt(0) + anime.season.slice(1).toLowerCase() + ' ' + anime.seasonYear : (anime?.seasonYear ? String(anime.seasonYear) : '');
  const eps       = anime?.nextAiringEpisode ? anime.nextAiringEpisode.episode - 1 : (anime?.episodes || null);
  const metaParts = [season, anime?.format, eps ? `${eps} Episodes` : null, anime?.averageScore ? `⭐ ${anime.averageScore}%` : null, (anime?.genres||[]).slice(0,3).join(', ')].filter(Boolean).join(' • ');
  const cardDesc  = metaParts ? `${metaParts}\n\n${desc}` : desc;

  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=7200');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');

  const html = `<!DOCTYPE html>
<html lang="en" prefix="og: https://ogp.me/ns#">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>${esc(title)} — Watch on JustStreamAnime</title>
  <meta name="description" content="${esc(cardDesc)}"/>

  <meta property="og:type"             content="website"/>
  <meta property="og:site_name"        content="JustStreamAnime"/>
  <meta property="og:url"              content="${esc(shareUrl)}"/>
  <meta property="og:title"            content="${esc(title)} — JustStreamAnime"/>
  <meta property="og:description"      content="${esc(cardDesc)}"/>
  <meta property="og:image"            content="${esc(image)}"/>
  <meta property="og:image:secure_url" content="${esc(image)}"/>
  <meta property="og:image:type"       content="image/jpeg"/>
  <meta property="og:image:width"      content="460"/>
  <meta property="og:image:height"     content="650"/>
  <meta property="og:image:alt"        content="${esc(title)} cover art"/>
  <meta property="og:locale"           content="en_US"/>

  <meta name="twitter:card"        content="summary_large_image"/>
  <meta name="twitter:site"        content="@juststreamanime"/>
  <meta name="twitter:title"       content="${esc(title)} — JustStreamAnime"/>
  <meta name="twitter:description" content="${esc(cardDesc)}"/>
  <meta name="twitter:image"       content="${esc(image)}"/>
  <meta name="twitter:image:alt"   content="${esc(title)} cover art"/>

  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{background:#07070e;color:#e4e4f0;font-family:system-ui,sans-serif;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:1rem}
    .card{max-width:340px;width:100%;text-align:center}
    img{width:130px;border-radius:12px;box-shadow:0 8px 32px rgba(0,0,0,.7);margin:0 auto 1.1rem;display:block}
    h1{font-size:1.15rem;font-weight:800;letter-spacing:-.02em;margin-bottom:.35rem;line-height:1.25}
    p{font-size:.78rem;color:#8888a6;margin-bottom:1.3rem;line-height:1.5}
    a{display:inline-flex;align-items:center;gap:.4rem;padding:.65rem 1.6rem;background:#e11d48;color:#fff;border-radius:9px;text-decoration:none;font-weight:700;font-size:.9rem;box-shadow:0 4px 18px rgba(225,29,72,.35)}
  </style>
</head>
<body>
  <div class="card">
    <img src="${esc(image)}" alt="${esc(title)}"/>
    <h1>${esc(title)}</h1>
    <p>${esc(metaParts)}</p>
    <a href="${esc(watchUrl)}">▶ Watch Now</a>
  </div>
  <script>window.location.replace(${JSON.stringify(watchUrl)});</script>
</body>
</html>`;

  res.status(200).send(html);
}
