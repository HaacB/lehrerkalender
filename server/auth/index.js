'use strict';

// Austauschbare Auth-Schicht: dev (Test-Login) oder ldap.
// Exportiert Login-Handler, Logout-Handler und die requireAuth-Middleware.

const { config } = require('../config');
const { normalizeUsername } = require('../db/keys');

async function verifyCredentials(username, password) {
  if (config.authMode === 'ldap') {
    const ldap = require('./ldap');
    return ldap.authenticate(username, password);
  }

  // dev-Modus: kein echter Passwort-Check. Optional per Allowlist eingrenzen.
  const u = normalizeUsername(username);
  if (config.devAllowedUsers.length && !config.devAllowedUsers.includes(u)) {
    const e = new Error('Username nicht in DEV_ALLOWED_USERS');
    e.status = 403;
    throw e;
  }
  return { username: u };
}

// POST /login  { username, password }
async function loginHandler(req, res) {
  const { username, password } = req.body || {};
  if (!username) {
    return res.status(400).json({ error: 'Username erforderlich' });
  }
  try {
    const user = await verifyCredentials(username, password || '');
    req.session.user = { username: user.username };
    return res.json({ username: user.username });
  } catch (err) {
    const status = err.status || 401;
    if (status >= 500) console.error('Auth-Fehler:', err.cause || err);
    return res.status(status).json({ error: err.message || 'Anmeldung fehlgeschlagen' });
  }
}

// POST /logout
function logoutHandler(req, res) {
  req.session.destroy(() => {
    res.clearCookie('lk.sid');
    res.json({ ok: true });
  });
}

// Schützt /api/* – bei fehlender Session 401 (JSON).
function requireAuth(req, res, next) {
  if (req.session && req.session.user && req.session.user.username) {
    return next();
  }
  return res.status(401).json({ error: 'Nicht angemeldet' });
}

module.exports = { loginHandler, logoutHandler, requireAuth, verifyCredentials };
