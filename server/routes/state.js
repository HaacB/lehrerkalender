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

module.exports = router;
