# Design: Responsive Design (Smartphone + Tablet)

**Datum:** 2026-07-02
**Betrifft:** ausschließlich `public/index.html` (Frontend/PWA), Backend unverändert.

## Ziel

Die App auf Smartphones (Hochkant ~375–430px) **und** Tablets (~768–1024px) gut
bedienbar machen. Beide Gerätetypen gleichwertig.

## Ausgangslage

- Layout = Flex-Zeile: feste Sidebar 210px + Hauptbereich; ein einziger
  Breakpoint (`max-width:700px`) schrumpft die Sidebar auf eine 52px-Icon-Leiste.
- Wochenplan: CSS-Grid `52px repeat(5,1fr)` (Zeit + 5 Tage) — auf dem Handy unbrauchbar eng.
- Modals haben bereits `max-width:100%` + `max-height:88dvh` + Scroll → auf kleinen
  Screens ok, **kein Änderungsbedarf**.
- Tabellen (Klassenbuch/Stundenplan/Halbjahr) scrollen bereits horizontal.

## Entscheidungen (mit Nutzer abgestimmt)

- Zielgeräte: Phone **und** Tablet gleichwertig.
- Mobile Navigation: **Bottom-Tab-Bar** (Phone).
- Wochenplan auf dem Phone: **Einzeltag + Wischen/Blättern**.

## 1. Breakpoints

- **Desktop > 900px:** volle 210px-Sidebar (unverändert).
- **Tablet 601–900px:** 52px-Icon-Rail-Sidebar (heutiges Verhalten, von 700 auf 900
  angehoben), keine Bottom-Bar.
- **Phone ≤ 600px:** Sidebar ausgeblendet, **Bottom-Tab-Bar** sichtbar, Inhalt volle
  Breite, größere Touch-Ziele, `.content` bekommt unten Platz für die Bar
  (inkl. `env(safe-area-inset-bottom)`).

## 2. Bottom-Tab-Bar (Phone)

Fixe Leiste unten, nur ≤600px sichtbar. 5 Einträge:
Woche · Halbjahr · Klassenbuch · Stundenplan · **Mehr (⋯)**.

- „Mehr" öffnet ein kleines Overlay-Sheet mit Ferien / Import / Einstellungen.
- Aktiver Tab hervorgehoben; `showView()` wird erweitert, sodass es **sowohl**
  die Sidebar- als auch die Bottom-Bar-Markierung setzt (Views außerhalb der Bar
  markieren „Mehr").
- Safe-Area unten berücksichtigt; Theme-Toggle bleibt in der Kopfzeile.

## 3. Wochenplan als Einzeltag (Phone)

- Neuer Zustand `S.mobileDay` (0–4, Default = heutiger Wochentag, sonst 0).
- Helper `isPhone()` = `matchMedia('(max-width:600px)').matches`.
- `renderWoche` rendert `showDays = isPhone() ? [S.mobileDay] : [0..4]`; das Grid
  bekommt inline `grid-template-columns:52px repeat(showDays.length,1fr)`.
- Tageswechsler (nur Phone, via CSS ein-/ausgeblendet): ‹ · Mo–Fr-Pills · ›,
  aktiver Tag markiert; `setMobileDay(d)` (clampt 0–4) + `render()`.
- **Wischen** auf dem Wochen-Container (touchstart/touchend, Schwelle ~40px):
  links → nächster, rechts → voriger Tag.
- **Resize/Drehen:** debounced Listener; wechselt der Phone-Zustand, wird in der
  Wochenansicht neu gerendert (damit Grid + Einzeltag korrekt umschalten).

## 4. Touch-Ziele & Feinschliff

- Phone: `.btn`, `.kltab`, `.segbtn`, Bottom-Bar-Buttons auf ≥ ~40–44px Tapfläche.
- Kopfzeile auf dem Phone kompakter (weniger Padding).
- Tabellen bleiben horizontal scrollbar (klebende erste Spalte, sanftes
  Touch-Scrolling) — keine strukturelle Änderung.

## 5. Verifikation

Kein Frontend-Testharness → Preview bei **375px (Phone)** und **768px (Tablet)**,
hell/dunkel; Kern-Flows: Tag wischen/blättern, Bottom-Bar-Navigation inkl. „Mehr",
Klasse löschen, Modal öffnen. Backend unberührt → die 36 Node-Tests bleiben grün.

## Nicht-Ziele

- Keine Backend-/Auth-Änderung, keine neuen Dependencies.
- Kein Umbau der Tabellen auf Karten-Layouts (horizontales Scrollen genügt).
- Modals bleiben wie sie sind (schon responsiv).
