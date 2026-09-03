# Lehrerkalender BBZ RD-ECK (serverbasiert)

Digitaler Lehrerkalender als **serverbasierte Web-App**: ein zentraler Node.js-Server
liefert die Oberfläche an jeden Browser (mobil + Windows/mac/linux) aus und speichert die
Daten **pro Nutzer in einer eigenen, verschlüsselten SQLite-Datenbank**.

Frühere Versionen liefen als reine Browser-PWA mit `localStorage`. `localStorage` dient jetzt
nur noch als **Offline-Lesecache** – Quelle der Wahrheit ist der Server.

## Funktionsumfang

Wochenplan · Halbjahresplaner · Klassenbuch · Stundenplan-Editor · Ferien-Verwaltung ·
Nextcloud-Arbeitsblatt-Links · WebUntis-CSV-Import · JSON-Export/Import ·
Anbindung an die **Notenverwaltung** (eine Anmeldung, verknüpfte Klassen).
Details siehe [ANLEITUNG.md](ANLEITUNG.md).

## Architektur

```
Browser (PWA, jedes Gerät)
   │  HTTPS, Session-Cookie
   ▼
Node.js / Express-Server (server/)
   ├── Auth-Schicht (austauschbar: dev-login | ldap | sso)
   ├── Static-Serving der PWA (public/)
   ├── REST-API /api/*  (session-geschützt)
   │     ▼
   │  Pro-Nutzer verschlüsselte SQLite:  data/<safeUser>.db
   │  Schlüssel = HKDF(MASTER_KEY, username) → jede DB eigener Schlüssel
   └── /api/noten/*  ──server-zu-server──▶  Notenverwaltung
         (Klassen, Fächer, Schülerlisten; Anmeldung per SSO)
```

Der Server kann zur Laufzeit entschlüsseln (**Verschlüsselung at-rest**): Schutz gegen
Diebstahl der DB-Dateien/Backups, kein Ende-zu-Ende-Schutz gegen einen kompromittierten Server.

## Setup

Voraussetzung: **Node.js ≥ 18**.

```bash
npm install
cp .env.example .env        # danach .env ausfüllen (Windows: copy .env.example .env)
```

`.env` mindestens setzen:

```
MASTER_KEY=<32-Byte base64>       # z. B.  openssl rand -base64 32
SESSION_SECRET=<32-Byte base64>   # z. B.  openssl rand -base64 32
AUTH_MODE=dev                     # dev = Test-Login ohne Passwortprüfung
```

> **MASTER_KEY sichern!** Geht er verloren, sind alle Nutzer-Datenbanken unwiederbringlich
> unlesbar. Niemals committen (`.env` steht in `.gitignore`).

Start:

```bash
npm start
# -> http://localhost:3000
```

## Authentifizierung

| AUTH_MODE | Verhalten |
|-----------|-----------|
| `dev`     | Test-Login: beliebiger Benutzername, keine Passwortprüfung. Optional per `DEV_ALLOWED_USERS` einschränken. |
| `ldap`    | Echter LDAP-/AD-Bind. Vollständig über `.env` konfiguriert (kein Code-Change nötig). |
| `sso`     | Anmeldung über die **Notenverwaltung** – wer dort angemeldet ist, kommt ohne zweite Eingabe herein. `SSO_FALLBACK_MODE=ldap` behält das Passwort-Formular als Notausgang. Siehe [docs/NOTENVERWALTUNG-INTEGRATION.md](docs/NOTENVERWALTUNG-INTEGRATION.md). |

Das LDAP-Modul (`server/auth/ldap.js`) ist aus der **Notentabellen-SPA** übernommen, damit
beide Schul-Apps dieselbe erprobte Anmeldelogik gegen den AD nutzen. Es kennt zwei Modi:

- **Direkt-Bind** (empfohlen): `LDAP_BIND_USER_TEMPLATE` gesetzt (z. B. `SNRD\{{username}}`
  oder `{{username}}@snrd.local`). Der Nutzer bindet mit eigener Kennung + Passwort – **kein
  Service-Account nötig**. Anzeigename/Kennung werden danach best effort gelesen.
- **Service-Account**: ohne Template – ein Lese-Konto (`LDAP_BIND_DN`/`LDAP_BIND_PW`) sucht den
  Nutzer per `LDAP_USER_FILTER`, danach wird mit dessen DN + Passwort verifiziert.

Für `ldaps://` mit interner CA den PEM-Pfad in `LDAP_TLS_CA_PFAD` hinterlegen (Notlösung:
`LDAP_TLS_REJECT_UNAUTHORIZED=false`). Alle Variablen sind in `.env.example` dokumentiert.

Der **Dateiname und Schlüssel der Nutzer-DB werden aus der stabilen Verzeichnis-Kennung**
(`loginSub`, i. d. R. der `sAMAccountName`, klein geschrieben) abgeleitet – Whitelist +
Hash-Suffix gegen Kollisionen und Path-Traversal.

