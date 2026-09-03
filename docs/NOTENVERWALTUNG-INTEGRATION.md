# Anbindung an die Notenverwaltung (Single Sign-on + Klassen-Verknüpfung)

Der Lehrerkalender und die **Notenverwaltung** (`deraal09/noten_webapp`,
produktiv unter `https://noten.bbz-rd-eck.com`) sind zwei eigenständige
Anwendungen, die Lehrkräfte gemeinsam nutzen. Diese Anbindung sorgt für:

1. **Eine Anmeldung.** Die Notenverwaltung ist der Anmeldedienst; wer dort
   angemeldet ist, kommt ohne zweite Eingabe in den Kalender.
2. **Verknüpfte Klassen.** Eine Klasse im Klassenbuch lässt sich mit einer
   Klasse (und optional einem Fach) der Notenverwaltung verbinden:
   Schülerlisten kommen von dort, aus dem Klassenbuch führt ein Direktlink in
   die Notentafel.
3. **Unveränderte Notenverwaltung.** Die Noten selbst bleiben ausschließlich
   dort und sind weiterhin ganz normal über deren Weboberfläche erreichbar.
   Der Kalender liest nur Klassen/Fächer/Namen und schreibt nichts zurück.

Die Gegenstelle liegt als anwendbarer Patch bei:
[`docs/noten-webapp/`](noten-webapp/ANWENDEN.md).

## Architektur im Überblick

```
        Browser der Lehrkraft
          │                 │
          │ (1) Anmeldung   │ (3) Kalender-Oberfläche
          ▼                 ▼
┌──────────────────┐   ┌──────────────────────┐
│ Notenverwaltung  │   │ Lehrerkalender       │
│ noten_webapp     │   │ (diese App)          │
│  · users/Rollen  │   │  · Wochenplan        │
│  · LDAP/AD-Login │   │  · Klassenbuch       │
│  · Klassen/Noten │   │  · verschlüsselte    │
│                  │   │    Pro-Nutzer-DB     │
└────────▲─────────┘   └──────────┬───────────┘
         │      (2) server-zu-server, HTTPS   │
         └───────────────────────────────────┘
            /sso/token        · Identität
            /api/extern/*     · Klassen, Fächer, Schülerlisten
```

Wichtig: **Der Browser spricht nie direkt mit der Notenverwaltung** (außer
beim Anmelde-Redirect und beim Klick auf einen Deep-Link). Alle Datenabrufe
laufen über den Kalender-Server. Das erspart CORS-Regeln und Dritt-Cookies —
Letztere blockt Safari, was die Anbindung sonst auf iPads unbrauchbar machte.

## Anmeldung (Single Sign-on)

```
Browser  ──────────────▶ Kalender  /auth/sso/start
                          │  legt Zufalls-`state` in der Session ab
                          ▼
Browser  ◀── 302 ──  <Noten>/sso/authorize?client_id&redirect_uri&state
                          │  (falls dort nicht angemeldet: erst /login)
                          ▼
Browser  ◀── 302 ──  <Kalender>/auth/sso/callback?code&state
                          │
Kalender ─── POST ──▶ <Noten>/sso/token  {client_id, client_secret, code}
Kalender ◀── JSON ──  {sub, username, name, rolle}
                          │  Session anlegen (neue Session-ID)
Browser  ◀── 302 ──  Kalender-Oberfläche
```

Absicherungen:

| Risiko | Maßnahme |
|--------|----------|
| Untergeschobener Rücksprung (CSRF) | Zufalls-`state`, zeitkonstant verglichen, 10 Minuten gültig, einmalig |
| Code-Diebstahl aus der URL | Code ist 60 s gültig, **einmalig** einlösbar und nur als SHA-256-Hash gespeichert |
| Ausleitung an fremde Adresse | `redirect_uri` muss exakt in `SSO_REDIRECT_URIS` der Notenverwaltung stehen; unbekannte Adressen werden nie angesprungen |
| Session-Fixation | Session-ID wird nach erfolgreicher Anmeldung neu vergeben |
| Weiterleitung auf fremde Seiten nach dem Login | `next` akzeptiert nur app-interne Pfade (`/…`, kein `//host`) |
| Mitlesen des Geheimnisses | verlässt nie den Server; Tausch läuft server-zu-server über HTTPS |

### Kennung (`sub`) – warum bestehende Daten erhalten bleiben

Der Kalender leitet **Dateiname und Schlüssel** der verschlüsselten
Pro-Nutzer-Datenbank aus der Anmeldekennung ab (`server/db/keys.js`). Damit
nach der Umstellung niemand vor einem leeren Kalender steht, liefert die
Notenverwaltung genau die Kennung, die der bisherige LDAP-Login ergeben hat:

