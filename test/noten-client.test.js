'use strict';

// HTTP-Client zur Notenverwaltung (server/noten/client.js). fetch wird
// ersetzt, damit ohne Netz getestet werden kann.
process.env.AUTH_MODE = 'dev';
process.env.MASTER_KEY = require('node:crypto').randomBytes(32).toString('base64');
process.env.SESSION_SECRET = 'test-secret';
process.env.NOTEN_BASE_URL = 'https://noten.example.org';
process.env.NOTEN_CLIENT_SECRET = 'gemeinsames-geheimnis';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const client = require('../server/noten/client');

const echterFetch = global.fetch;

// Ersetzt fetch durch eine Antwort und protokolliert die Aufrufe.
function stubFetch(antwort) {
  const aufrufe = [];
  global.fetch = async (url, opts) => {
    aufrufe.push({ url, opts });
    if (typeof antwort === 'function') return antwort(url, opts);
    return antwort;
  };
  return aufrufe;
}
function jsonAntwort(status, daten) {
  return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(daten) };
}

test.afterEach(() => {
  global.fetch = echterFetch;
});

test('istKonfiguriert: mit Basis-URL und Geheimnis wahr', () => {
  assert.equal(client.istKonfiguriert(), true);
});

test('klassen: schickt Bearer-Geheimnis und Kennung mit', async () => {
  const aufrufe = stubFetch(jsonAntwort(200, { klassen: [{ id: 7, name: '11a BIN' }] }));
  const daten = await client.klassen('gades');
  assert.equal(daten.klassen[0].name, '11a BIN');
  assert.equal(aufrufe.length, 1);
  assert.equal(aufrufe[0].url, 'https://noten.example.org/api/extern/klassen');
  assert.equal(aufrufe[0].opts.headers.Authorization, 'Bearer gemeinsames-geheimnis');
  assert.equal(aufrufe[0].opts.headers['X-Noten-Sub'], 'gades');
  assert.equal(aufrufe[0].opts.headers['X-Noten-Client'], 'lehrerkalender');
  // Eine Weiterleitung auf /login darf nicht automatisch verfolgt werden.
  assert.equal(aufrufe[0].opts.redirect, 'manual');
});

test('klassen: fehlendes Feld wird zu einer leeren Liste', async () => {
  stubFetch(jsonAntwort(200, { ok: true }));
  assert.deepEqual(await client.klassen('gades'), { klassen: [] });
});

test('klasse: ID wird kodiert, Antwort ausgepackt', async () => {
  const aufrufe = stubFetch(jsonAntwort(200, { klasse: { id: 7, schueler: [] } }));
  const k = await client.klasse('gades', '7/../8');
  assert.equal(k.id, 7);
  assert.equal(aufrufe[0].url, 'https://noten.example.org/api/extern/klassen/7%2F..%2F8');
});

test('404 der Notenverwaltung bleibt 404', async () => {
  stubFetch(jsonAntwort(404, { error: 'Klasse nicht gefunden' }));
  await assert.rejects(
    () => client.klasse('gades', 99),
    (e) => e.status === 404 && /Klasse nicht gefunden/.test(e.message)
  );
});

test('401 der Notenverwaltung wird zu 502 (Kopplungsfehler, kein Logout)', async () => {
  stubFetch(jsonAntwort(401, { error: 'Nicht autorisiert' }));
  await assert.rejects(
    () => client.klassen('gades'),
    (e) => e.status === 502
  );
});

test('Netzwerkfehler -> 502 mit sprechender Meldung', async () => {
  global.fetch = async () => {
    throw new Error('getaddrinfo ENOTFOUND');
  };
  await assert.rejects(
    () => client.ping(),
    (e) => e.status === 502 && /nicht erreichbar/.test(e.message)
  );
});

test('Antwort ohne JSON -> 502', async () => {
  stubFetch({ ok: true, status: 200, text: async () => '<html>Login</html>' });
  await assert.rejects(
    () => client.klassen('gades'),
    (e) => e.status === 502 && /kein JSON/.test(e.message)
  );
});

test('tokenTausch: sendet Geheimnis im Body und normalisiert die Kennung', async () => {
  const aufrufe = stubFetch(
    jsonAntwort(200, { sub: 'Gades', username: 'Gades', name: 'T. Gades', rolle: 'teacher' })
  );
  const id = await client.tokenTausch('code-1', 'https://kalender.example.org/auth/sso/callback');
  assert.deepEqual(id, {
    sub: 'gades',
    username: 'Gades',
    name: 'T. Gades',
    rolle: 'teacher',
  });
  const body = JSON.parse(aufrufe[0].opts.body);
  assert.equal(aufrufe[0].url, 'https://noten.example.org/sso/token');
  assert.equal(aufrufe[0].opts.method, 'POST');
  assert.equal(body.client_secret, 'gemeinsames-geheimnis');
  assert.equal(body.code, 'code-1');
  assert.equal(body.redirect_uri, 'https://kalender.example.org/auth/sso/callback');
});

test('tokenTausch: Antwort ohne sub -> 502', async () => {
  stubFetch(jsonAntwort(200, { username: 'gades' }));
  await assert.rejects(
    () => client.tokenTausch('c', 'u'),
    (e) => e.status === 502 && /ohne "sub"/.test(e.message)
  );
});
