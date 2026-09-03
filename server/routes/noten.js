'use strict';

// Brücke zur Notenverwaltung für den Browser: Der Client fragt IMMER nur diesen
// Server, die Weiterleitung an die Notenverwaltung (inkl. gemeinsamem
// Geheimnis) passiert serverseitig — kein CORS, keine Dritt-Cookies.
//
// Alle Routen hängen hinter requireAuth (siehe server/index.js) und geben
// ausschließlich Daten der angemeldeten Lehrkraft heraus: Als handelnde Person
// wird die Kennung aus der Session mitgeschickt, die Notenverwaltung filtert
// darauf ihre eigenen Berechtigungen (Fach-Zuweisung, Klassenleitung, …).

const express = require('express');
const { config } = require('../config');
const notenClient = require('../noten/client');

const router = express.Router();

function sub(req) {
  return req.session.user.username;
}

function sendeFehler(res, err) {
  const status = err.status || 502;
  if (status >= 500) console.error('Notenverwaltung:', err.message);
  res.status(status).json({ error: err.message || 'Notenverwaltung nicht erreichbar' });
}

// GET /api/noten/status – ist die Anbindung eingerichtet und erreichbar?
// Ohne ?ping=1 wird nur die Konfiguration gemeldet (kein Netzwerkzugriff).
router.get('/status', async (req, res) => {
  const basis = {
    konfiguriert: notenClient.istKonfiguriert(),
    url: config.noten.publicUrl || null,
    sso: config.authMode === 'sso',
  };
  if (!basis.konfiguriert || req.query.ping !== '1') return res.json(basis);
  try {
    const pong = await notenClient.ping();
    res.json({ ...basis, erreichbar: true, version: pong.version || null });
  } catch (err) {
    res.json({ ...basis, erreichbar: false, fehler: err.message });
  }
});

// GET /api/noten/klassen – Klassen der angemeldeten Lehrkraft (ohne Schüler).
router.get('/klassen', async (req, res) => {
  try {
    res.json(await notenClient.klassen(sub(req)));
  } catch (err) {
    sendeFehler(res, err);
  }
});

// GET /api/noten/klassen/:id – eine Klasse inkl. Fächer und Schülerliste.
router.get('/klassen/:id', async (req, res) => {
  try {
    const klasse = await notenClient.klasse(sub(req), req.params.id);
    if (!klasse) return res.status(404).json({ error: 'Klasse nicht gefunden' });
    res.json({ klasse });
  } catch (err) {
    sendeFehler(res, err);
  }
});

module.exports = router;
