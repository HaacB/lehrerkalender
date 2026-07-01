# Lehrerplaner BBZ RD-ECK – Dokumentation

## Was ist das?
Ein digitaler Lehrerkalender als Progressive Web App (PWA) – läuft im Browser,
kann wie eine richtige App installiert werden, funktioniert auch offline.

Entwickelt von Britt (BBZ RD-ECK) gemeinsam mit Claude (claude.ai).
Nächster Schritt: Integration in die bbz-cloud gemeinsam mit dClausen.

---

## Update: serverbasierte Version umgesetzt (Phase 1)

Die App ist inzwischen von der reinen localStorage-PWA zu einer **serverbasierten Web-App**
ausgebaut. Ein zentraler **Node.js-Server** liefert die Oberfläche an jeden Browser (mobil +
Windows/mac/linux) aus und speichert die Daten **pro Nutzer in einer eigenen, AES-256-GCM-
verschlüsselten SQLite-Datenbank** (Dateiname aus dem Benutzernamen abgeleitet). `localStorage`
ist nur noch Offline-Lesecache.

- **Auth austauschbar:** Test-Login (`AUTH_MODE=dev`) läuft; **LDAP** ist vorbereitet
  (`AUTH_MODE=ldap`, Konfiguration per `.env`) und wird scharfgeschaltet, sobald der
  LDAP-Endpoint bereitsteht.
- **Offen (spätere Phase):** Synchronisierung der verschlüsselten DB-Dateien über Nextcloud.

Setup, Architektur und API sind in **[README.md](README.md)** dokumentiert.

---

## Aktueller Funktionsumfang (Stand: lokale PWA)

| Modul | Funktion |
|-------|----------|
| **Wochenplan** | 10 BBZ-Blockstunden, Stundenplan-Hintergrund, A/B-Wochen, Plan 1–4 |
| **Halbjahresplaner** | 6-Monats-Kalenderansicht, Termine pro Tag, Schuljahr-Umschalter |
| **Klassenbuch** | Beobachtungsbogen, Farbpunkte, Notizfeld, Druckansicht |
| **Stundenplan-Editor** | Bis zu 4 Pläne, A/B-Wochen, Klasse + Fach pro Zelle |
| **Ferien-Verwaltung** | Editierbar pro Schuljahr, Export/Import, SH-Feiertage automatisch |
| **Nextcloud-Links** | Arbeitsblätter aus Nextcloud pro Stunde verlinken |
| **Import** | Schülerlisten aus WebUntis (CSV), Outlook-Sync vorbereitet |
| **Schuljahr-Archiv** | Export als JSON, Daten löschen und neu starten |

---

## Nächster Schritt: bbz-cloud Integration

### Warum bbz-cloud?
- Daten bleiben auf dem Schulserver → DSGVO-konform
- Kein externer Anbieter nötig
- Nextcloud, schul.cloud, Moodle, BBB, TaskCards, Office bereits verlinkt
- dClausen hat mit stashcat-chat bewiesen, dass die Infrastruktur funktioniert

### Architektur-Ziel

```
Lehrkraft (Browser)
    ↓
Lehrerplaner (bbz-cloud)
    ├── Frontend (React/HTML) – heutiger Stand ausbaubar
    ├── Backend (Node.js) – Auth, API, Datenspeicher
    └── Datenbank (PostgreSQL oder SQLite)
         ↓
    Externe Dienste (optional, konfigurierbar)
    ├── Nextcloud WebDAV → Arbeitsblätter direkt browsen
    ├── Microsoft Graph → Outlook-Termine automatisch
    ├── WebUntis API → Stundenplan-Import (wenn freigeschaltet)
    └── Moodle REST API → Noten, Abgaben im Klassenbuch
```

### Für das erste Gespräch mit dClausen

**Was von seinem stashcat-chat wiederverwendet werden kann:**
- Authentifizierungslogik (Session-Management, AES-256-GCM)
- Express-Backend-Struktur
- Deployment-Skripte (deploy.bat, restart.sh)
- Erfahrung mit der bbz-cloud-Infrastruktur
- Mobile-Bridge für bbzcloud-mobil (Flutter WebView)

**Was neu gebaut wird:**
- Datenbankschema (Klassen, Stunden, Einträge, Ferien pro Nutzer)
- Lehrerplaner-spezifische API-Routen
- Nextcloud WebDAV-Integration
- Multi-User (jede Lehrkraft eigene Daten, optionale Freigaben)

Diese Fragen wurden im ersten Gespräch bereits geklärt – siehe nächster Abschnitt.

---

## Architektur-Entscheidung (nach Gespräch mit dClausen)

**Status: entschieden – bereit zur Umsetzung**

| Thema | Entscheidung |
|-------|-------------|
| **Authentifizierung** | Nextcloud SSO – kein eigenes Login, bbz-cloud-Zugangsdaten reichen |
| **Datenbank** | SQLite – einfach, ausreichend für die erwartete Nutzerzahl |
| **Plattform** | Eigene App innerhalb von bbzcloud-mobil (Flutter-Integration) |
| **Stundenplan & Klassenlisten** | Werden **jedes Schuljahr neu eingepflegt** – keine automatische Übernahme, da sich zu viel ändert (Kurssystem, Klassenzusammensetzung) |

