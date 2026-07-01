'use strict';

// Tests für die Ableitung von Dateinamen und Schlüsseln der Pro-Nutzer-DB.
// Diese Funktionen sind sicherheitskritisch: Aus dem (LDAP-)Benutzernamen
// entstehen deterministisch Dateiname UND Verschlüsselungsschlüssel.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { normalizeUsername, safeDbFileName, deriveDbKey } = require('../server/db/keys');

test('normalizeUsername trimmt und schreibt klein', () => {
  assert.equal(normalizeUsername('  Max.Mustermann  '), 'max.mustermann');
  assert.equal(normalizeUsername('SNRD\\Anna'), 'snrd\\anna');
});

test('normalizeUsername lehnt leere/ungültige Eingaben ab', () => {
  assert.throws(() => normalizeUsername('   '), /leer/);
  assert.throws(() => normalizeUsername(42), /String/);
});

test('safeDbFileName ist deterministisch, normalisiert und endet auf .db', () => {
  const a = safeDbFileName('Max.Mustermann');
  assert.equal(a, safeDbFileName('max.mustermann')); // Groß/Kleinschreibung egal
  assert.match(a, /^[a-z0-9_.-]+-[0-9a-f]{12}\.db$/);
});

test('safeDbFileName neutralisiert Path-Traversal', () => {
  // Sicherheitseigenschaft: keine Pfadtrenner -> der Dateiname ist genau EIN
  // Segment und der aufgelöste Pfad bleibt im Datenverzeichnis (ein
  // eingebettetes ".." ohne Trenner ist harmlos).
  const dataDir = path.resolve('/var/lehrerkalender-data');
  const name = safeDbFileName('../../etc/passwd');
  assert.ok(!name.includes('/') && !name.includes('\\'), 'kein Pfadtrenner');
  assert.match(name, /\.db$/);
  const resolved = path.resolve(dataDir, name);
  assert.ok(resolved.startsWith(dataDir + path.sep), 'bleibt im Datenverzeichnis');
});

test('safeDbFileName kollidiert nicht bei ähnlichen Namen (Hash-Suffix)', () => {
  // "a.b" und "a_b" ergeben denselben Slug, müssen sich aber unterscheiden.
  assert.notEqual(safeDbFileName('a.b'), safeDbFileName('a_b'));
});

test('deriveDbKey liefert 32 Byte, deterministisch je Nutzer', () => {
  const mk = Buffer.alloc(32, 7).toString('base64');
  const k1 = deriveDbKey(mk, 'anna');
  const k2 = deriveDbKey(mk, 'Anna'); // wird normalisiert -> selber Schlüssel
  const k3 = deriveDbKey(mk, 'bernd');
  assert.equal(k1.length, 32);
  assert.ok(k1.equals(k2), 'gleicher Nutzer -> gleicher Schlüssel');
  assert.ok(!k1.equals(k3), 'anderer Nutzer -> anderer Schlüssel');
});

test('deriveDbKey hängt am MASTER_KEY (anderer Master -> anderer Schlüssel)', () => {
  const a = deriveDbKey(Buffer.alloc(32, 1).toString('base64'), 'anna');
  const b = deriveDbKey(Buffer.alloc(32, 2).toString('base64'), 'anna');
  assert.ok(!a.equals(b));
});
