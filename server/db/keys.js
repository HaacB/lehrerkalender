'use strict';

const crypto = require('crypto');

// Normalisiert einen (LDAP-)Username zu einer eindeutigen, kollisionsfreien
// Kennung, die als Grundlage für Dateiname UND Schlüsselableitung dient.
// Wichtig: Für den Schlüssel und den Dateinamen nutzen wir den ORIGINAL-Username
// (lowercase) als Salt bzw. Basis, damit sich beides deterministisch reproduzieren
// lässt. Der Dateiname wird zusätzlich gegen Path-Traversal abgesichert.
function normalizeUsername(username) {
  if (typeof username !== 'string') throw new Error('username muss ein String sein');
  const u = username.trim().toLowerCase();
  if (!u) throw new Error('username ist leer');
  return u;
}

// Erzeugt einen sicheren Dateinamen aus dem LDAP-Username.
// - Whitelist [a-z0-9_.-], alles andere -> "_"
// - kurzer Hash-Suffix aus dem Original-Username verhindert Kollisionen
//   (z. B. "a.b" vs "a_b") und Path-Traversal ("../" wird neutralisiert).
function safeDbFileName(username) {
  const u = normalizeUsername(username);
  const slug = u.replace(/[^a-z0-9_.-]/g, '_').replace(/^\.+/, '_').slice(0, 48) || 'user';
  const suffix = crypto.createHash('sha256').update(u).digest('hex').slice(0, 12);
  return `${slug}-${suffix}.db`;
}

// Leitet aus dem Master-Key + Username einen 32-Byte DB-Schlüssel ab (HKDF-SHA256).
// Jeder Nutzer bekommt so einen eigenen Schlüssel, der Server kann aber jeden
// Schlüssel deterministisch reproduzieren (at-rest-Modell).
function deriveDbKey(masterKeyB64, username) {
  const u = normalizeUsername(username);
  const master = Buffer.from(masterKeyB64, 'base64');
  const salt = Buffer.from(`lehrerkalender:${u}`, 'utf8');
  const info = Buffer.from('lehrerkalender-db-key-v1', 'utf8');
  const key = crypto.hkdfSync('sha256', master, salt, info, 32);
  return Buffer.from(key); // -> 32 Byte
}

module.exports = { normalizeUsername, safeDbFileName, deriveDbKey };