**Diagnose:** `AUTH_MODE=ldap npm run ldap-test -- <benutzer> <passwort>` testet den Login
direkt ohne Webserver und gibt Konfiguration sowie den vollständigen Fehler aus.

## Notenverwaltung: eine Anmeldung, verknüpfte Klassen

Die Schwester-App **Notenverwaltung** (`noten_webapp`, `https://noten.bbz-rd-eck.com`)
ist der Anmeldedienst der Schule und bleibt alleinige Quelle der Noten. Mit

```
AUTH_MODE=sso
NOTEN_BASE_URL=https://noten.bbz-rd-eck.com
NOTEN_CLIENT_SECRET=<gemeinsames Geheimnis>
PUBLIC_URL=https://kalender.bbz-rd-eck.com
```

melden sich Lehrkräfte nur noch einmal an. Im Klassenbuch lässt sich jede
Klasse mit einer Klasse (und optional einem Fach) der Notenverwaltung
**verknüpfen**: Schülerlisten kommen von dort, ein Knopf springt direkt in
die Notentafel. Geschrieben wird nichts zurück.

Die Datenabrufe laufen server-zu-server (`/api/noten/*` → `/api/extern/*`),
nicht aus dem Browser – dadurch keine CORS-Regeln und keine Dritt-Cookies
(die Safari blockt). Die Anbindung funktioniert auch mit `AUTH_MODE=ldap`,
dann bleiben es zwei Anmeldungen.

Details, Sicherheitsmodell und Inbetriebnahme:
**[docs/NOTENVERWALTUNG-INTEGRATION.md](docs/NOTENVERWALTUNG-INTEGRATION.md)**.
Die Gegenstelle liegt als anwendbarer Patch in
[docs/noten-webapp/](docs/noten-webapp/ANWENDEN.md).

## Datenmodell

Die Pro-Nutzer-DB ist eine `kv(key, value)`-Tabelle und spiegelt exakt die früheren
localStorage-Schlüssel (`lp_lessons`, `lp_klassen`, `lp_hj`, `lp_sp`, `lp_wkcfg`, `lp_kb`,
`lp_links`, `lp_ferien_<sj>`, `pref_*`). Werte sind JSON-Strings.

API: `GET /api/me`, `GET /api/state`, `PUT /api/state` (Batch), `PUT /api/kv/:key`.

Die Verknüpfung einer Klasse mit der Notenverwaltung steht als optionales Feld
`nv` am Klassen-Objekt in `lp_klassen`
(`{klasseId, klasseName, schuljahr, fachId, fachName, verknuepftAm}`); die
Daten selbst werden nicht gespiegelt, sondern bei Bedarf über
`GET /api/noten/status|klassen|klassen/:id` frisch geholt.

## Projektstruktur

```
server/            Express-Server, Auth, verschlüsselte DB, API-Routen
  auth/            dev/ldap-Login + sso.js (Anmeldung über die Notenverwaltung)
  noten/           HTTP-Client zur Notenverwaltung (server-zu-server)
  routes/          state.js (Nutzerdaten), noten.js (Klassen-Verknüpfung)
public/            PWA (index.html, login.html, sw.js, manifest, icons, vendor/tabler)
data/              verschlüsselte Pro-Nutzer-DBs  (nicht im Repo)
docs/noten-webapp/ Patch für die Gegenstelle in der Notenverwaltung
.env.example       Konfigurationsvorlage
```

## Roadmap

- **Phase B:** LDAP ist implementiert (`server/auth/ldap.js`) – nur noch `AUTH_MODE=ldap`
  setzen und die `.env` befüllen, sobald der LDAP-Endpoint bereitsteht.
- **Phase C:** Synchronisierung der verschlüsselten DB-Dateien über Nextcloud (WebDAV).
- **Notenverwaltung:** SSO + Klassen-Verknüpfung sind implementiert (lesend).
  Denkbare nächste Schritte: Abwesenheiten aus dem Klassenbuch als Fehlzeiten
  zurückschreiben, Mitarbeitsfarben in die Unterrichtsleistungs-Datumstabelle.

## Tests

```bash
npm test          # Node-eigener Test-Runner (node --test), keine Zusatzpakete
```

Abgedeckt sind Datei-/Schlüsselableitung (`keys`), das RFC-4515-Filter-Escaping,
der Auth-Fluss (dev + ldap, LDAP gestubbt), der SSO-Fluss gegen die
Notenverwaltung (`sso`, `noten-client`, jeweils mit Testdoppeln) sowie die
Konfigurations-Validierung.

## Produktion

HTTPS via Reverse-Proxy, `SECURE_COOKIES=true`, persistenter Session-Store,
Backups des `data/`-Verzeichnisses **und** des `MASTER_KEY`.

Ausführliche Anleitung für den Plesk-Server (Node.js/Passenger, Umgebungs­variablen,
Dokumentenstamm, Deploy nach `git pull`): **[docs/DEPLOYMENT-PLESK.md](docs/DEPLOYMENT-PLESK.md)**.

## Lizenz

[MIT](LICENSE) · Entwickelt mit Claude · BBZ Rendsburg-Eckernförde · 2025/26
