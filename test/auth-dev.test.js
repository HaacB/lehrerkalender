'use strict';

// Auth-Fluss im dev-Modus: Allowlist, Session-Handling und die Middleware.
// AUTH_MODE muss VOR dem Laden von config/auth gesetzt sein.
process.env.AUTH_MODE = 'dev';
process.env.MASTER_KEY = require('node:crypto').randomBytes(32).toString('base64');
process.env.SESSION_SECRET = 'test-secret';
process.env.DEV_ALLOWED_USERS = 'alice,bob';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { verifyCredentials, requireAuth, loginHandler, logoutHandler } = require('../server/auth');

function fakeRes() {
  return {
    statusCode: 200,
    body: undefined,
    cleared: [],
    status(c) {
      this.statusCode = c;
      return this;
    },
    json(o) {
      this.body = o;
      return this;
    },
    clearCookie(n) {
      this.cleared.push(n);
      return this;
    },
  };
}

test('dev: erlaubter Nutzer wird normalisiert akzeptiert', async () => {
  assert.deepEqual(await verifyCredentials('Alice', 'egal'), { username: 'alice' });
});

test('dev: Nutzer außerhalb der Allowlist -> 403', async () => {
  await assert.rejects(
    () => verifyCredentials('mallory', 'x'),
    (e) => e.status === 403
  );
});

test('requireAuth: ohne Session -> 401, kein next()', () => {
  const res = fakeRes();
  let nexted = false;
  requireAuth({ session: {} }, res, () => {
    nexted = true;
  });
  assert.equal(nexted, false);
  assert.equal(res.statusCode, 401);
});

test('requireAuth: mit gültiger Session -> next()', () => {
  let nexted = false;
  requireAuth({ session: { user: { username: 'alice' } } }, fakeRes(), () => {
    nexted = true;
  });
  assert.equal(nexted, true);
});

test('loginHandler: fehlender Username -> 400', async () => {
  const res = fakeRes();
  await loginHandler({ body: {}, session: {} }, res);
  assert.equal(res.statusCode, 400);
});

test('loginHandler: dev-Login setzt Session und antwortet mit username', async () => {
  const res = fakeRes();
  const req = { body: { username: 'Bob' }, session: {} };
  await loginHandler(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.username, 'bob');
  assert.equal(req.session.user.username, 'bob');
});

test('loginHandler: Allowlist-Verstoß wird als 403 beantwortet', async () => {
  const res = fakeRes();
  await loginHandler({ body: { username: 'mallory' }, session: {} }, res);
  assert.equal(res.statusCode, 403);
});

test('logoutHandler: zerstört Session und löscht das Cookie', () => {
  const res = fakeRes();
  logoutHandler({ session: { destroy: (cb) => cb() } }, res);
  assert.deepEqual(res.cleared, ['lk.sid']);
  assert.equal(res.body.ok, true);
});
