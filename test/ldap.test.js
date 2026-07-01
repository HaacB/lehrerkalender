'use strict';

// Tests für das LDAP-Modul, soweit ohne echten Verzeichnisserver prüfbar:
// das RFC-4515-Filter-Escaping (Schutz vor LDAP-Injection im Suchfilter).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { escapeFilter } = require('../server/auth/ldap');

test('escapeFilter maskiert RFC-4515-Sonderzeichen als \\hex', () => {
  assert.equal(escapeFilter('a*b(c)'), 'a\\2ab\\28c\\29');
  assert.equal(escapeFilter('a\\b'), 'a\\5cb');
  assert.equal(escapeFilter('x y'), 'x\\20y');
});

test('escapeFilter lässt harmlose Kennungen unverändert', () => {
  assert.equal(escapeFilter('mueller'), 'mueller');
  assert.equal(escapeFilter('anna.schmidt'), 'anna.schmidt');
});

test('escapeFilter verhindert Filter-Injection (Wildcard wird entschärft)', () => {
  // Eingabe "*" darf NICHT als Wildcard im Filter landen.
  const gebaut = `(sAMAccountName=${escapeFilter('*')})`;
  assert.equal(gebaut, '(sAMAccountName=\\2a)');
});
