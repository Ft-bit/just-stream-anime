// api/auth/me.js — tells the frontend who (if anyone) is currently logged in.
const { getSession } = require('../_lib/session');

module.exports = function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');

  const session = getSession(req);
  if (!session) {
    res.statusCode = 200;
    res.end(JSON.stringify({ user: null }));
    return;
  }

  res.statusCode = 200;
  res.end(JSON.stringify({
    user: {
      id: session.uid,
      anilistId: session.anilistId,
      username: session.username,
      avatarUrl: session.avatarUrl,
    },
  }));
};