| Kontotyp in der Notenverwaltung | `sub` | entspricht |
|---|---|---|
| AD/LDAP (`auth_source='ldap'`) | `login_sub`, kleingeschrieben | dem bisherigen `sAMAccountName`-Login des Kalenders |
| lokal (Einladungslink für externe Lehrkräfte) | `nv:` + Benutzername | neuem Kalender-Konto |

Das Präfix `nv:` kann nie mit einer AD-Kennung kollidieren (`:` ist im
`sAMAccountName` nicht erlaubt). Für den Dateinamen wird es wie bisher auf
eine Whitelist abgebildet und mit einem Hash-Suffix eindeutig gemacht.

> **Vor dem Umschalten prüfen:** Wer sich bisher mit einer anderen Schreibweise
> angemeldet hat als der `login_sub` in der Notenverwaltung, bekommt eine neue
> (leere) Kalender-DB. Beide Seiten schreiben klein, ein Abgleich der Kennungen
> vorab schadet trotzdem nicht.

## Klassen-Verknüpfung

Im Klassenbuch: **„Noten verknüpfen"** → Klasse der Notenverwaltung wählen →
optional das Fach → fertig. Der Kalender merkt sich an der Klasse:

```json
"nv": {
  "klasseId": 12, "klasseName": "11a BIN", "schuljahr": "2026/2027",
  "fachId": 34, "fachName": "Berufliche Informatik",
  "verknuepftAm": "2026-09-03T09:00:00.000Z"
}
```

Danach stehen bereit:

- **Notentafel öffnen** – Direktsprung nach `<Noten>/teacher/fach/<fachId>`
  (ohne Fach: `<Noten>/teacher/klassen/<klasseId>`), dank SSO ohne neue Anmeldung.
- **Schülerliste** – holt die Namen aus der Notenverwaltung. Bereits
  vorhandene Namen behalten **ihre Kalender-ID**, damit die Klassenbuch-Einträge
  (die an dieser ID hängen) erhalten bleiben; neue kommen dazu. Es wird
  **nichts gelöscht** – rein manuell angelegte Personen bleiben bestehen und
  werden in der Rückmeldung als „nur im Kalender" gezählt.
- **Klasse aus der Notenverwaltung anlegen** – im Dialog „Neue Klasse".

Verknüpfung und Namensübernahme sind reine Lesevorgänge. Mitarbeitsfarben,
Notizen und Fehlzeiten des Klassenbuchs bleiben im Kalender.

## Schnittstelle der Notenverwaltung

Alle Aufrufe server-zu-server mit
`Authorization: Bearer <gemeinsames Geheimnis>` und
`X-Noten-Sub: <Kennung der Lehrkraft>`:

| Endpunkt | Zweck | Antwort |
|----------|-------|---------|
| `GET /api/extern/ping` | Erreichbarkeit/Version | `{ok, app, version}` |
| `GET /api/extern/klassen` | Klassen der Lehrkraft | `{klassen:[{id, name, schuljahr, schuljahrId, zweiSchulen, schuelerAnzahl, rolle:{ersteller, klassenleitung}, faecher:[{id, name, abgeschlossen}]}]}` |
| `GET /api/extern/klassen/:id` | eine Klasse + Namen | wie oben, zusätzlich `schueler:[{id, nachname, vorname}]` |
| `POST /sso/token` | Einmal-Code → Identität | `{sub, username, name, rolle, auth_source}` |
| `GET /sso/authorize` | Browser-Weiterleitung (Anmeldung) | 302 mit `code` |

Die Notenverwaltung gibt nur heraus, worauf die Lehrkraft auch in ihrer
eigenen Oberfläche Zugriff hat (Fach-Zuweisung, Klassenleitung, selbst
angelegte Klasse, Admin). **Noten liefert sie über diese Schnittstelle nicht.**

Im Kalender kommen die Daten beim Browser über
`/api/noten/status`, `/api/noten/klassen` und `/api/noten/klassen/:id` an –
alle hinter `requireAuth`, jeweils nur für die eigene Kennung.

## Konfiguration

### Lehrerkalender (`.env`)

```ini
AUTH_MODE=sso
SSO_FALLBACK_MODE=none            # oder ldap = Notausgang, falls Noten offline
PUBLIC_URL=https://kalender.bbz-rd-eck.com
NOTEN_BASE_URL=https://noten.bbz-rd-eck.com
NOTEN_CLIENT_SECRET=<openssl rand -base64 32>
# optional: NOTEN_PUBLIC_URL, NOTEN_CLIENT_ID, NOTEN_TIMEOUT_MS
```

