'use strict';

// Austauschbare Auth-Schicht: dev (Test-Login), ldap oder sso (Anmeldung über
// die Notenverwaltung, siehe ./sso.js).
// Exportiert Login-Handler, Logout-Handler und die requireAuth-Middleware.

const { config } = require('../config');
const { normalizeUsername } = require('../db/keys');

// Welcher Modus prüft Benutzername/Passwort im Formular? Bei AUTH_MODE=sso ist
// das der konfigurierte Notausgang (SSO_FALLBACK_MODE), sonst der AUTH_MODE
// selbst. 'none' = es gibt kein Passwort-Formular.
function passwortModus() {
  return config.authMode === 'sso' ? config.ssoFallbackMode : config.authMode;
}

async function verifyCredentials(username, password) {
  const modus = passwortModus();
  if (modus === 'none') {
    const e = new Error(
      'Anmeldung nur über die Notenverwaltung möglich (Single Sign-on).'
    );
    e.status = 403;
    throw e;
  }
  if (modus === 'ldap') {
    const ldap = require('./ldap');
    // ldap.authenticate liefert bei Erfolg { loginSub, name? }, bei falschen
    // Anmeldedaten null und wirft bei technischen Fehlern (status=502).
    const result = await ldap.authenticate(username, password);
    if (!result) {
      const e = new Error('Benutzername oder Passwort falsch');
      e.status = 401;
      throw e;
    }
    // Die stabile Verzeichnis-Kennung (loginSub) ist die Identität: Aus ihr
    // werden Dateiname und Schlüssel der Nutzer-DB abgeleitet. Normalisieren
    // hält sie unabhängig von der Schreibweise bei der Eingabe stabil.
    return { username: normalizeUsername(result.loginSub), name: result.name };
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
    // Anzeigename (falls vom Verzeichnis geliefert) für die Oberfläche mitführen.
    req.session.user = { username: user.username, name: user.name, quelle: 'lokal' };
    return res.json({ username: user.username, name: user.name });
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

// GET /auth/config – öffentlich: Was bietet die Anmeldeseite an?
// (Ob es einen SSO-Knopf gibt, ob zusätzlich ein Passwort-Formular existiert.)
function authConfigHandler(req, res) {
  const sso = require('./sso');
  res.json({
    authMode: config.authMode,
    sso: sso.ssoAktiv(),
    ssoStartUrl: '/auth/sso/start',
    passwortLogin: passwortModus() !== 'none',
    notenUrl: config.noten.publicUrl || null,
  });
}

module.exports = {
  loginHandler,
  logoutHandler,
  requireAuth,
  verifyCredentials,
  authConfigHandler,
  passwortModus,
};
