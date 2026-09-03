'use strict';

// Single-Sign-on-Fluss gegen die Notenverwaltung (server/auth/sso.js).
// Die ENV-Variablen müssen VOR dem Laden von config/sso stehen.
process.env.AUTH_MODE = 'sso';
process.env.MASTER_KEY = require('node:crypto').randomBytes(32).toString('base64');
process.env.SESSION_SECRET = 'test-secret';
process.env.PUBLIC_URL = 'https://kalender.example.org';
process.env.NOTEN_BASE_URL = 'https://noten.example.org';
process.env.NOTEN_CLIENT_SECRET = 'gemeinsames-geheimnis';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const sso = require('../server/auth/sso');
const notenClient = require('../server/noten/client');
const { authConfigHandler, verifyCredentials } = require('../server/auth');

// --- Testdoppel für Request/Response ---------------------------------------
function fakeSession() {
  return {
    save(cb) {
      if (cb) cb(null);
    },
    regenerate(cb) {
      // express-session leert dabei die Session – hier genügt das Nötigste.
      delete this.sso;
      cb(null);
    },
  };
}

function fakeReq(query = {}, session = fakeSession()) {
  return {
    query,
    session,
    protocol: 'https',
    get: () => 'kalender.example.org',
  };
}

function fakeRes() {
  return {
    statusCode: 200,
    redirected: null,
    body: undefined,
    status(c) {
      this.statusCode = c;
      return this;
    },
    json(o) {
      this.body = o;
      return this;
    },
    redirect(url) {
      this.redirected = url;
      return this;
    },
  };
}

// --- Tests -----------------------------------------------------------------

test('ssoAktiv: bei AUTH_MODE=sso mit Basis-URL und Geheimnis aktiv', () => {
  assert.equal(sso.ssoAktiv(), true);
});

test('sicheresZiel: nur app-interne Pfade, kein Open Redirect', () => {
  assert.equal(sso.sicheresZiel('/#woche'), '/#woche');
  assert.equal(sso.sicheresZiel('/index.html'), '/index.html');
  assert.equal(sso.sicheresZiel('//boese.example/klau'), '/');
  assert.equal(sso.sicheresZiel('https://boese.example'), '/');
  assert.equal(sso.sicheresZiel(undefined), '/');
});

test('redirectUri: nutzt PUBLIC_URL, nicht den Host-Header', () => {
  assert.equal(sso.redirectUri(fakeReq()), 'https://kalender.example.org/auth/sso/callback');
});

test('start: legt state in der Session ab und leitet zur Notenverwaltung', () => {
  const req = fakeReq({ next: '/index.html' });
  const res = fakeRes();
  sso.startHandler(req, res);
  assert.ok(req.session.sso.state.length > 20);
  assert.equal(req.session.sso.next, '/index.html');
  const url = new URL(res.redirected);
  assert.equal(url.origin + url.pathname, 'https://noten.example.org/sso/authorize');
  assert.equal(url.searchParams.get('client_id'), 'lehrerkalender');
  assert.equal(url.searchParams.get('state'), req.session.sso.state);
  assert.equal(
    url.searchParams.get('redirect_uri'),
    'https://kalender.example.org/auth/sso/callback'
  );
});

test('callback: gültiger Code legt die Session mit der Kennung an', async () => {
  const original = notenClient.tokenTausch;
  let gesehen = null;
  notenClient.tokenTausch = async (code, uri) => {
    gesehen = { code, uri };
    return { sub: 'Gades', username: 'Gades', name: 'T. Gades', rolle: 'teacher' };
  };
  try {
    const session = fakeSession();
    session.sso = { state: 'st-1', ts: Date.now(), next: '/index.html' };
    const res = fakeRes();
    await sso.callbackHandler(fakeReq({ code: 'c-1', state: 'st-1' }, session), res);
    assert.deepEqual(gesehen, {
      code: 'c-1',
      uri: 'https://kalender.example.org/auth/sso/callback',
    });
    // Kennung wird normalisiert -> gleiche Nutzer-DB wie beim früheren LDAP-Login.
    assert.deepEqual(session.user, {
      username: 'gades',
      name: 'T. Gades',
      quelle: 'sso',
      notenRolle: 'teacher',
    });
    assert.equal(res.redirected, '/index.html');
  } finally {
    notenClient.tokenTausch = original;
  }
});

test('callback: falscher state wird abgewiesen (CSRF-Schutz)', async () => {
  const original = notenClient.tokenTausch;
  let aufgerufen = false;
  notenClient.tokenTausch = async () => {
    aufgerufen = true;
    return { sub: 'x' };
  };
  try {
    const session = fakeSession();
    session.sso = { state: 'st-echt', ts: Date.now(), next: '/' };
    const res = fakeRes();
    await sso.callbackHandler(fakeReq({ code: 'c', state: 'st-falsch' }, session), res);
    assert.equal(aufgerufen, false);
    assert.equal(session.user, undefined);
    assert.match(res.redirected, /^\/login\.html\?sso_error=/);
  } finally {
    notenClient.tokenTausch = original;
  }
});

test('callback: abgelaufener state wird abgewiesen', async () => {
  const session = fakeSession();
  session.sso = { state: 'st', ts: Date.now() - 11 * 60 * 1000, next: '/' };
  const res = fakeRes();
  await sso.callbackHandler(fakeReq({ code: 'c', state: 'st' }, session), res);
  assert.equal(session.user, undefined);
  assert.match(decodeURIComponent(res.redirected), /abgelaufen/);
});

test('callback: ohne vorherigen Start (kein state in der Session) -> Fehlerseite', async () => {
  const res = fakeRes();
  await sso.callbackHandler(fakeReq({ code: 'c', state: 'st' }), res);
  assert.match(res.redirected, /^\/login\.html\?sso_error=/);
});

test('callback: Fehler der Notenverwaltung landet als Meldung auf der Login-Seite', async () => {
  const session = fakeSession();
  session.sso = { state: 'st', ts: Date.now(), next: '/' };
  const res = fakeRes();
  await sso.callbackHandler(fakeReq({ error: 'access_denied', state: 'st' }, session), res);
  assert.match(decodeURIComponent(res.redirected), /access_denied/);
});

test('SSO ohne Fallback: Passwort-Formular ist abgeschaltet', async () => {
  await assert.rejects(
    () => verifyCredentials('gades', 'geheim'),
    (e) => e.status === 403 && /Single Sign-on/.test(e.message)
  );
  const res = fakeRes();
  authConfigHandler(fakeReq(), res);
  assert.deepEqual(res.body, {
    authMode: 'sso',
    sso: true,
    ssoStartUrl: '/auth/sso/start',
    passwortLogin: false,
    notenUrl: 'https://noten.example.org',
  });
});
