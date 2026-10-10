# CINIS – Die letzte Flamme

Single-Player Survival-/Colony-Builder im post-apokalyptischen Rom. HTML5 Canvas 2D, Vanilla JS (ES-Module), keine Libraries, keine externen Assets – alle Grafiken und Sounds werden per Code erzeugt.

## Start
- `npm start` (bzw. `node tools/serve.mjs 8080`) → http://localhost:8080
- Alternativ jeder statische Server, z. B. `python3 -m http.server 8080`. ES-Module funktionieren nicht über `file://`.

## Prüfen (nach jeder Änderung)
- `npm install` (einmalig, nur Dev-Abhängigkeit Playwright)
- `CHROMIUM_PATH=/usr/bin/chromium npm test` → lädt das Spiel headless, läuft kurz herum, bricht bei Konsolenfehlern/Exceptions/404 ab, Screenshot in `tools/out/`.
- Optionales Szenario: `node tools/smoke-test.mjs tools/scenarios/<name>.mjs` (exportiert `default async (page, ctx)`).
  Vorhanden: `gather`, `build`, `settlers`, `night`, `menu-save`, `polish` (Audio), `mobile` (390 px + Touch), `collision`, `respawn`, `wildlife`, `progression`, `balance`.
  Ein Szenario kann mit `export const query = '…'` zusätzliche URL-Parameter verlangen.
  Alle auf einmal: `for s in tools/scenarios/*.mjs; do node tools/smoke-test.mjs $s; done`
- `?play` überspringt das Hauptmenü (vom Smoke-Test genutzt), `?skiptut` schaltet alles frei (ohne Questpfad). Szenarien, die bauen, setzen `export const query = 'skiptut'`.
- Balancing: `node tools/smoke-test.mjs tools/scenarios/balance.mjs` – ein Bot spielt 30 Nächte im Schnelldurchlauf (~15 s) und gibt den Verlauf pro Nacht aus.
- `window.__game` ist die Spielinstanz (für Tests/Debug). `?seed=123` erzwingt eine Welt; der Smoke-Test nutzt `SEED` (Standard 4242).
- Eingabe-Flanken (`wasPressed`, `mouse.clicked`) nur in `Game.handleFrameInput()` auswerten – sie gelten genau einen Frame.

## Architektur (js/)
| Modul | Verantwortung |
|---|---|
| `main.js` | `Game`: Game Loop mit festem Zeitschritt (60 Hz, Tempo 1–3×), Zustände `menu/tutorial/playing/paused/over`, Spielereignisse, Render-Reihenfolge |
| `config.js` | Konstanten + Balancing |
| `util.js` | Mathe, Seed-Zufall (mulberry32), Rauschen, MinHeap |
| `input.js` | Tastatur/Maus/Touch, Flanken pro Frame (`pressed`, `mouse.clicked`) |
| `camera.js` | Kamera, ganzzahliger Pixel-Zoom, Welt↔Bildschirm |
| `world.js` | Kachelkarte, Generierung per Seed, Ressourcenknoten, A* (Navigationsraster + Zusammenhangskomponenten) + BFS-zum-Wasser (Freunde), Dijkstra-Flussfeld zur Flamme (Gegner, Gebäude = teuer, Bäume/Felsen = Hindernis), Gelände-Rendering |
| `physics.js` | Kreis-Hitboxen gegen Rechtecke/Kreise mit Gleiten, Substeps (`moveCircle`), Masken `friendly`/`enemy`/`animal` (Tore nur für `friendly`), `SpatialHash`, Trennung der Einheiten |
| `sprites.js` | Prozedurale Pixel-Grafik (Offscreen-Canvases, `inkSprite` = kräftiger + Kontur), Figuren-Zeichner (Umriss/Silhouette/Schatten), `tinted`, `drawOutlinedImage` |
| `interact.js` | Interaktionsziel in Reichweite (Provider-Liste: Knoten, Wasser, …; `addProvider`), Glow (`glowFor`), „E“-Prompt. Kandidat mit `act(game)` = eigene Aktion statt Sammeln |
| `player.js` | Spielerfigur: Bewegung, Zielwahl, Sammeln, Inventar, Abliefern |
| `buildings.js` | Gebäudedefinitionen + Kosten, Bausystem (Vorschau/Platzieren/Abriss, Bauradius), Belegungsraster (`world.buildingAt`), Brunnen-Produktion, Zeichnen |
| `settlers.js` | Siedler: Hunger/Durst, Jobvergabe (Farm), Aufgaben-Automat (gather/water/farm/eat/deliver/idle), A*-Wegfolgen, Arbeitsschwerpunkt |
| `enemies.js` | Gegnertypen, Wellenplanung `waveFor(n)`, Gegner-KI (Flussfeld → Flamme, Gebäude/Einheiten angreifen), Sonnenbrand, Randindikatoren |
| `combat.js` | Turmbolzen, `damageBuilding`, `damageUnit` |
| `time.js` | Tag/Nacht-Zyklus (`DayCycle`, Ereignisse `onDusk/onNight/onDawn` an `Game`), Lichtkarte (`Lighting`) |
| `save.js` | Spielstand in localStorage (`cinis.save.v2`, v1 wird verworfen): Seed + veränderliche Daten; Autosave alle 30 s, morgens, beim Verlassen |
| `particles.js` | Partikel, `converge` (Funken fliegen zu einem Punkt), `corpse` (zerfallende Figuren), schwebende Texte (`game.effects`); Atmosphäre-Emitter in `Game.ambientEffects` |
| `wildlife.js` | Tiere: `ANIMAL_DEFS` (game/neutral/hostile/deco), Spawn im Ring nach Biom/Tageszeit, Statemachine (Flucht, Herde, Charge, Rudeljagd, Licht meiden), Deko vereinfacht, Beute ins Inventar, Klänge |
| `progress.js` | Freischaltungen (`UNLOCKS`, `game.progress.has/unlock`) und Einstiegs-Questpfad (`QUESTS`: text/start/done/progress/target/finish), Ziel-Banner und Marker |
| `loot.js` | Beutehaufen am Boden (`game.loot.drop`), Interaktions-Provider „Beute aufheben“, Speichern |
| `audio.js` | `SoundEngine`: alle Klänge per WebAudio synthetisiert (`game.audio.play(name, vol)`), Wind-Ambience, Stummschalten (M) |
| `ui.js` | `drawEdgeArrow` (Randpfeile für Gegner/POIs), DOM-HUD (`#ui`), Minikarte, Hinweise, Toasts (`game.ui.toast(msg, kind, key)`), Overlays: Hauptmenü, Pause, Tutorial, Hilfe, Sieg/Niederlage |