### Warum diese Entscheidungen sinnvoll sind
- **SSO**: dClausen muss keine 200 Accounts manuell verwalten, Zugriff endet automatisch wenn jemand die Schule verlässt
- **SQLite**: Bei realistischer Nutzung (nicht alle 200 Lehrkräfte gleichzeitig aktiv) völlig ausreichend, später bei Bedarf auf PostgreSQL migrierbar
- **bbzcloud-mobil Integration**: Eine zentrale App, kein zusätzlicher Login, passt zur bestehenden Infrastruktur
- **Neu einpflegen pro Schuljahr**: Entspricht der Realität – 12. Klassen haben ohnehin keine Vorjahresliste, Kurssysteme ändern sich

### Fallback-Plan: Falls die bbz-cloud-Integration sich verzögert oder nicht zustande kommt

Britt möchte den Lehrerplaner in jedem Fall auf **drei eigenen Geräten** nutzen können:
- 2 Laptops
- 1 Android-Handy

**Lösung dafür:** Die PWA-Version (so wie sie jetzt lokal läuft) lässt sich mit **Datensynchronisation über die eigene Nextcloud** verbinden, ohne dass dClausen ein Backend bauen muss:

| Option | Aufwand | Bemerkung |
|--------|---------|-----------|
| Export/Import per Hand (JSON) | Keiner | Bereits vorhanden, aber manuell |
| Datei in Nextcloud-Ordner ablegen + auf jedem Gerät syncen | Gering | Browser liest/schreibt eine Datei statt localStorage |
| Eigene kleine Sync-Lösung über Nextcloud WebDAV | Mittel | Automatischer Abgleich zwischen Geräten |

→ **Wird bei Bedarf separat umgesetzt**, falls die bbz-cloud-Lösung nicht rechtzeitig steht.

---

## Offene technische Detailfragen für die Umsetzung

| # | Thema | Frage |
|---|-------|-------|
| 1 | Datenmodell | Wie wird der "neue Schuljahr"-Reset serverseitig abgebildet? (Tabelle pro Schuljahr oder Spalte mit SJ-Kennung?) |
| 2 | bbzcloud-mobil | Wie wird eine neue App-Kachel im Mobile-Hub registriert? (dClausen weiß das bereits aus stashcat-chat) |
| 3 | Nextcloud SSO | Welches Protokoll? OAuth2 oder Nextcloud-eigene App-Passwörter? |
| 4 | Datenmigration | Wie kommen Britts bereits lokal gesammelten Daten (Klassen, Stundenpläne) in die neue SQLite-Datenbank? |

---

## Bestätigter Funktionsumfang für die bbz-cloud-Version (Phase 1)

Diese Features sind Teil der eigentlichen Integration, nicht optional:

- Wochenplan, Halbjahresplaner, Klassenbuch, Stundenplan-Editor, Ferien-Verwaltung (wie lokal)
- **Nextcloud-Verlinkung von Arbeitsblättern** – pro Stunde im Wochenplan ein Link zu einer Datei in der eigenen Nextcloud (WebDAV oder einfacher Share-Link). Bleibt fester Bestandteil, unabhängig vom Moodle-Add-on weiter unten.

---

## Späteres Add-on (nach Phase 1): Moodle-Noten im Klassenbuch

**Status: zurückgestellt, nicht vergessen**

Britt möchte langfristig Moodle-Noten und Abgabestatus direkt im Klassenbuch sehen, neben den eigenen Beobachtungsfarben. Eingeschätzt als:

| Aspekt | Einschätzung |
|--------|-------------|
| Technischer Aufwand | Mittel – Moodle REST-API (Web Services) ist offiziell verfügbar |
| Authentifizierung | Persönlicher Moodle-API-Token pro Lehrkraft, selbst generiert in Moodle |
| Datenschutz | Grundsätzlich unproblematisch, da nur Daten abgerufen werden, auf die die Lehrkraft in Moodle ohnehin Zugriff hat. Kurze Abstimmung mit dem Datenschutzbeauftragten empfohlen, bevor Notendaten zusätzlich im Lehrerplaner gespeichert werden. |
| Priorität | Niedrig – nur für Britt relevant, kein Blocker für den Rest des Projekts |

**Warum zurückgestellt:** Wochenplan, Klassenbuch und Stundenplan sollen zuerst robust auf der bbz-cloud laufen. Moodle-Integration kommt als optionales Zusatzfeature, sobald die Grundfunktionen stabil sind.

---

## Jetzt sofort nutzbar (lokale Version)

### Option A: Lokal öffnen
1. ZIP entpacken
2. `index.html` im Browser öffnen (Doppelklick)
3. Fertig – alles funktioniert, Daten bleiben im Browser

### Option B: Auf einem Webserver
Alle Dateien in einen Ordner auf dem Server laden:
```
index.html
manifest.json
sw.js
icons/
  icon-192.png
  icon-512.png
```

### App installieren
- **Chrome/Edge Desktop:** Adressleiste → Installieren-Symbol
- **iPhone/Safari:** Teilen → Zum Home-Bildschirm
- **Android/Chrome:** Menü → App installieren

---

## Datenschutz (lokale Version)
- Alle Daten bleiben **lokal im Browser** (localStorage)
- Keine Übertragung an externe Server
- Export/Import als JSON über Einstellungen → Daten
- Schülernamen = personenbezogene Daten → nur auf Dienstgerät nutzen

---

*Entwickelt mit Claude (claude.ai) · BBZ Rendsburg-Eckernförde · 2025/26*
