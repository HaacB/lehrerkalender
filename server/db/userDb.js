'use strict';

// Pro-Nutzer-Datenbank: SQLite im Speicher (sql.js / WASM, keine nativen Abhängigkeiten),
// auf Platte als AES-256-GCM-verschlüsselte Datei. GCM liefert zusätzlich
// Manipulationsschutz (Auth-Tag). Der Schlüssel wird deterministisch aus
// MASTER_KEY + Username abgeleitet -> jede Nutzer-DB hat einen eigenen Schlüssel,
// der Server kann jeden Schlüssel reproduzieren (Verschlüsselung at-rest).

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const initSqlJs = require('sql.js');

const { config } = require('../config');
const { safeDbFileName, deriveDbKey } = require('./keys');

const MAGIC = Buffer.from('LKDB1'); // Dateiformat-Kennung + Version

let SQL = null; // sql.js-Modul (einmalig geladen)
const handles = new Map(); // fileName -> Handle

// Lädt das WASM-Modul einmalig beim Serverstart.
async function init() {
  if (SQL) return SQL;
  const wasmDir = path.dirname(require.resolve('sql.js/dist/sql-wasm.js'));
  SQL = await initSqlJs({ locateFile: (f) => path.join(wasmDir, f) });
  return SQL;
}

function ensureDataDir() {
  if (!fs.existsSync(config.dataDir)) fs.mkdirSync(config.dataDir, { recursive: true });
}

function encrypt(key, plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plain), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([MAGIC, iv, tag, ct]);
}

function decrypt(key, file) {
  if (file.length < MAGIC.length + 12 + 16 || !file.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw new Error('Unbekanntes/beschädigtes DB-Dateiformat');
  }
  let o = MAGIC.length;
  const iv = file.subarray(o, (o += 12));
  const tag = file.subarray(o, (o += 16));
  const ct = file.subarray(o);
  const d = crypto.createDecipheriv('aes-256-gcm', key, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(ct), d.final()]);
}

function atomicWrite(filePath, buf) {
  const tmp = filePath + '.tmp';
  fs.writeFileSync(tmp, buf);
  fs.renameSync(tmp, filePath);
}

// Öffnet (oder erstellt) die verschlüsselte SQLite-DB eines Nutzers und liefert
// ein Handle mit getAll()/setMany()/close().
function openUserDb(username) {
  if (!SQL) throw new Error('DB-Layer nicht initialisiert (init() nicht aufgerufen)');
  ensureDataDir();

  const fileName = safeDbFileName(username);
  const existing = handles.get(fileName);
  if (existing) return existing;

  const filePath = path.join(config.dataDir, fileName);
  const key = deriveDbKey(config.masterKey, username);

  let db;
  if (fs.existsSync(filePath)) {
    const plain = decrypt(key, fs.readFileSync(filePath)); // wirft bei falschem Schlüssel/Manipulation
    db = new SQL.Database(new Uint8Array(plain));
  } else {
    db = new SQL.Database();
  }
  db.run('CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)');

  const persist = () => atomicWrite(filePath, encrypt(key, Buffer.from(db.export())));
  // Neue, leere DB direkt anlegen, damit die Datei existiert.
  if (!fs.existsSync(filePath)) persist();

  const handle = {
    getAll() {
      const res = db.exec('SELECT key, value FROM kv');
      const out = {};
      if (res.length) for (const row of res[0].values) out[row[0]] = row[1];
      return out;
    },
    setMany(obj) {
      const entries = Object.entries(obj);
      if (!entries.length) return;
      db.run('BEGIN');
      try {
        const up = db.prepare(
          'INSERT INTO kv (key, value) VALUES (?, ?) ' +
            'ON CONFLICT(key) DO UPDATE SET value = excluded.value'
        );
        const del = db.prepare('DELETE FROM kv WHERE key = ?');
        for (const [k, v] of entries) {
          if (v === null || v === undefined) del.run([k]);
          else up.run([k, typeof v === 'string' ? v : JSON.stringify(v)]);
        }
        up.free();
        del.free();
        db.run('COMMIT');
      } catch (e) {
        db.run('ROLLBACK');
        throw e;
      }
      persist();
    },
    close() {
      try {
        db.close();
      } catch {
        /* ignore */
      }
      handles.delete(fileName);
    },
  };

  handles.set(fileName, handle);
  return handle;
}

function closeAll() {
  for (const h of Array.from(handles.values())) h.close();
  handles.clear();
}

module.exports = { init, openUserDb, closeAll };
