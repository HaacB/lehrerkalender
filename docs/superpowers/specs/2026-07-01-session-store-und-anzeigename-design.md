# Design: Persistenter Session-Store + LDAP-Anzeigename

**Datum:** 2026-07-01
**Branch:** `claude/teacher-calendar-ldap-auth-0hfft8`

## Ziel

Zwei kleine, unabhängige Verbesserungen am produktiven Lehrerkalender:

1. **Persistenter Session-Store** statt des In-Memory-Defaults, damit Logins
   Passenger-Neustarts / Worker-Recycling überleben.
2. **LDAP-Anzeigename** (`me.name`) im Frontend anzeigen — der Wert wird von
   `/api/me` bereits geliefert, aber noch nicht genutzt.

Nicht-Ziele: keine Änderung an der Auth-Logik, an `/api/me` oder an der
Sync-Logik; keine neuen ENV-Variablen.

## 1. Session-Store

### Entscheidung

`session-file-store` (reines JavaScript, kein nativer Build) — passt zum
kein-nativer-Code-Prinzip des Projekts (sql.js läuft als WASM). Verworfen:
`connect-sqlite3` (natives `sqlite3`-Modul) und ein Custom-Store auf sql.js
(unnötig viel Eigencode für Persistenz/TTL/Locking).

### Architektur

Neues, isoliertes Modul **`server/sessionStore.js`**:

```js
// createSessionStore(session) -> konfigurierter FileStore
// sessionsDir                 -> abgeleiteter Ablagepfad (für Tests)
```

- **Ablage:** `path.join(config.dataDir, 'sessions')`. Liegt damit unter
  `DATA_DIR` — in Produktion außerhalb `public/`, lokal unter `data/` (bereits
  in `.gitignore`). Kein neues ENV-Feld.
- **TTL:** `12 * 60 * 60` s (43200), deckungsgleich mit dem Cookie-`maxAge`.
- `reapInterval` für automatisches Aufräumen abgelaufener Dateien.
- `logFn` stummgeschaltet (kein Rauschen im Passenger-Log).
- `retries: 2` gegen kurzzeitige Datei-Lock-Kollisionen.

In `server/index.js` wird der bestehende `session({...})`-Block um
`store: createSessionStore(session)` ergänzt. Cookie-Optionen und Secret
bleiben unverändert.

### Wechselwirkung mit den Pro-Nutzer-DBs

Die verschlüsselten DBs liegen als flache `*.db`-Dateien direkt in `DATA_DIR`
(`server/db/userDb.js`), Dateiname `<slug>-<12hex>.db` aus der stabilen
`loginSub`. Der Session-Store nutzt ein separates Unterverzeichnis
`DATA_DIR/sessions/` mit `*.json` — keine Kollision.

## 2. Anzeigename im Frontend

Zwei lokale Stellen in `public/index.html`:

- **Bootstrap (~Z. 269):** zusätzlich `localStorage.setItem('lk_name', me.name || '')`.
  Beim bestehenden Nutzerwechsel-Cache-Clear wird `lk_name` mit entfernt.
- **Label (~Z. 908):** `Angemeldet als <b>…</b>` zeigt statt `lk_user` künftig
  `lk_name` mit Fallback:
  `esc(localStorage.getItem('lk_name') || localStorage.getItem('lk_user') || '?')`.

Fallback-Kette: dev-Modus (kein `name`) → Kennung; LDAP ohne gelesenen Namen →
Kennung; LDAP mit Namen → Anzeigename.

## 3. Tests & Fehlerfälle

- **`test/session-store.test.js`:** prüft, dass `createSessionStore(session)`
  ein Store-Objekt liefert und `sessionsDir` korrekt aus `DATA_DIR` abgeleitet
  wird. Ohne Serverstart möglich, weil die Factory isoliert ist. Node-eigener
  Runner, keine neue Dev-Dependency (nur `session-file-store` als runtime dep).
- **Frontend-Label:** rein clientseitig, kein Testharness im Projekt →
  manuelle Verifikation der Fallback-Kette.
- **Robustheit:** scheitert das Schreiben einer Session-Datei, betrifft das nur
  diese eine Session (Neuanmeldung nötig) — kein Server-Crash.
- **`.gitignore`:** `data/` ist bereits ignoriert; lokale Session-Dateien
  landen nicht im Repo.