### Notenverwaltung (Plesk-ENV)

```ini
SSO_CLIENT_SECRET=<dasselbe Geheimnis>
SSO_REDIRECT_URIS=https://kalender.bbz-rd-eck.com/auth/sso/callback
LEHRERKALENDER_URL=https://kalender.bbz-rd-eck.com   # optional: Navigationslink
# optional: SSO_CLIENT_ID=lehrerkalender
```

`SSO_REDIRECT_URIS` ist eine kommagetrennte **exakte** Liste. Für einen
Testbetrieb also z. B.
`https://kalender.bbz-rd-eck.com/auth/sso/callback,http://localhost:3000/auth/sso/callback`.

### Kombinationen

| `AUTH_MODE` | `NOTEN_*` gesetzt | Ergebnis |
|---|---|---|
| `sso` | ja | eine Anmeldung, Klassen-Verknüpfung verfügbar |
| `ldap` | ja | zwei Anmeldungen, Klassen-Verknüpfung trotzdem verfügbar |
| `ldap`/`dev` | nein | genau wie vor dieser Erweiterung |
| `sso` | nein | Startfehler (die App bräche sonst ohne Anmeldeweg) |

Die Anbindung ist also stufenweise einführbar: erst die Verknüpfung mit
LDAP-Login testen, später auf SSO umschalten.

## Inbetriebnahme (Reihenfolge)

1. Geheimnis erzeugen: `openssl rand -base64 32`.
2. Patch in der Notenverwaltung einspielen
   ([`docs/noten-webapp/ANWENDEN.md`](noten-webapp/ANWENDEN.md)),
   ENV setzen, App neu starten.
3. Test: `curl -H "Authorization: Bearer <Geheimnis>" https://noten…/api/extern/ping`
   → `{"ok":true,…}`.
4. Kalender: `NOTEN_BASE_URL` + `NOTEN_CLIENT_SECRET` setzen, **AUTH_MODE
   zunächst auf `ldap` lassen**, neu starten. Unter *Einstellungen →
   Notenverwaltung* „Verbindung testen".
5. Eine Klasse verknüpfen, Schülerliste holen, Deep-Link prüfen.
6. Erst dann `AUTH_MODE=sso` (+ `PUBLIC_URL`) setzen und neu starten.

## Fehlersuche

| Symptom | Ursache / Abhilfe |
|---------|-------------------|
| Login-Seite meldet „Anmeldung über die Notenverwaltung fehlgeschlagen" | Geheimnisse stimmen nicht überein, oder `redirect_uri` fehlt in `SSO_REDIRECT_URIS`. Log der Notenverwaltung zeigt „unbekannter Client oder redirect_uri". |
| „Anmeldung abgelaufen – bitte erneut versuchen" | Zwischen Start und Rücksprung lagen mehr als 10 Minuten, oder das Session-Cookie ging verloren (Cookie-Einstellungen/`SECURE_COOKIES` bei HTTP prüfen). |
| Endlose Weiterleitung zwischen beiden Apps | `PUBLIC_URL` des Kalenders zeigt nicht auf die tatsächlich aufgerufene Adresse. |
| „Zu dieser Kennung gibt es hier kein aktives Konto" | Die Lehrkraft war noch nie in der Notenverwaltung angemeldet (kein Konto) oder das Konto ist deaktiviert. Einmal dort anmelden (bei aktivem Auto-Provisioning genügt das). |
| Klassenliste bleibt leer | In der Notenverwaltung ist der Person keine Klasse zugeordnet – dort prüfen (Fach-Zuweisung oder Klassenleitung). |
| „Notenverwaltung nicht erreichbar" | Firewall/DNS zwischen den Servern, falsche `NOTEN_BASE_URL`, oder Zeitlimit zu knapp (`NOTEN_TIMEOUT_MS`). |
| Nach dem Umschalten leerer Kalender | Kennung weicht ab (siehe „Kennung (`sub`)"). Die alte DB-Datei liegt unverändert in `DATA_DIR` – vor dem Umbenennen Rücksprache. |

## Abmelden

„Abmelden" im Kalender beendet **nur die Kalender-Session**; die Anmeldung an
der Notenverwaltung bleibt bestehen (ein erneuter Kalender-Aufruf meldet
dann sofort wieder an). Ein vollständiges Abmelden erfolgt über
`/logout` der Notenverwaltung. Ein Single-Logout über beide Apps ist bewusst
nicht eingebaut – es würde Lehrkräfte überraschend aus der Notentafel werfen.
