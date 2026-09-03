'use strict';

// Single Sign-on gegen die Notenverwaltung (noten_webapp).
//
// Ablauf (Authorization-Code-Flow mit gemeinsamem Geheimnis, bewusst schlank
// gehalten – beide Apps gehören derselben Schule und sprechen über HTTPS):
//
//   1. Browser  -> GET  /auth/sso/start
//                  Kalender merkt sich einen Zufalls-`state` in der Session und
//                  leitet weiter an  <Noten>/sso/authorize
//   2. Noten    -> ist dort niemand angemeldet, erscheint der Noten-Login;
//                  danach Weiterleitung an  /auth/sso/callback?code=…&state=…
//   3. Kalender -> tauscht den Einmal-Code SERVER-ZU-SERVER gegen die Identität
//                  ( POST <Noten>/sso/token ) und legt die eigene Session an.
//
// Der Code ist einmalig und kurzlebig; das Geheimnis verlässt nie den Server.
// Die Kennung (`sub`) ist bei AD-Konten der kleingeschriebene sAMAccountName —
// exakt die Kennung, aus der auch bisher Dateiname und Schlüssel der
// Nutzer-DB abgeleitet werden (server/db/keys.js). Ein Konto, das sich früher
// per LDAP angemeldet hat, findet nach der SSO-Umstellung also seine Daten
// wieder.

const crypto = require('crypto');
const { config } = require('../config');
const notenClient = require('../noten/client');
const { normalizeUsername } = require('../db/keys');

const STATE_TTL_MS = 10 * 60 * 1000; // 10 Minuten zwischen Start und Rücksprung
const CALLBACK_PFAD = '/auth/sso/callback';

function ssoAktiv() {
  return config.authMode === 'sso' && notenClient.istKonfiguriert();
}

// Basis-URL dieser App: bevorzugt konfiguriert (PUBLIC_URL), sonst aus dem
// Request abgeleitet (hinter dem Reverse-Proxy dank `trust proxy` korrekt).
function eigeneBasisUrl(req) {
  if (config.publicUrl) return config.publicUrl;
  return `${req.protocol}://${req.get('host')}`;
}

function redirectUri(req) {
  return eigeneBasisUrl(req) + CALLBACK_PFAD;
}

// Nur app-interne Ziele zulassen (Open-Redirect-Schutz): "/…" ja, "//host" nein.
function sicheresZiel(next) {
  const s = String(next || '');
  return /^\/(?!\/)[^\s]*$/.test(s) ? s : '/';
}

// GET /auth/sso/start – Weiterleitung zur Anmeldung der Notenverwaltung.
function startHandler(req, res) {
  if (!ssoAktiv()) {
    return res.status(404).json({ error: 'Single Sign-on ist nicht aktiviert' });
  }
  const state = crypto.randomBytes(32).toString('base64url');
  req.session.sso = { state, ts: Date.now(), next: sicheresZiel(req.query.next) };
  const url =
    `${config.noten.publicUrl || config.noten.baseUrl}/sso/authorize` +
    `?response_type=code&client_id=${encodeURIComponent(config.noten.clientId)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri(req))}` +
    `&state=${encodeURIComponent(state)}`;
  // Die Session muss VOR der Weiterleitung geschrieben sein, sonst kommt der
  // Nutzer ohne gespeicherten state zurück (Datei-Store schreibt asynchron).
  req.session.save((err) => {
    if (err) {
      console.error('SSO-Start: Session konnte nicht gespeichert werden:', err.message);
      return res.redirect('/login.html?sso_error=' + encodeURIComponent('Session-Fehler'));
    }
    res.redirect(url);
  });
}

// GET /auth/sso/callback?code=…&state=… – Rücksprung von der Notenverwaltung.
async function callbackHandler(req, res) {
  if (!ssoAktiv()) {
    return res.status(404).json({ error: 'Single Sign-on ist nicht aktiviert' });
  }
  const fehlerZurueck = (msg) =>
    res.redirect('/login.html?sso_error=' + encodeURIComponent(msg));

  const erwartet = req.session.sso;
  const ziel = sicheresZiel(erwartet && erwartet.next);
  delete req.session.sso; // state ist einmalig

  const { code, state, error } = req.query || {};
  if (error) return fehlerZurueck(String(error).slice(0, 120));
  if (!code || !state) return fehlerZurueck('Unvollständige Antwort der Notenverwaltung');
  if (!erwartet || !erwartet.state) return fehlerZurueck('Anmeldung abgelaufen – bitte erneut versuchen');
  if (Date.now() - erwartet.ts > STATE_TTL_MS) {
    return fehlerZurueck('Anmeldung abgelaufen – bitte erneut versuchen');
  }
  const a = Buffer.from(String(state));
  const b = Buffer.from(erwartet.state);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return fehlerZurueck('Sicherheitsprüfung fehlgeschlagen (state)');
  }

  let identitaet;
  try {
    identitaet = await notenClient.tokenTausch(String(code), redirectUri(req));
  } catch (err) {
    console.error('SSO-Tokentausch fehlgeschlagen:', err.message);
    return fehlerZurueck('Anmeldung über die Notenverwaltung fehlgeschlagen');
  }

  const username = normalizeUsername(identitaet.sub);
  // Session-Fixation vermeiden: nach erfolgreicher Anmeldung neue Session-ID.
  req.session.regenerate((err) => {
    if (err) {
      console.error('SSO: Session-Regenerierung fehlgeschlagen:', err.message);
      return fehlerZurueck('Session-Fehler');
    }
    req.session.user = {
      username,
      name: identitaet.name || '',
      quelle: 'sso',
      notenRolle: identitaet.rolle,
    };
    req.session.save(() => res.redirect(ziel));
  });
}

module.exports = { ssoAktiv, startHandler, callbackHandler, sicheresZiel, redirectUri };
