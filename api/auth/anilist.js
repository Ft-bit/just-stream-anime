// api/auth/anilist.js — combines the login redirect AND the OAuth callback
// into ONE serverless function (Vercel Hobby plan caps at 12 functions total,
// so this file does double duty based on whether a ?code= is present).
//
// Flow:
//   GET /api/auth/anilist?from=/anime/21/one-piece
//     -> no ?code -> redirect to AniList, remembering where the user came
//        from via the OAuth "state" param
//   GET /api/auth/anilist?code=...&state=%2Fanime%2F21%2Fone-piece
//     -> AniList sends the user back here after they approve -> exchange
//        code, log them in, then send them back to that exact page
//
// NOTE: as of this version, we now also STORE the AniList access token in
// the users table (anilist_access_token column). This lets other backend
// routes (e.g. api/anilist-sync.js) update the user's AniList list on
// their behalf later — marking anime as Watching/Completed/etc. The token
// is never sent to the frontend or included in the session cookie.
//
// IMPORTANT: your AniList OAuth app's "Redirect URL" must be set to EXACTLY:
//   https://jsanime.site/api/auth/anilist

const { setSessionCookie } = require('../_lib/session');
const { sbFetch } = require('../_lib/supabase');

const SITE_URL = 'https://jsanime.site';
const REDIRECT_URI = `${SITE_URL}/api/auth/anilist`;

function safeReturnPath(raw) {
  if (!raw) return '/';
  try {
    const decoded = decodeURIComponent(raw);
    if (decoded.startsWith('/') && !decoded.startsWith('//')) return decoded;
  } catch {}
  return '/';
}

module.exports = async function handler(req, res) {
  const code = req.query.code;

  if (!code) {
    const clientId = process.env.ANILIST_CLIENT_ID;
    if (!clientId) {
      res.statusCode = 500;
      return res.end('Missing ANILIST_CLIENT_ID env var');
    }

    let returnPath = '/';
    const fromParam = req.query.from;
    if (fromParam) {
      returnPath = safeReturnPath(fromParam);
    } else if (req.headers.referer) {
      try {
        const u = new URL(req.headers.referer);
        returnPath = safeReturnPath(u.pathname + u.search);
      } catch {}
    }

    const authorizeUrl =
      'https://anilist.co/api/v2/oauth/authorize' +
      `?client_id=${encodeURIComponent(clientId)}` +
      `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
      `&response_type=code` +
      `&state=${encodeURIComponent(returnPath)}`;

    res.writeHead(302, { Location: authorizeUrl });
    return res.end();
  }

  const returnPath = safeReturnPath(req.query.state);

  try {
    const tokenRes = await fetch('https://anilist.co/api/v2/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        client_id: process.env.ANILIST_CLIENT_ID,
        client_secret: process.env.ANILIST_CLIENT_SECRET,
        redirect_uri: REDIRECT_URI,
        code,
      }),
    });
    const tokenData = await tokenRes.json();
    const accessToken = tokenData.access_token;
    if (!accessToken) throw new Error('No access token returned from AniList: ' + JSON.stringify(tokenData));

    const query = `query { Viewer { id name avatar { medium } } }`;
    const viewerRes = await fetch('https://graphql.anilist.co', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ query }),
    });
    const viewerJson = await viewerRes.json();
    const viewer = viewerJson?.data?.Viewer;
    if (!viewer) throw new Error('Could not fetch AniList profile: ' + JSON.stringify(viewerJson));

    // Store the access token so future requests can update this user's
    // AniList list on their behalf (marking anime Watching/Completed/etc).
    const upserted = await sbFetch('/users?on_conflict=anilist_id', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
      body: JSON.stringify({
        anilist_id: viewer.id,
        username: viewer.name,
        avatar_url: viewer.avatar?.medium || null,
        anilist_access_token: accessToken,
        last_login_at: new Date().toISOString(),
      }),
    });
    const userRow = Array.isArray(upserted) ? upserted[0] : upserted;

    setSessionCookie(res, {
      uid: userRow.id,
      anilistId: userRow.anilist_id,
      username: userRow.username,
      avatarUrl: userRow.avatar_url,
    });

    res.writeHead(302, { Location: `${SITE_URL}${returnPath}` });
    res.end();
  } catch (err) {
    console.error('AniList auth error:', err.message);
    const sep = returnPath.includes('?') ? '&' : '?';
    res.writeHead(302, { Location: `${SITE_URL}${returnPath}${sep}login_error=1` });
    res.end();
  }
};
