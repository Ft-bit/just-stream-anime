// api/auth/anilist/login.js
// Step 1 of AniList OAuth: redirect the user to AniList's authorize page.
// User clicks "Login with AniList" on the site -> hits this endpoint -> AniList.

module.exports = function handler(req, res) {
  const clientId = process.env.ANILIST_CLIENT_ID;
  const redirectUri = 'https://jsanime.site/api/auth/anilist/callback';

  if (!clientId) {
    res.statusCode = 500;
    res.end('Missing ANILIST_CLIENT_ID env var');
    return;
  }

  const authorizeUrl =
    'https://anilist.co/api/v2/oauth/authorize' +
    `?client_id=${encodeURIComponent(clientId)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&response_type=code`;

  res.writeHead(302, { Location: authorizeUrl });
  res.end();
};
