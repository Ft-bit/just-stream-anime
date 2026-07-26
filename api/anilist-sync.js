// api/anilist-sync.js — reads/writes the logged-in user's AniList list
// entries on their behalf, using their stored access token.
//
// POST { action:'getStatus', mediaId }            -> current status/progress
// POST { action:'setStatus', mediaId, status }     -> update status
//   status is one of: CURRENT, PLANNING, COMPLETED, DROPPED, PAUSED, REPEATING

const { getSession } = require('./_lib/session');
const { sbFetch } = require('./_lib/supabase');

const VALID_STATUSES = ['CURRENT', 'PLANNING', 'COMPLETED', 'DROPPED', 'PAUSED', 'REPEATING'];

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', c => { data += c; });
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); }
      catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

async function getUserToken(uid) {
  const rows = await sbFetch(`/users?id=eq.${uid}&select=anilist_access_token`);
  return rows?.[0]?.anilist_access_token || null;
}

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');

  if (req.method !== 'POST') {
    res.statusCode = 405;
    return res.end(JSON.stringify({ error: 'Method not allowed' }));
  }

  const session = getSession(req);
  if (!session) {
    res.statusCode = 401;
    return res.end(JSON.stringify({ error: 'Login required' }));
  }

  let body;
  try {
    body = await readBody(req);
  } catch {
    res.statusCode = 400;
    return res.end(JSON.stringify({ error: 'Invalid request body' }));
  }

  try {
    const token = await getUserToken(session.uid);
    if (!token) {
      res.statusCode = 400;
      return res.end(JSON.stringify({
        error: 'No AniList token on file. Please log out and log back in with AniList to enable list syncing.',
      }));
    }

    // ── Get current status/progress for one anime ────────────────────────────
    if (body.action === 'getStatus') {
      const mediaId = parseInt(body.mediaId);
      if (!mediaId) {
        res.statusCode = 400;
        return res.end(JSON.stringify({ error: 'mediaId required' }));
      }
      const query = `query($mediaId:Int,$userId:Int){MediaList(mediaId:$mediaId,userId:$userId){status progress}}`;
      const r = await fetch('https://graphql.anilist.co', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json', Accept: 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ query, variables: { mediaId, userId: session.anilistId } }),
      });
      const json = await r.json();
      res.statusCode = 200;
      return res.end(JSON.stringify({ entry: json.data?.MediaList || null }));
    }

    // ── Set status (Watching / Completed / Paused / Dropped / etc.) ──────────
    if (body.action === 'setStatus') {
      const mediaId = parseInt(body.mediaId);
      const status  = body.status;
      if (!mediaId || !VALID_STATUSES.includes(status)) {
        res.statusCode = 400;
        return res.end(JSON.stringify({ error: 'Invalid mediaId or status' }));
      }
      const mutation = `mutation($mediaId:Int,$status:MediaListStatus){SaveMediaListEntry(mediaId:$mediaId,status:$status){id status progress}}`;
      const r = await fetch('https://graphql.anilist.co', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json', Accept: 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ query: mutation, variables: { mediaId, status } }),
      });
      const json = await r.json();
      if (json.errors) {
        res.statusCode = 400;
        return res.end(JSON.stringify({ error: json.errors[0]?.message || 'AniList rejected the update' }));
      }
      res.statusCode = 200;
      return res.end(JSON.stringify({ ok: true, entry: json.data?.SaveMediaListEntry }));
    }

    res.statusCode = 400;
    res.end(JSON.stringify({ error: 'Unknown action' }));
  } catch (err) {
    console.error('anilist-sync error:', err.message);
    res.statusCode = 500;
    res.end(JSON.stringify({ error: err.message }));
  }
};
