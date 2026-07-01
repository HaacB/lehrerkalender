# Lehrerkalender BBZ RD-ECK (serverbasiert)

Digitaler Lehrerkalender als **serverbasierte Web-App**: ein zentraler Node.js-Server
liefert die Oberfläche an jeden Browser (mobil + Windows/mac/linux) aus und speichert die
Daten **pro Nutzer in einer eigenen, verschlüsselten SQLite-Datenbank**.

Frühere Versionen liefen als reine Browser-PWA mit `localStorage`. `localStorage` dient jetzt
nur noch als **Offline-Lesecache** – Quelle der Wahrheit ist der Server.

## Funktionsumfang

Wochenplan · Halbjahresplaner · Klassenbuch · Stundenplan-Editor · Ferien-Verwaltung ·
Nextcloud-Arbeitsblatt-Links · WebUntis-CSV-Import · JSON-Export/Import.
Details siehe [ANLEITUNG.md](ANLEITUNG.md).

## Architektur

```
Browser (PWA, jedes Gerät)
   │  HTTPS, Session-Cookie
   ▼
Node.js / Express-Server (server/)
   ├── Auth-Schicht (austauschbar: dev-login | ldap)
   ├── Static-Serving der PWA (public/)
   └── REST-API /api/*  (session-geschützt)
         ▼
   Pro-Nutzer verschlüsselte SQLite:  data/<safeUser>.db
   (SQLCipher via better-sqlite3-multiple-ciphers)
   Schlüssel = HKDF(MASTER_KEY, username) → jede DB eigener Schlüssel
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

## Datenmodell

Die Pro-Nutzer-DB ist eine `kv(key, value)`-Tabelle und spiegelt exakt die früheren
localStorage-Schlüssel (`lp_lessons`, `lp_klassen`, `lp_hj`, `lp_sp`, `lp_wkcfg`, `lp_kb`,
`lp_links`, `lp_ferien_<sj>`, `pref_*`). Werte sind JSON-Strings.

API: `GET /api/me`, `GET /api/state`, `PUT /api/state` (Batch), `PUT /api/kv/:key`.

## Projektstruktur

```
server/            Express-Server, Auth, verschlüsselte DB, API-Routen
public/            PWA (index.html, login.html, sw.js, manifest, icons, vendor/tabler)
data/              verschlüsselte Pro-Nutzer-DBs  (nicht im Repo)
.env.example       Konfigurationsvorlage
```

## Roadmap

- **Phase B:** LDAP ist implementiert (`server/auth/ldap.js`) – nur noch `AUTH_MODE=ldap`
  setzen und die `.env` befüllen, sobald der LDAP-Endpoint bereitsteht.
- **Phase C:** Synchronisierung der verschlüsselten DB-Dateien über Nextcloud (WebDAV).

## Produktion

HTTPS via Reverse-Proxy, `SECURE_COOKIES=true`, persistenter Session-Store,
Backups des `data/`-Verzeichnisses **und** des `MASTER_KEY`.

## Lizenz

[MIT](LICENSE) · Entwickelt mit Claude · BBZ Rendsburg-Eckernförde · 2025/26
