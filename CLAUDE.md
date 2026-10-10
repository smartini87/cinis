# CINIS – Die letzte Flamme

Single-Player Survival-/Colony-Builder im post-apokalyptischen Rom. HTML5 Canvas 2D, Vanilla JS (ES-Module), keine Libraries, keine externen Assets – alle Grafiken und Sounds werden per Code erzeugt.

## Start
- `npm start` (bzw. `node tools/serve.mjs 8080`) → http://localhost:8080
- Alternativ jeder statische Server, z. B. `python3 -m http.server 8080`. ES-Module funktionieren nicht über `file://`.

## Prüfen (nach jeder Änderung)
- `npm install` (einmalig, nur Dev-Abhängigkeit Playwright)
- `CHROMIUM_PATH=/usr/bin/chromium npm test` → lädt das Spiel headless, läuft kurz herum, bricht bei Konsolenfehlern/Exceptions/404 ab, Screenshot in `tools/out/`.
- Optionales Szenario: `node tools/smoke-test.mjs tools/scenarios/<name>.mjs` (exportiert `default async (page, ctx)`).
- `window.__game` ist die Spielinstanz (für Tests/Debug). `?seed=123` erzwingt eine Welt; der Smoke-Test nutzt `SEED` (Standard 4242).
- Eingabe-Flanken (`wasPressed`, `mouse.clicked`) nur in `Game.handleFrameInput()` auswerten – sie gelten genau einen Frame.

## Architektur (js/)
| Modul | Verantwortung |
|---|---|
| `main.js` | `Game`: Game Loop mit festem Zeitschritt (60 Hz), Zustandswechsel, Render-Reihenfolge |
| `config.js` | Konstanten + Balancing |
| `util.js` | Mathe, Seed-Zufall (mulberry32), Rauschen, MinHeap |
| `input.js` | Tastatur/Maus/Touch, Flanken pro Frame (`pressed`, `mouse.clicked`) |
| `camera.js` | Kamera, ganzzahliger Pixel-Zoom, Welt↔Bildschirm |
| `world.js` | Kachelkarte, Generierung per Seed, Ressourcenknoten, Kollision, Gelände-Rendering |
| `sprites.js` | Prozedurale Pixel-Grafik (Offscreen-Canvases) + Figuren-Zeichner |
| `player.js` | Spielerfigur: Bewegung, Zielwahl, Sammeln, Inventar, Abliefern |
| `buildings.js` | Gebäudedefinitionen + Kosten, Bausystem (Vorschau/Platzieren/Abriss, Bauradius), Belegungsraster (`world.buildingAt`), Brunnen-Produktion, Zeichnen |
| `particles.js` | Partikel + schwebende Texte (`game.effects`) |
| `ui.js` | DOM-HUD (`#ui`), Hinweise, Toasts (`game.ui.toast(msg, kind, key)`) |

## Konventionen
- Welteinheiten: 1 Kachel = `TILE` (16) Weltpixel; Entitäten haben `x,y` = Fußpunkt in Welteinheiten.
- Simulation nur in `update(dt)` mit festem `STEP`; Rendering liest nur Zustand.
- Kommentare auf Deutsch, Bezeichner auf Englisch. Keine Frameworks, keine TODOs.
- Deterministische Weltgenerierung aus `seed` (Spielstand speichert Seed + Änderungen).
- Pro abgeschlossener Phase ein Commit.
