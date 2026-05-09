// api/share.js — Universal OG share handler for JustStreamAnime
// Bots  → get HTML with proper OG meta tags (NO redirect — that's what was breaking Telegram)
// Users → get instant 302 redirect straight to the watch page

const ANILIST_URL  = 'https://graphql.anilist.co';
const SITE_URL     = 'https://jsanime.site';
const FALLBACK_IMG = 'https://jsanime.site/og-image.jpg';

const QUERY = `
query($id:Int){
  Media(id:$id, type:ANIME){
    id
    title{ english romaji }
    description(asHtml:false)
    coverImage{ extraLarge large }
    bannerImage
    averageScore episodes status
    nextAiringEpisode{ episode }
    seasonYear season format genres
  }
}`;

function esc(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Every known link-preview bot UA
function isLinkBot(ua) {
  return /telegrambot|facebookexternalhit|facebookbot|twitterbot|twittercard|
    whatsapp|whatsappbot|discordbot|discordpreview|linkedinbot|slackbot|slack-imgproxy|
    applebot|googlebot|bingbot|yandexbot|duckduckbot|baiduspider|
    iframely|embedly|outbrain|pinterest|vk share|viber|line-poker|
    crawler|spider|scraper|preview|bot\b/i.test(ua);
}

export default async function handler(req, res) {
  const animeId = parseInt(req.query.a || '0');

  if (!animeId) {
    res.writeHead(302, { Location: SITE_URL });
    res.end();
    return;
  }

  const watchUrl = `${SITE_URL}/#watch/${animeId}/watch`;
  const ua       = (req.headers['user-agent'] || '');

  // ── REAL USER: instant 302, no HTML needed ────────────────────────────────
  if (!isLinkBot(ua)) {
    res.writeHead(302, {
      Location: watchUrl,
      'Cache-Control': 'no-store',
    });
    res.end();
    return;
  }

  // ── BOT: fetch anime data and return OG HTML ──────────────────────────────
  let anime = null;
  try {
    const r = await fetch(ANILIST_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body:    JSON.stringify({ query: QUERY, variables: { id: animeId } }),
    });
    const data = await r.json();
    anime = data?.data?.Media || null;
  } catch (e) {
    // AniList down → serve fallback OG so the bot still gets something
  }

  const shareUrl = `${SITE_URL}/share?a=${animeId}`;

  const title = anime
    ? (anime.title?.english || anime.title?.romaji || 'Anime')
    : 'Watch Anime Free';

  const rawDesc = anime
    ? (anime.description || '').replace(/<[^>]+>/g, '').trim()
    : '';

  const desc = rawDesc.slice(0, 220) + (rawDesc.length > 220 ? '…' : '');

  // Prefer cover image (portrait) — it looks best as a card preview
  const image = anime
    ? (anime.coverImage?.extraLarge || anime.coverImage?.large || FALLBACK_IMG)
    : FALLBACK_IMG;

  const season = anime?.season
    ? anime.season.charAt(0) + anime.season.slice(1).toLowerCase() + ' ' + anime.seasonYear
    : (anime?.seasonYear || '');

  const eps = anime?.nextAiringEpisode
    ? anime.nextAiringEpisode.episode - 1
    : (anime?.episodes || null);

  const metaParts = [
    season,
    anime?.format,
    eps ? `${eps} Episodes` : null,
    anime?.averageScore ? `⭐ ${anime.averageScore}%` : null,
    (anime?.genres || []).slice(0, 3).join(', '),
  ].filter(Boolean).join(' • ');

  const cardDesc = metaParts ? `${metaParts}\n\n${desc}` : desc;

  // Cache aggressively so bots that re-fetch still get the right preview
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=7200');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');

  // ── NO redirect tags anywhere — that's what was killing Telegram ──────────
  const html = `<!DOCTYPE html>
<html lang="en" prefix="og: https://ogp.me/ns#">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>${esc(title)} — Watch on JustStreamAnime</title>
  <meta name="description" content="${esc(cardDesc)}"/>

  <!-- Open Graph (Facebook, Telegram, Discord, iMessage, Slack, WhatsApp) -->
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

  <!-- Twitter Card -->
  <meta name="twitter:card"        content="summary_large_image"/>
  <meta name="twitter:site"        content="@juststreamanime"/>
  <meta name="twitter:title"       content="${esc(title)} — JustStreamAnime"/>
  <meta name="twitter:description" content="${esc(cardDesc)}"/>
  <meta name="twitter:image"       content="${esc(image)}"/>
  <meta name="twitter:image:alt"   content="${esc(title)} cover art"/>

  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{background:#07070e;color:#e4e4f0;font-family:system-ui,sans-serif;
      min-height:100vh;display:flex;align-items:center;justify-content:center;padding:1rem}
    .card{max-width:360px;width:100%;text-align:center}
    .poster{width:140px;border-radius:12px;box-shadow:0 8px 32px rgba(0,0,0,.7);margin:0 auto 1.2rem}
    h1{font-size:1.25rem;font-weight:800;letter-spacing:-.02em;margin-bottom:.4rem}
    p{font-size:.8rem;color:#8888a6;margin-bottom:1.4rem;line-height:1.5}
    a{display:inline-flex;align-items:center;gap:.4rem;padding:.65rem 1.6rem;
      background:#e11d48;color:#fff;border-radius:9px;text-decoration:none;
      font-weight:700;font-size:.95rem;box-shadow:0 4px 18px rgba(225,29,72,.35)}
    .arrow{font-size:1.1rem}
  </style>
</head>
<body>
  <div class="card">
    <img class="poster" src="${esc(image)}" alt="${esc(title)}"/>
    <h1>${esc(title)}</h1>
    <p>${esc(metaParts)}</p>
    <a href="${esc(watchUrl)}"><span class="arrow">▶</span> Watch on JustStreamAnime</a>
  </div>
</body>
</html>`;

  res.status(200).send(html);
}
