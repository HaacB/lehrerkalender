'use strict';

// Tests der Konfigurations-Validierung. validate() beendet bei Fehlern den
// Prozess (process.exit(1)) — deshalb wird jeder Fall in einem eigenen
// Kindprozess ausgeführt und über Exit-Code/stderr geprüft.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

const CONFIG = path.join(__dirname, '..', 'server', 'config.js');
const MK = require('node:crypto').randomBytes(32).toString('base64');

function runValidate(env) {
  return execFileSync(
    process.execPath,
    ['-e', `require(${JSON.stringify(CONFIG)}).validate(); console.log('ok')`],
    {
      // Basis-Umgebung leeren, damit nur die Test-Werte zählen (keine geerbte .env-Config).
      env: { PATH: process.env.PATH, MASTER_KEY: MK, SESSION_SECRET: 's', ...env },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );
}

test('validate: gültige Direkt-Bind-Konfiguration wird akzeptiert', () => {
  const out = runValidate({
    AUTH_MODE: 'ldap',
    LDAP_URL: 'ldaps://dc:636',
    LDAP_BASE_DN: 'DC=x',
    LDAP_BIND_USER_TEMPLATE: 'SNRD\\{{username}}',
  });
  assert.match(out, /ok/);
});

test('validate: Service-Modus ohne Bind-Konto scheitert', () => {
  assert.throws(
    () => runValidate({ AUTH_MODE: 'ldap', LDAP_URL: 'ldaps://dc:636', LDAP_BASE_DN: 'DC=x' }),
    (e) => e.status === 1 && /LDAP_BIND_DN/.test(String(e.stderr))
  );
});

test('validate: ldap-Modus ohne LDAP_BASE_DN scheitert', () => {
  assert.throws(
    () =>
      runValidate({
        AUTH_MODE: 'ldap',
        LDAP_URL: 'ldaps://dc:636',
        LDAP_BIND_USER_TEMPLATE: 'SNRD\\{{username}}',
      }),
    (e) => e.status === 1 && /LDAP_BASE_DN/.test(String(e.stderr))
  );
});

test('validate: fehlender MASTER_KEY scheitert', () => {
  assert.throws(
    () => runValidate({ MASTER_KEY: '', AUTH_MODE: 'dev' }),
    (e) => e.status === 1 && /MASTER_KEY/.test(String(e.stderr))
  );
});

test('validate: unbekannter AUTH_MODE scheitert', () => {
  assert.throws(
    () => runValidate({ AUTH_MODE: 'foo' }),
    (e) => e.status === 1 && /AUTH_MODE/.test(String(e.stderr))
  );
});
