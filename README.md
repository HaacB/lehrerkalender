# Lehrerkalender / Lehrerplaner BBZ RD-ECK

Ein digitaler Lehrerkalender als **Progressive Web App (PWA)** – läuft im Browser,
kann wie eine App installiert werden und funktioniert auch offline. Alle Daten
bleiben lokal im Browser (localStorage), keine Übertragung an externe Server.

## Funktionsumfang

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

## Nutzung

### Lokal öffnen
1. Repository herunterladen / entpacken
2. `index.html` im Browser öffnen
3. Fertig – Daten bleiben im Browser

### Als App installieren
- **Chrome/Edge Desktop:** Adressleiste → Installieren-Symbol
- **iPhone/Safari:** Teilen → Zum Home-Bildschirm
- **Android/Chrome:** Menü → App installieren

## Struktur

```
index.html      – komplette App (HTML, CSS, JS in einer Datei)
manifest.json   – PWA-Manifest
sw.js           – Service Worker (Offline-Cache)
icons/          – App-Icons (192px, 512px)
ANLEITUNG.md    – ausführliche Dokumentation & Roadmap (bbz-cloud-Integration)
```

## Roadmap

Nächster Schritt ist die Integration in die **bbz-cloud** (Nextcloud SSO, SQLite,
Einbindung in bbzcloud-mobil). Details, Architektur-Entscheidungen und offene
Fragen stehen in [ANLEITUNG.md](ANLEITUNG.md).

## Datenschutz

Alle Daten bleiben lokal im Browser. Schülernamen sind personenbezogene Daten →
nur auf Dienstgeräten nutzen.

## Lizenz

[MIT](LICENSE) · Entwickelt mit Claude · BBZ Rendsburg-Eckernförde · 2025/26
