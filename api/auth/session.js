// api/auth/session.js — combines "who's logged in" and "log out" into ONE
// serverless function (same function-count-saving reason as anilist.js).
//
//   GET  /api/auth/session                    -> { user: {...} | null }
//   POST /api/auth/session  { action:'logout' } -> clears the cookie

const { getSession, clearSessionCookie } = require('../_lib/session');

module.exports = function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'GET') {
    res.setHeader('Cache-Control', 'no-store');
    const session = getSession(req);
    if (!session) {
      res.statusCode = 200;
      return res.end(JSON.stringify({ user: null }));
    }
    res.statusCode = 200;
    return res.end(JSON.stringify({
      user: {
        id: session.uid,
        anilistId: session.anilistId,
        username: session.username,
        avatarUrl: session.avatarUrl,
      },
    }));
  }

  if (req.method === 'POST') {
    let data = '';
    req.on('data', c => { data += c; });
    req.on('end', () => {
      let body = {};
      try { body = data ? JSON.parse(data) : {}; } catch {}
      if (body.action === 'logout') {
        clearSessionCookie(res);
        res.statusCode = 200;
        return res.end(JSON.stringify({ ok: true }));
      }
      res.statusCode = 400;
      res.end(JSON.stringify({ error: 'Unknown action' }));
    });
    return;
  }

  res.statusCode = 405;
  res.end(JSON.stringify({ error: 'Method not allowed' }));
};
