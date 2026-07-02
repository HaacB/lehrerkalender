# Deployment auf Plesk (Node.js / Passenger)

Kurzanleitung für den Betrieb des Lehrerkalenders auf einem Plesk-Server mit dem
**Node.js-Modul** (Phusion Passenger). Bezieht sich auf die Domain
`lehrerkalender.bbz-rd-eck.com`.

---

## 1. Node.js-Modul in Plesk konfigurieren

Im Plesk-Panel unter **Websites & Domains → <Domain> → Node.js**:

| Feld | Wert | Hinweis |
|------|------|---------|
| **Node.js-Version** | 20.x oder 22.x | passt zu `engines: ">=18"`; auf dem Server war 22.23.1 |
| **Package Manager** | `npm` | ✅ so lassen |
| **Anwendungsstamm** (Application Root) | Projektwurzel (dort liegt `package.json`) | ✅ so lassen |
| **Anwendungsstartdatei** (Startup File) | `server/index.js` | ✅ so lassen |
| **Anwendungsmodus** | `production` | ✅ so lassen |
| **Dokumentenstamm** (Document Root) | **auf `public` ändern** | ⚠️ **wichtig, siehe unten** |
| **Umgebungsvariablen** | siehe Abschnitt 2 | über „Benutzerdefinierte Umgebungsvariablen“ |

### ⚠️ Dokumentenstamm auf `public/` setzen (Sicherheit)

Aktuell zeigt der Dokumentenstamm auf die Projektwurzel. Das bedeutet, dass der
Webserver **auch `.env`, `server/`, `node_modules/` und vor allem das
`data/`-Verzeichnis mit den verschlüsselten Nutzer-Datenbanken direkt ausliefern
könnte**. Deshalb (und wie Plesk selbst warnt):

> Dokumentenstamm auf das Unterverzeichnis **`public`** des Anwendungsstamms setzen.

Danach bedient der Webserver statische Dateien direkt aus `public/`
(`index.html`, `login.html`, `sw.js`, Icons, `vendor/`), während alle dynamischen
Routen (`/api/*`, `/auth/*` und der SPA-Fallback) an die Node-App (Passenger)
gehen. `.env` und `data/` liegen dann **außerhalb** des Dokumentenstamms und sind
nicht mehr per URL erreichbar.

### HTTPS

