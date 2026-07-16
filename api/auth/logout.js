// api/auth/logout.js — clears the session cookie, logging the user out.
const { clearSessionCookie } = require('../_lib/session');

module.exports = function handler(req, res) {
  clearSessionCookie(res);
  res.setHeader('Content-Type', 'application/json');
  res.statusCode = 200;
  res.end(JSON.stringify({ ok: true }));
};
