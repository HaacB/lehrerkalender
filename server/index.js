'use strict';

const path = require('path');
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');

const { config, validate } = require('./config');
const { createSessionStore } = require('./sessionStore');
const { loginHandler, logoutHandler, requireAuth } = require('./auth');
const stateRoutes = require('./routes/state');
const { init: initDb, closeAll } = require('./db/userDb');

validate();

const app = express();
app.set('trust proxy', 1); // hinter Reverse-Proxy korrektes secure-Cookie
app.disable('x-powered-by');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');

// ── Security-Header (CSP passend zur Inline-Struktur der App) ──────────
app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        defaultSrc: ["'self'"],
        // App nutzt Inline-<script> und onclick-Handler -> 'unsafe-inline' nötig.
        scriptSrc: ["'self'", "'unsafe-inline'"],
        // helmet setzt sonst script-src-attr 'none' -> blockiert die onclick=""-Handler.
        scriptSrcAttr: ["'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        fontSrc: ["'self'"],
        // Outlook-Integration (optional): Graph-API per fetch erlauben.
        connectSrc: ["'self'", 'https://graph.microsoft.com'],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        frameAncestors: ["'self'"],
        upgradeInsecureRequests: config.secureCookies ? [] : null,
      },
    },
    crossOriginEmbedderPolicy: false,
  })
);

app.use(express.json({ limit: '6mb' }));
app.use(express.urlencoded({ extended: false }));

app.use(
  session({
    name: 'lk.sid',
    // Persistenter Store: Logins überstehen Passenger-Neustarts/Worker-Recycling.
    store: createSessionStore(session),
    secret: config.sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: config.secureCookies,
      maxAge: 1000 * 60 * 60 * 12, // 12h
    },
  })
);

// ── Auth-Endpunkte ─────────────────────────────────────────────────────
app.post('/auth/login', loginHandler);
app.post('/auth/logout', logoutHandler);

// ── API (geschützt) ────────────────────────────────────────────────────
app.use('/api', requireAuth, stateRoutes);

// ── Statische Dateien / PWA ────────────────────────────────────────────
// Login-Seite ist frei erreichbar. index.html prüft selbst per /api/me und
// leitet ggf. auf /login.html um.
app.use(
  express.static(PUBLIC_DIR, {
    index: 'index.html',
    setHeaders(res, filePath) {
      // Service Worker nicht cachen, damit Updates sicher ankommen.
      if (path.basename(filePath) === 'sw.js') {
        res.setHeader('Cache-Control', 'no-cache');
      }
    },
  })
);

// SPA/PWA-Fallback: unbekannte GET-Routen -> index.html (aber nicht /api, /auth)
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/auth')) return next();
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

// ── Fehler-/Fallback-Handler ───────────────────────────────────────────
// Falscher DB-Schlüssel o. Ä. -> nicht die interne Meldung leaken.
app.use((err, req, res, _next) => {
  console.error('Serverfehler:', err && err.message ? err.message : err);
  if (res.headersSent) return;
  res.status(500).json({ error: 'Interner Serverfehler' });
});

let server;
initDb()
  .then(() => {
    server = app.listen(config.port, () => {
      console.log(
        `Lehrerkalender läuft auf http://localhost:${config.port}  (AUTH_MODE=${config.authMode})`
      );
    });
  })
  .catch((err) => {
    console.error('DB-Initialisierung fehlgeschlagen:', err);
    process.exit(1);
  });

// Sauberes Herunterfahren
function shutdown() {
  if (server) {
    server.close(() => {
      closeAll();
      process.exit(0);
    });
  } else {
    closeAll();
    process.exit(0);
  }
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

module.exports = app;
