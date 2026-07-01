'use strict';

// Auth-Fluss im ldap-Modus. Das echte LDAP-Modul wird durch einen Stub ersetzt,
// damit kein Verzeichnisserver nötig ist. Geprüft wird die Integration in
// verifyCredentials/loginHandler: stabile Kennung, 401 bei falschen Daten,
// 502 bei technischen Fehlern.
process.env.AUTH_MODE = 'ldap';
process.env.MASTER_KEY = require('node:crypto').randomBytes(32).toString('base64');
process.env.SESSION_SECRET = 'test-secret';
process.env.LDAP_URL = 'ldaps://dc.schule.local:636';
process.env.LDAP_BASE_DN = 'DC=schule,DC=local';
process.env.LDAP_BIND_USER_TEMPLATE = 'SNRD\\{{username}}';

const { test } = require('node:test');
const assert = require('node:assert/strict');

// LDAP-Modul stubben, BEVOR auth/index.js es (lazy) per require lädt.
const ldapPath = require.resolve('../server/auth/ldap.js');
require.cache[ldapPath] = {
  id: ldapPath,
  filename: ldapPath,
  loaded: true,
  exports: {
    async authenticate(username, password) {
      if (username === 'MUELLER' && password === 'right') {
        return { loginSub: 'mueller', name: 'Anna Müller' };
      }
      if (username === 'boom') {
        const e = new Error('unreachable');
        e.status = 502;
        throw e;
      }
      return null; // falsche Anmeldedaten
    },
  },
};

const { verifyCredentials, loginHandler } = require('../server/auth');

function fakeRes() {
  return {
    statusCode: 200,
    body: undefined,
    status(c) {
      this.statusCode = c;
      return this;
    },
    json(o) {
      this.body = o;
      return this;
    },
  };
}

test('ldap: Erfolg -> stabile (normalisierte) Kennung + Anzeigename', async () => {
  // Eingabe "MUELLER", AD liefert loginSub "mueller" -> username wird "mueller".
  assert.deepEqual(await verifyCredentials('MUELLER', 'right'), {
    username: 'mueller',
    name: 'Anna Müller',
  });
});

test('ldap: falsche Anmeldedaten -> 401', async () => {
  await assert.rejects(
    () => verifyCredentials('MUELLER', 'wrong'),
    (e) => e.status === 401
  );
});

test('ldap: technischer Fehler wird als 502 durchgereicht', async () => {
  await assert.rejects(
    () => verifyCredentials('boom', 'x'),
    (e) => e.status === 502
  );
});

test('loginHandler: erfolgreicher LDAP-Login setzt Session (username + name)', async () => {
  const res = fakeRes();
  const req = { body: { username: 'MUELLER', password: 'right' }, session: {} };
  await loginHandler(req, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { username: 'mueller', name: 'Anna Müller' });
  assert.equal(req.session.user.username, 'mueller');
});

test('loginHandler: technischer LDAP-Fehler -> 502', async () => {
  const res = fakeRes();
  await loginHandler({ body: { username: 'boom', password: 'x' }, session: {} }, res);
  assert.equal(res.statusCode, 502);
});
