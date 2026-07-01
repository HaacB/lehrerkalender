'use strict';

// Tests für den persistenten Session-Store (session-file-store). Geprüft wird
// die isolierte Factory: korrekter Ablagepfad unter DATA_DIR und ein gültiger
// express-session-Store — ohne echten Server (kein app.listen/LDAP nötig).
//
// DATA_DIR auf ein temporäres Verzeichnis setzen, BEVOR config/sessionStore
// geladen werden — der FileStore legt seinen Ordner beim Erzeugen synchron an.
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');

const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'lk-sess-'));
process.env.DATA_DIR = tmpBase;
process.env.MASTER_KEY = crypto.randomBytes(32).toString('base64');
process.env.SESSION_SECRET = 'test-secret';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const session = require('express-session');
const { createSessionStore, sessionsDir } = require('../server/sessionStore');

test('sessionsDir liegt als sessions/ unter DATA_DIR', () => {
  assert.equal(sessionsDir, path.join(path.resolve(tmpBase), 'sessions'));
});

test('createSessionStore liefert einen gültigen express-session-Store', () => {
  const store = createSessionStore(session);
  // FileStore erbt von session.Store -> volle Store-API vorhanden.
  assert.ok(store instanceof session.Store);
  assert.equal(typeof store.get, 'function');
  assert.equal(typeof store.set, 'function');
  assert.equal(typeof store.destroy, 'function');
});

test('createSessionStore legt das Ablageverzeichnis synchron an', () => {
  createSessionStore(session);
  assert.ok(fs.existsSync(sessionsDir), 'sessions-Verzeichnis existiert');
});
