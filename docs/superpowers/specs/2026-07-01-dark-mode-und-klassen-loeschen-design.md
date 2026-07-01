# Design: Dark Mode (3-stufig) + Klassen-Löschen sichtbarer machen

**Datum:** 2026-07-01
**Branch:** `claude/teacher-calendar-ldap-auth-0hfft8`
**Betrifft:** ausschließlich `public/index.html` (Frontend/PWA), Backend unverändert.

## Ausgangslage

- **Theming:** Die Farben sind bereits vollständig über CSS-Variablen (`--bg`,
  `--tx`, …) abgebildet. Ein Dark-Mode existiert, aber **nur automatisch** über
  `@media(prefers-color-scheme:dark)` — ohne manuellen Schalter.
- **Klassen löschen:** Funktioniert bereits (`deleteKlasse()`, Zeile ~1100),
  erreichbar über ein **blasses, freischwebendes „⋮"-Icon** neben dem
  Klassenreiter (Zeile ~686) → Dialog „Klasse bearbeiten" mit rotem
  Löschen-Button. Problem ist reine **Auffindbarkeit**, nicht Funktion.

## Feature 1 — Dark Mode (3-stufig, persistiert + synchronisiert)

### Entscheidungen (mit Nutzer abgestimmt)

- 3 Modi: **System / Hell / Dunkel** (`system` folgt dem OS wie bisher).
- Auswahl **gespeichert** und **serverseitig synchronisiert**.
- Bedienung über **Icon in der Kopfzeile** + vollständige Auswahl in den
  **Einstellungen**.

### Datenmodell

Neuer Key **`pref_theme`** in localStorage, Werte `'system' | 'light' | 'dark'`,
Default `'system'`. Durch das `pref_`-Präfix greift der bestehende Sync-Mechanismus
(`__lkAppKey`, `lkPush`) automatisch — inkl. korrektem Verhalten beim Nutzerwechsel.

### Theme-Anwendung

- Funktion **`applyTheme()`**: liest `pref_theme`; bei `'system'` wird
  `matchMedia('(prefers-color-scheme: dark)').matches` ausgewertet; setzt
  `document.documentElement.dataset.theme` auf effektiv `'light'`/`'dark'` und
  aktualisiert `<meta name="theme-color">` passend zur Palette.
- **FOUC-Vermeidung:** ein minimales Inline-Script **ganz früh im `<head>`**
  liest `pref_theme` aus localStorage und setzt `data-theme` vor dem ersten
  Paint.
- Im `'system'`-Modus aktualisiert ein `change`-Listener auf dem
  `matchMedia`-Objekt live bei OS-Wechsel. Der Listener prüft selbst, ob der
  Modus noch `'system'` ist (kein Add/Remove-Jonglieren nötig).
- Nach dem Server-State-Load im Bootstrap wird `applyTheme()` erneut aufgerufen,
  damit ein vom Server nachgeladenes `pref_theme` sofort greift.

### CSS-Umbau

- `:root` behält die **Hell-Palette** (unverändert).
- Neuer Block **`:root[data-theme="dark"]{…}`** mit der **bereits vorhandenen**
  Dunkel-Palette (aus dem heutigen Media-Query übernommen).
- Der `@media(prefers-color-scheme:dark)`-Block bleibt als **No-JS-Fallback**,
  aber auf `:root:not([data-theme])` eingeschränkt, damit eine explizite Wahl
  ihn überstimmt.

### UI

- **Kopfzeile:** kleines Sonne/Mond-Icon als **persistentes** Element in
  `.topbar` (außerhalb `#topbar-act`, das bei jedem Render überschrieben wird).
  Klick zykelt System → Hell → Dunkel; Icon spiegelt den effektiven Modus, ein
  kurzer Toast nennt den gewählten Modus.
- **Einstellungen** (`renderEinstellungen`): beschriftetes 3er-Segmented-Control
  (System / Hell / Dunkel), markiert den aktiven Modus.
- **`setTheme(mode)`**: speichert `pref_theme` via `sv()` (inkl. Sync), ruft
  `applyTheme()`, aktualisiert Icon + Segmented-Control.

## Feature 2 — Bearbeiten/Löschen in die Klassen-Pille integrieren

In `renderKlassen` (Zeile ~682–688) die Reiter umbauen:

- Statt Pille + freischwebendem „⋮" eine **zusammenhängende Pille**: zwei
  lückenlos nebeneinanderliegende Buttons mit gemeinsamer Optik (Radius links am
  Namen, rechts am Icon; dünner Trenner), sodass es wie **ein** Element wirkt.
  Kein verschachteltes Button-in-Button (valides HTML).
- Auf dem **aktiven** Reiter erscheint rechts ein deutlich sichtbares
  **Stift-Icon**, das den bestehenden „Klasse bearbeiten"-Dialog öffnet
  (Umbenennen + roter Löschen-Button — unverändert).
- **Nicht-aktive** Klassen zeigen nur den Namen; das Icon erscheint nach
  Auswahl — hält die Leiste ruhig.
- Neue CSS-Klassen (z. B. `.kltab-edit`); `deleteKlasse`/`openEditKlasse`
  logisch unverändert.

## Tests & Verifikation

- Reine Frontend-/CSS-Änderungen, kein Frontend-Testharness im Projekt →
  **manuelle Verifikation im Preview**: Theme System/Hell/Dunkel umschalten,
  Persistenz über Reload, `pref_theme`-Sync; Klasse anlegen/bearbeiten/löschen.
- Backend unverändert → keine neuen Server-Tests; die bestehenden 31 Tests
  bleiben grün (Regressionscheck via `npm test`).

## Nicht-Ziele

- Keine Änderung an Auth, Sync-Mechanismus oder Server-Routen.
- Keine neue Löschlogik (existiert bereits) — nur bessere Auffindbarkeit.
- Keine zusätzlichen Dependencies.
