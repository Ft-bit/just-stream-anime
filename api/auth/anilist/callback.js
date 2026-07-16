// api/auth/anilist/callback.js
// Step 2 of AniList OAuth: AniList redirects here with a ?code=...
// We exchange it for an access token, fetch the user's AniList profile,
// upsert them into our `users` table, and set a signed session cookie.

const { setSessionCookie } = require('../../_lib/session');
const { sbFetch } = require('../../_lib/supabase');

const SITE_URL = 'https://jsanime.site';

module.exports = async function handler(req, res) {
  const code = req.query.code;
  if (!code) {
    res.writeHead(302, { Location: SITE_URL });
    return res.end();
  }

  try {
    // 1. Exchange the code for an access token
    const tokenRes = await fetch('https://anilist.co/api/v2/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        client_id: process.env.ANILIST_CLIENT_ID,
        client_secret: process.env.ANILIST_CLIENT_SECRET,
        redirect_uri: `${SITE_URL}/api/auth/anilist/callback`,
        code,
      }),
    });
    const tokenData = await tokenRes.json();
    const accessToken = tokenData.access_token;
    if (!accessToken) throw new Error('No access token returned from AniList');

    // 2. Fetch the user's AniList profile using that token
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
    if (!viewer) throw new Error('Could not fetch AniList profile');

    // 3. Upsert the user into Supabase (create if new, update if returning)
    const upserted = await sbFetch('/users?on_conflict=anilist_id', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
      body: JSON.stringify({
        anilist_id: viewer.id,
        username: viewer.name,
        avatar_url: viewer.avatar?.medium || null,
        last_login_at: new Date().toISOString(),
      }),
    });
    const userRow = Array.isArray(upserted) ? upserted[0] : upserted;

    // 4. Set the session cookie and send the user back to the site
    setSessionCookie(res, {
      uid: userRow.id,
      anilistId: userRow.anilist_id,
      username: userRow.username,
      avatarUrl: userRow.avatar_url,
    });

    res.writeHead(302, { Location: SITE_URL });
    res.end();
  } catch (err) {
    console.error('AniList callback error:', err.message);
    res.writeHead(302, { Location: `${SITE_URL}?login_error=1` });
    res.end();
  }
};
