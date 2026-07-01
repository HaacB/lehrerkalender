'use strict';

// Persistenter Session-Store auf Dateibasis (session-file-store, reines JS,
// kein nativer Build). Ersetzt den In-Memory-Default von express-session, damit
// angemeldete Nutzer einen Passenger-Neustart bzw. Worker-Recycling überstehen
// und Sessions auch bei mehreren Workern über das Dateisystem geteilt werden.
//
// Sessions liegen als JSON-Dateien in DATA_DIR/sessions — getrennt von den
// verschlüsselten Pro-Nutzer-DBs (*.db) im DATA_DIR-Wurzelverzeichnis. In
// Produktion liegt DATA_DIR außerhalb public/, lokal unter data/ (in .gitignore).

const path = require('path');
const { config } = require('./config');

// Ablageort der Session-Dateien: Unterordner von DATA_DIR.
const sessionsDir = path.join(config.dataDir, 'sessions');

const TWELVE_HOURS_S = 12 * 60 * 60; // deckungsgleich mit dem Cookie-maxAge

// Factory: nimmt das express-session-Modul und liefert einen konfigurierten
// FileStore. session wird injiziert, damit dieses Modul ohne laufenden Server
// geladen (und damit isoliert getestet) werden kann.
function createSessionStore(session) {
  const FileStore = require('session-file-store')(session);
  return new FileStore({
    path: sessionsDir,
    ttl: TWELVE_HOURS_S,
    reapInterval: 60 * 60, // abgelaufene Session-Dateien stündlich aufräumen
    retries: 2, // gegen kurzzeitige Datei-Lock-Kollisionen
    logFn: () => {}, // kein Rauschen im Passenger-/stdout-Log
  });
}

module.exports = { createSessionStore, sessionsDir };
