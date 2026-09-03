# Gegenstelle in der Notenverwaltung einspielen

Diese Erweiterung gehört ins Repository **`deraal09/noten_webapp`** (nicht in
den Lehrerkalender). Sie macht die Notenverwaltung zum Anmeldedienst und
liefert dem Kalender Klassen, Fächer und Schülerlisten.

Gesamtbild der Anbindung:
[`../NOTENVERWALTUNG-INTEGRATION.md`](../NOTENVERWALTUNG-INTEGRATION.md).

## Was der Patch macht

| Datei | Änderung |
|-------|----------|
| `src/sso.js` | **neu** – Konfiguration, Kennungs-Abbildung (`sub`), Einmal-Codes, Bearer-Prüfung |
| `src/routes/sso.js` | **neu** – `GET /sso/authorize`, `POST /sso/token` |
| `src/routes/api-extern.js` | **neu** – `GET /api/extern/ping\|klassen\|klassen/:id` |
| `test/sso-lehrerkalender.test.js` | **neu** – 9 Tests über den kompletten Ablauf |
| `src/db.js` | Tabelle `sso_codes` + `SCHEMA_VERSION` 12 → 13 |
| `app.js` | registriert die zwei neuen Routen-Module, `kalenderUrl` für das Layout |
| `views/partials/layout.ejs` | Navigationslink „Lehrerkalender ↗" (nur mit `LEHRERKALENDER_URL`) |
| `README.md` | Abschnitt „Single Sign-on für den Lehrerkalender" + ENV-Tabelle |

Ohne die neuen ENV-Variablen sind `/sso/*` und `/api/extern/*` abgeschaltet
(404) — die App verhält sich dann exakt wie vorher. Bestehende Tabellen und
Routen werden nicht angetastet.

## Einspielen

```bash
git clone https://github.com/deraal09/noten_webapp.git
cd noten_webapp
git checkout -b sso-lehrerkalender

git apply --check /pfad/zu/notenverwaltung-sso.patch   # Probelauf
git apply         /pfad/zu/notenverwaltung-sso.patch

npm install
npm test          # erwartet: 237 + 9 Tests, alle grün
git add -A && git commit -m "SSO und Lese-Schnittstelle für den Lehrerkalender"
```

Der Patch wurde gegen den Stand von `main` vom 03.09.2026 erzeugt und dort
mit der vollständigen Testsuite geprüft (246 Tests grün). Sollte
`git apply` wegen späterer Änderungen scheitern, hilft
`git apply -3 notenverwaltung-sso.patch` (Drei-Wege-Merge) — die drei neuen
Dateien sind ohnehin konfliktfrei, die vier Anpassungen an bestehenden
Dateien sind unten einzeln aufgeführt.

## Konfiguration (Plesk → Node.js → Umgebungsvariablen)

```ini
SSO_CLIENT_SECRET=<openssl rand -base64 32>
SSO_REDIRECT_URIS=https://kalender.bbz-rd-eck.com/auth/sso/callback
LEHRERKALENDER_URL=https://kalender.bbz-rd-eck.com
```

Danach App neu starten und prüfen:

```bash
curl -H "Authorization: Bearer <Geheimnis>" https://noten.bbz-rd-eck.com/api/extern/ping
# {"ok":true,"app":"notenverwaltung","version":13}
```

Dasselbe Geheimnis kommt im Kalender als `NOTEN_CLIENT_SECRET` in die `.env`.

## Die Änderungen an bestehenden Dateien (falls von Hand nötig)

**1. `src/db.js`** – Schema-Version anheben:

```diff
-export const SCHEMA_VERSION = 12;
+export const SCHEMA_VERSION = 13;
```

und im `SCHEMA`-Template vor `CREATE TABLE IF NOT EXISTS login_ratelimit`
die neue Tabelle einfügen:

```sql
CREATE TABLE IF NOT EXISTS sso_codes (
    code_hash TEXT PRIMARY KEY,
    client_id TEXT NOT NULL,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    redirect_uri TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_sso_codes_expires_at ON sso_codes(expires_at);
```

Eine `migrate()`-Ergänzung ist nicht nötig: `SCHEMA` läuft bei jedem Start
mit `CREATE TABLE IF NOT EXISTS` durch, die Tabelle entsteht also auch in
bestehenden Datenbanken.

**2. `app.js`** – Importe und Registrierung:

```js
import { ssoConfig } from './src/sso.js';
import ssoRoutes from './src/routes/sso.js';
import apiExternRoutes from './src/routes/api-extern.js';
```

```js
await app.register(ssoRoutes, { prefix: '/sso' });
await app.register(apiExternRoutes, { prefix: '/api/extern' });
```

und im `preHandler`, der `reply.locals` füllt:

```js
reply.locals.kalenderUrl = ssoConfig().kalenderUrl || null;
```

**3. `views/partials/layout.ejs`** – am Ende der `<nav class="nav">`:

```ejs
<% if (typeof kalenderUrl !== 'undefined' && kalenderUrl) { %>
  <a href="<%= kalenderUrl %>" target="_blank" rel="noopener">Lehrerkalender ↗</a>
<% } %>
```

**4. `README.md`** – reine Dokumentation, kann entfallen.

## Verhalten der Schnittstelle

- Herausgegeben wird nur, worauf die Lehrkraft auch in der Oberfläche
  Zugriff hat — geprüft mit denselben Helfern aus `src/auth.js`
  (`ladeMeineKlassen`, `userHatKlassenZugriff`, `userHatFachZgriff`,
  `userIstKlassenlehrer`).
- **Noten werden nicht geliefert.** Der Kalender verlinkt in die Notentafel,
  Quelle der Noten bleibt die Notenverwaltung.
- Einmal-Codes: 60 Sekunden gültig, einmalig einlösbar, nur als
  SHA-256-Hash gespeichert, abgelaufene werden bei jedem neuen Code
  aufgeräumt.
- Kennungen: AD-Konten → `login_sub` klein; lokale Konten → `nv:<username>`.
  Groß-/Kleinschreibung ist beim Auflösen unerheblich (`COLLATE NOCASE`).