Für die Domain ein Zertifikat (Let's Encrypt) aktivieren und auf **HTTPS**
umstellen. Das ist Voraussetzung für `SECURE_COOKIES=true` (siehe unten) — ohne
HTTPS würde der Browser das Session-Cookie nicht senden. Die App setzt bereits
`trust proxy`, arbeitet also korrekt hinter dem Plesk-Reverse-Proxy.

### Passenger & `app.listen`

`server/index.js` ruft `app.listen(...)` auf. Passenger fängt das ab und bindet
die App an seinen eigenen Socket — der `PORT` ist unter Passenger also
bedeutungslos und muss nicht gesetzt werden. Ein Neustart erfolgt über den
Button **„App neu starten“** oder durch `touch tmp/restart.txt` im
Anwendungsstamm (siehe Deploy-Skript).

---

## 2. Umgebungsvariablen (Plesk-UI)

Unter **Node.js → Benutzerdefinierte Umgebungsvariablen** setzen. Diese haben
Vorrang; eine `.env`-Datei ist auf dem Server **nicht nötig** (und sollte, falls
doch vorhanden, außerhalb des Dokumentenstamms liegen).

**Pflicht:**

| Variable | Beispiel / Wert | Zweck |
|----------|-----------------|-------|
| `MASTER_KEY` | `openssl rand -base64 32` | Schlüssel für die DB-Verschlüsselung — **geheim halten & sichern** |
| `SESSION_SECRET` | `openssl rand -base64 32` | Signatur der Session-Cookies |
| `AUTH_MODE` | `ldap` | echter AD-/LDAP-Login (statt `dev`) |
| `SECURE_COOKIES` | `true` | secure-Cookies hinter HTTPS |
| `DATA_DIR` | z. B. `/var/www/vhosts/<domain>/lehrerkalender-data` | Ablage der verschlüsselten DBs, **außerhalb** des Dokumentenstamms |

**LDAP (bei `AUTH_MODE=ldap`)** — Details und beide Modi siehe
[`README.md` → Authentifizierung](../README.md) und [`.env.example`](../.env.example):

| Variable | Beispiel |
|----------|----------|
| `LDAP_URL` | `ldaps://dc01.schule.local:636` |
| `LDAP_BASE_DN` | `DC=schule,DC=local` |
| `LDAP_USER_FILTER` | `(sAMAccountName={{username}})` |
| `LDAP_BIND_USER_TEMPLATE` | Direkt-Bind (empfohlen): `SNRD\{{username}}` oder `{{username}}@snrd.local` |
| `LDAP_BIND_DN` / `LDAP_BIND_PW` | nur Service-Account-Modus (entfällt bei Direkt-Bind) |
| `LDAP_LOGIN_ATTR` / `LDAP_NAME_ATTR` | Default `sAMAccountName` / `displayName` |
| `LDAP_TLS_CA_PFAD` | PEM der internen CA (empfohlen bei LDAPS) |
| `LDAP_TLS_REJECT_UNAUTHORIZED` | `false` schaltet die Zertifikatsprüfung ab (nur Notlösung) |

> **MASTER_KEY & DATA_DIR sichern!** Ohne den `MASTER_KEY` sind alle Nutzer-DBs
> unwiederbringlich unlesbar. Backup von `DATA_DIR` **und** `MASTER_KEY` einplanen.

### Optional: Einbettung per iframe (z. B. Nextcloud „Externe Seiten")

Standardmäßig verhindert die App die Einbettung in fremde Seiten
(`X-Frame-Options: SAMEORIGIN`, `SameSite=Lax`-Cookie). Soll der Kalender in eine
Nextcloud auf **anderer** Domain eingebettet werden, die erlaubten Herkünfte setzen:

| Variable | Beispiel |
|----------|----------|
| `EMBED_ANCESTORS` | `https://cloud.bbz-rd-eck.de` (kommagetrennt für mehrere) |

Dann sendet die App das Session-Cookie als `SameSite=None; Secure` (erfordert
`SECURE_COOKIES=true` + HTTPS) und erlaubt die Herkunft in `frame-ancestors`
(`X-Frame-Options` wird abgeschaltet).

> **Vorbehalt:** hängt an Dritt-Cookies (Chrome/Edge/Firefox aktuell ok, Safari
> blockt sie). Zukunftssicherer ist, den Kalender unter eine Subdomain **derselben
> Basisdomain** wie die einbettende Seite zu legen (z. B. Nextcloud
> `cloud.bbz-rd-eck.de` + Kalender `…​.bbz-rd-eck.de`) — dann ist es *same-site*
> und `EMBED_ANCESTORS` genügt für das Framing, ohne Dritt-Cookie-Abhängigkeit.

---

## 3. Befehle nach jedem `git pull`

Das Projekt ist eine statische PWA + Node-Server aus **reinem JavaScript**
(`sql.js`/WASM, keine nativen Module) — **es gibt keinen Build-Schritt**.
`npm run build` existiert nur als No-op, damit generische Deploy-Automationen
nicht scheitern.

Nach jedem Pull genügt daher **Abhängigkeiten installieren + App neu starten**:

```bash
# im Anwendungsstamm
npm ci --omit=dev        # reproduzierbar aus package-lock.json (Fallback: npm install --omit=dev)
mkdir -p tmp && touch tmp/restart.txt   # Passenger-Neustart (alternativ: Plesk "App neu starten")
```

`npm ci` wird nur benötigt, wenn sich `package.json`/`package-lock.json` geändert
haben (z. B. der Wechsel `ldapjs → ldapts`), schadet aber nicht. Beispiel für ein
Post-Pull-Skript (an die eigene Automation anpassbar):

```bash
#!/usr/bin/env bash
set -euo pipefail
cd /var/www/vhosts/<domain>/lehrerkalender   # Anwendungsstamm
git pull --ff-only
npm ci --omit=dev
mkdir -p tmp && touch tmp/restart.txt        # Passenger neu laden
```

> Wer Plesks „npm-Installation“-Button nutzt: danach „App neu starten“ klicken.
> Tests laufen ohne Zusatzpakete mit `npm test` (nur für Staging/CI gedacht,
> nicht Teil des Produktivstarts).

---

## 4. LDAP-Anmeldung testen (Diagnose)

Falls der Login hakt, den LDAP-Zugriff isoliert prüfen (ohne Webserver):

```bash
AUTH_MODE=ldap npm run ldap-test -- <benutzername> <passwort>
```

Gibt die verwendete Konfiguration, den gewählten Modus (Direkt-Bind /
Service-Account) und im Fehlerfall die technische Ursache aus (z. B.
`ECONNREFUSED` = Host/Port/Firewall, `SELF_SIGNED_CERT…` = interne CA via
`LDAP_TLS_CA_PFAD` hinterlegen).

---

## 5. Kurz-Checkliste

- [ ] Node.js-Version 20/22, Startdatei `server/index.js`
- [ ] **Dokumentenstamm = `public/`**
- [ ] HTTPS aktiv, `SECURE_COOKIES=true`
- [ ] `MASTER_KEY`, `SESSION_SECRET`, `AUTH_MODE=ldap`, `DATA_DIR` gesetzt
- [ ] LDAP-Variablen gesetzt, `npm run ldap-test` erfolgreich
- [ ] Backup von `DATA_DIR` **und** `MASTER_KEY` eingerichtet
- [ ] Post-Pull: `npm ci --omit=dev` + Passenger-Neustart