## Balancing-Stellschrauben
- `js/config.js` (Spieler, Siedler, Turm, Farm, Reparatur, Trümmer pro Tag), `BUILDING_DEFS` (Kosten/LP) in `buildings.js`, `ENEMY_DEFS` + `waveFor(n)` in `enemies.js`, Tageslängen in `time.js`.

## Konventionen
- Welteinheiten: 1 Kachel = `TILE` (16) Weltpixel; Entitäten haben `x,y` = Fußpunkt in Welteinheiten.
- Simulation nur in `update(dt)` mit festem `STEP`; Rendering liest nur Zustand.
- Kommentare auf Deutsch, Bezeichner auf Englisch. Keine Frameworks, keine TODOs.
- Deterministische Weltgenerierung aus `seed` (Spielstand speichert Seed + Änderungen).
- Pro abgeschlossener Phase ein Commit.
- Bewegung nur über `world.moveEntity(e, dx, dy, r, mask)` (→ `physics.moveCircle`). Gebäude blockieren alle; nur Tore lassen `friendly` durch. Gegner greifen Gebäude im Weg an.
- Siedlerziele an Gebäuden immer über `buildings.accessPoint(b, x, y)`, an Knoten über `world.accessTile(...)`.
- Belegungsänderungen setzen `world.navDirty` (über `buildings.setTiles`) – das Navigationsraster wird bei der nächsten Wegsuche neu aufgebaut.
- `buildings.changed = true` nach jeder Belegungsänderung → Flussfeld wird im nächsten Update neu berechnet.
- Szenario-Tests können die Simulation synchron vorspulen: `for (...) game.update(1/60)`. Für Screenshots eines bestimmten Moments `game.speed = 0` setzen (friert ein, Rendering läuft weiter).
- `Game.update` pausiert für `game.hitStop` Schritte (Trefferpause) – Tests, die exakte Schrittzahlen erwarten, berücksichtigen das.
- Neue Gebäude/HUD-Teile/Mechaniken immer über `progress` freischalten (`UNLOCKS`-Eintrag); gesperrte Gebäude erscheinen nicht in der Bauleiste und lassen sich nicht platzieren.
- Treffbares: `game.forEachHittable` / `game.hittables()` (Gegner + Tiere), Treffer immer über `game.hitUnit`. Kampflärm `game.noise(x, y, r)`, Licht `game.lightAt(x, y)`.
- Dash per Shift-Flanke in `handleFrameInput` → `player.requestDash`; Bewegung über `moveEntity` (Substeps), Tore passierbar.
- Figuren: `drawHumanoid(ctx, x, y, o)` mit `walk`, `breath`, `dir`, `arm` (Weltwinkel) + `item`, `lean`, `pose`, `outline`, `silhouette`.
