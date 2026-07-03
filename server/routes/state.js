'use strict';

// API für den Nutzer-Zustand. Die Pro-Nutzer-DB verhält sich wie ein
// serverseitiges, verschlüsseltes localStorage (kv-Tabelle).

const express = require('express');
const { openUserDb } = require('../db/userDb');

const router = express.Router();

// Werte werden als JSON-Strings gespeichert (so wie der Client sie serialisiert).
// Obergrenze gegen versehentlich riesige Payloads.
const MAX_VALUE_BYTES = 5 * 1024 * 1024;

function currentUser(req) {
  return req.session.user.username;
}

// GET /api/me -> wer bin ich
router.get('/me', (req, res) => {
  const user = req.session.user;
  res.json({ username: user.username, name: user.name });
});

// GET /api/state -> alle kv-Paare als { key: jsonString }
router.get('/state', (req, res, next) => {
  try {
    const db = openUserDb(currentUser(req));
    res.json(db.getAll());
  } catch (err) {
    next(err);
  }
});

// PUT /api/state -> Batch speichern. Body: { key: value, ... }
//   value = String (bereits JSON) wird gespeichert; null/undefined löscht die Zeile.
router.put('/state', (req, res, next) => {
  try {
    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return res.status(400).json({ error: 'Body muss ein Objekt sein' });
    }
    for (const [k, v] of Object.entries(body)) {
      if (typeof k !== 'string' || !k) {
        return res.status(400).json({ error: 'Ungültiger Schlüssel' });
      }
      if (v !== null && v !== undefined) {
        const s = typeof v === 'string' ? v : JSON.stringify(v);
        if (Buffer.byteLength(s, 'utf8') > MAX_VALUE_BYTES) {
          return res.status(413).json({ error: `Wert für "${k}" zu groß` });
        }
      }
    }
    const db = openUserDb(currentUser(req));
    db.setMany(body);
    res.json({ ok: true, count: Object.keys(body).length });
  } catch (err) {
    next(err);
  }
});

// PUT /api/kv/:key -> Einzelwert speichern. Body: { value } (String oder null)
router.put('/kv/:key', (req, res, next) => {
  try {
    const key = req.params.key;
    const value = req.body ? req.body.value : undefined;
    if (value !== null && value !== undefined) {
      const s = typeof value === 'string' ? value : JSON.stringify(value);
      if (Buffer.byteLength(s, 'utf8') > MAX_VALUE_BYTES) {
        return res.status(413).json({ error: 'Wert zu groß' });
      }
    }
    const db = openUserDb(currentUser(req));
    db.setMany({ [key]: value === undefined ? null : value });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// GET /api/bbz-ferien?sj=2026/27
// Holt die Schulferien des BBZ (weichen von der Landesplanung ab) serverseitig
// von der Homepage (Ninja-Table-JSON). Serverseitig, weil der Browser die
// fremde Domain wegen CORS nicht direkt abrufen darf. Antwort:
//   { sj, tableId, ferien: [ { l, s: 'YYYY-MM-DD', e: 'YYYY-MM-DD' } ] }
const BBZ_FERIEN_PAGE =
  'https://www.bbz-rd-eck.de/online-sekretariat/pruefungstermine-fristen-und-schulferien/';
const BBZ_UA = { 'User-Agent': 'Mozilla/5.0 (Lehrerkalender)' };

function bbzDeToIso(v) {
  const m = String(v || '').match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : null;
}

router.get('/bbz-ferien', async (req, res) => {
  const sj = String(req.query.sj || '').trim();
  const m = sj.match(/^(\d{4})\/(\d{2,4})$/);
  if (!m) return res.status(400).json({ error: 'sj muss das Format 2026/27 haben' });
  const full = `${m[1]}/${m[2].length === 2 ? '20' + m[2] : m[2]}`; // 2026/2027
  try {
    // 1) Tabellen-ID des Schuljahres von der Seite ermitteln (robust gegen ID-Wechsel).
    const page = await (await fetch(BBZ_FERIEN_PAGE, { headers: BBZ_UA })).text();
    const idx = page.indexOf('Schulferien ' + full);
    let tableId = null;
    if (idx >= 0) {
      const seg = page.slice(idx, idx + 2500);
      const tm = seg.match(/footable_id="(\d+)"/) || seg.match(/foo_table_(\d+)/);
      if (tm) tableId = tm[1];
    }
    if (!tableId) {
      return res.status(404).json({ error: `Schuljahr ${full} auf der BBZ-Seite nicht gefunden` });
    }
    // 2) Tabellendaten (JSON) holen und in Ferienbloecke umwandeln.
    const dataUrl =
      'https://www.bbz-rd-eck.de/wp-admin/admin-ajax.php' +
      '?action=wp_ajax_ninja_tables_public_action&table_id=' + tableId +
      '&target_action=get-all-data&default_sorting=old_first';
    const raw = await (await fetch(dataUrl, { headers: BBZ_UA })).json();
    const ferien = (Array.isArray(raw) ? raw : [])
      .map((r) => (r && r.value) || {})
      .map((v) => ({
        l: String(v.ferien || '').replace(/\s*\d{4}\s*$/, '').trim(), // "Herbstferien 2026" -> "Herbstferien"
        s: bbzDeToIso(v.erster_ferientag),
        e: bbzDeToIso(v.letzter_ferientag),
      }))
      .filter((x) => x.s && x.e && x.l);
    res.json({ sj, tableId, ferien });
  } catch (err) {
    console.error('bbz-ferien:', err && err.message ? err.message : err);
    res.status(502).json({ error: 'BBZ-Seite nicht erreichbar' });
  }
});

module.exports = router;
