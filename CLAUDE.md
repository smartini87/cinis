# CINIS – Die letzte Flamme

Single-Player Survival-/Colony-Builder im post-apokalyptischen Rom. HTML5 Canvas 2D, Vanilla JS (ES-Module), keine Libraries, keine externen Assets – alle Grafiken und Sounds werden per Code erzeugt.

## Start
- `npm start` (bzw. `node tools/serve.mjs 8080`) → http://localhost:8080
- Alternativ jeder statische Server, z. B. `python3 -m http.server 8080`. ES-Module funktionieren nicht über `file://`.

## Prüfen (nach jeder Änderung)
- `npm install` (einmalig, nur Dev-Abhängigkeit Playwright)
- `CHROMIUM_PATH=/usr/bin/chromium npm test` → lädt das Spiel headless, läuft kurz herum, bricht bei Konsolenfehlern/Exceptions/404 ab, Screenshot in `tools/out/`.
- Optionales Szenario: `node tools/smoke-test.mjs tools/scenarios/<name>.mjs` (exportiert `default async (page, ctx)`).
  Vorhanden: `gather`, `build`, `settlers`, `night`, `menu-save`, `polish` (Audio), `mobile` (390 px + Touch), `collision`, `respawn`, `wildlife`, `progression`, `intro`, `pois`, `construction`, `walls`, `crafting`, `flame`, `endless`, `balance`.
  `export const noWalk = true` schaltet das Herumlaufen vor dem Szenario ab.
  Ein Szenario kann mit `export const query = '…'` zusätzliche URL-Parameter verlangen.
  Alle auf einmal: `for s in tools/scenarios/*.mjs; do node tools/smoke-test.mjs $s; done`
- `?play` überspringt das Hauptmenü (vom Smoke-Test genutzt), `?skiptut` schaltet alles frei (ohne Questpfad). Szenarien, die bauen, setzen `export const query = 'skiptut'`.
- Balancing: `node tools/smoke-test.mjs tools/scenarios/balance.mjs` – ein Bot spielt den Questpfad und dann endlos (höchstens 60 Nächte) im Schnelldurchlauf (~20–40 s) und gibt den Verlauf pro Nacht aus. `SEED=…` wählt die Welt, `BOT=towers` die Vergleichsstrategie „nur Türme“. Ziel: im Mittel 12–18 Nächte.
- `?intro` erzwingt das Intro.
- `window.__game` ist die Spielinstanz (für Tests/Debug). `?seed=123` erzwingt eine Welt; der Smoke-Test nutzt `SEED` (Standard 4242).
- Eingabe-Flanken (`wasPressed`, `mouse.clicked`) nur in `Game.handleFrameInput()` auswerten – sie gelten genau einen Frame.

## Architektur (js/)
| Modul | Verantwortung |
|---|---|
| `main.js` | `Game`: Game Loop mit festem Zeitschritt (60 Hz, Tempo 1–3×), Zustände `menu/intro/playing/paused/over`, Spielereignisse, Render-Reihenfolge |
| `config.js` | Konstanten + Balancing |
| `util.js` | Mathe, Seed-Zufall (mulberry32), Rauschen, MinHeap |
| `input.js` | Tastatur/Maus/Touch, Flanken pro Frame (`pressed`, `mouse.clicked`) |
| `camera.js` | Kamera, ganzzahliger Pixel-Zoom, Welt↔Bildschirm |
| `world.js` | Kachelkarte, Generierung per Seed, Ressourcenknoten (Baum, Fels, Strauch, Kräuter, Aschehaufen), Requisiten (`props`), Erkundung (`explored`), A* (Navigationsraster + Zusammenhangskomponenten) + BFS-zum-Wasser (Freunde), Dijkstra-Flussfelder zur Flamme (normal: Mauern teuer; Brecher: Mauern billig), Gelände-Rendering |
| `physics.js` | Kreis-Hitboxen gegen Rechtecke/Kreise mit Gleiten, Substeps (`moveCircle`), Masken `friendly`/`enemy`/`animal` (Tore nur für `friendly`), Mauerformen nach Rotation/Nachbarn (`buildingRects`), `SpatialHash`, Trennung der Einheiten |
| `sprites.js` | Prozedurale Pixel-Grafik (Offscreen-Canvases, `inkSprite` = kräftiger + Kontur), Figuren-Zeichner (Umriss/Silhouette/Schatten), `tinted`, `drawOutlinedImage` |
| `interact.js` | Interaktionsziel in Reichweite (Provider-Liste: Knoten, Wasser, …; `addProvider`), Glow (`glowFor`), „E“-Prompt. Kandidat mit `act(game)` = eigene Aktion statt Sammeln |
| `player.js` | Spielerfigur: Bewegung mit Beschleunigung, Dash/Sprint/Energie, Angriff (Ausholen/Schlag/Trail/Trefferpause), Sammeln mit Fortschritt, Gepäck, Abliefern, Tod/Rückkehr, Fackel/Verband, Autopilot `botMove` (Bot) |
| `buildings.js` | Gebäudedefinitionen + Kosten, Bausystem (Vorschau/Platzieren/Abriss, Bauradius), Baustellen (`b.site`, `deliverTo`, `playerDeliver`, `completeSite`), Belegungsraster (`world.buildingAt`), Brunnen-Produktion, Zeichnen |
| `settlers.js` | Siedler: Gaben (`TRAITS`), wartend/folgend/Kolonie, Hunger/Durst, Jobvergabe (Farm), Aufgaben-Automat (gather/water/farm/eat/deliver/fetch/build/shelter/idle), A*-Wegfolgen, Rettungsnetz `unstick`, Arbeitsschwerpunkt |
| `enemies.js` | Gegnertypen (Aschgänger, Läufer, Schwarm, Brecher, Fernkämpfer, Koloss, Boss, Elite), endlose Wellenplanung `waveFor(n)`, Gegner-KI (Flussfeld bzw. Brecher-Flussfeld → Flamme, Fernkampf, Boss-Fähigkeiten, Wächter, Fallen), Sonnenbrand, Randindikatoren |
| `combat.js` | Turmbolzen, Glutwürfe der Fernkämpfer (`fireShot`), `damageBuilding`, `damageUnit` (Rüstung, Unverwundbarkeit) |
| `time.js` | Tag/Nacht-Zyklus (`DayCycle`, Ereignisse `onDusk/onNight/onDawn` an `Game`), Lichtkarte (`Lighting`) |
| `save.js` | Spielstand in localStorage (`cinis.save.v4`, v1–v3 werden mit Hinweis verworfen): Seed + veränderliche Daten; Autosave alle 30 s, morgens, beim Verlassen |
| `particles.js` | Partikel, `converge` (Funken fliegen zu einem Punkt), `corpse` (zerfallende Figuren), schwebende Texte (`game.effects`); Atmosphäre-Emitter in `Game.ambientEffects` |
| `wildlife.js` | Tiere: `ANIMAL_DEFS` (game/neutral/hostile/deco), Spawn im Ring nach Biom/Tageszeit, Statemachine (Flucht, Herde, Charge, Rudeljagd, Licht meiden), Deko vereinfacht, Beute ins Inventar, Klänge |
| `progress.js` | Freischaltungen (`UNLOCKS`, `game.progress.has/unlock`) und Einstiegs-Questpfad (`QUESTS`: text/start/done/progress/target/finish), Ziel-Banner und Marker |
| `intro.js` | Intro-Sequenz (Zustand `intro`): Schreibmaschinentext, Kamerafahrt mit Parallax, Ankunft mit Funken/Aufstehen; überspringbar |
| `pois.js` | Orte in der Wildnis (deterministisch aus Seed, 3 Ringe): Lager (wartende Siedler), Feindlager (Wächter `e.guard`, Truhe + Bauplan), Verlies, Schrein, Signalfeuer, Wagen (Hinterhalt), Wanderer, Meilensteine; Entdecken, Lichter, Rauch, Krähen, Speichern |
| `items.js` | Gegenstände (`ITEMS`) und `itemInfo(id)` für Rohstoffe und Gegenstände |
| `inventory.js` | Slot-Inventar (`add/remove/count/room`, Kurzzugriffe `inv.wood`) |
| `recipes.js` | Rezepte je Station (`RECIPES`, `craft`, `recipeUnlocked`) |
| `flame.js` | Ewige Flamme als Fortschritt: `FLAME_LEVELS` (Kosten, Licht, Bauradius, Siedler, Aura, Brennstoff), Glut (`vigor`), `burnForNight`, `feed`, `upgrade` |
| `highscore.js` | Bestenliste (`cinis.highscore.v1`): `recordScore`, `loadScores`, `bestScore` |
| `loot.js` | Beutehaufen am Boden (`game.loot.drop`), Interaktions-Provider „Beute aufheben“, Speichern |
| `audio.js` | `SoundEngine`: alle Klänge per WebAudio synthetisiert (`game.audio.play(name, vol)`), Wind-Ambience, Stummschalten (M) |
| `ui.js` | `drawEdgeArrow` (Randpfeile für Gegner/POIs), DOM-HUD (`#ui`) mit Freischalt-Sichtbarkeit, Ziel-Banner, Bauleiste mit Kategorien, Flammen-/Glut-Anzeige, Gepäck-Hotbar, Minikarte mit Nebel und Orten, Hinweise, Toasts (`game.ui.toast(msg, kind, key)`), Overlays: Hauptmenü (Bestenliste), Pause, Hilfe, Inventar, Herstellen, Flamme, Händler, Game Over |

## Balancing-Stellschrauben
- `js/config.js` (Spieler, Siedler, Turm, Farm, Reparatur, Trümmer pro Tag), `BUILDING_DEFS` (Kosten/LP/Freischaltung) in `buildings.js`, `FLAME_LEVELS` in `flame.js`, `RECIPES` in `recipes.js`, `ENEMY_DEFS` + `waveFor(n)` in `enemies.js`, Tageslängen in `time.js`.

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
- POI-Generierung muss beim Laden identisch sein: Zufallswerte aus dem Seed-RNG immer ziehen, auch wenn (beim Laden) keine Siedler/Wächter erzeugt werden. Feste Requisiten setzen `world.props` (blockiert alle, Flussfeld und Navigation).
- Mauern/Tore haben `rot` (0 waagerecht, 1 senkrecht, 2 ↘, 3 ↗; Tore nur 0/1). `buildings.place(game, type, tx, ty, rot)`; Linien über `lineTiles`/`placeTiles`.
- `buildings.place` legt immer eine Baustelle an; `count()`/`ofType()` zählen nur fertige Gebäude (`countAll` inkl. Baustellen). Tests, die fertige Gebäude brauchen, rufen `buildings.finishAllSites(game)`.
- Siedler mit `mode` ('waiting'/'follow') gehören nicht zur Kolonie – Kolonie immer über `settlers.colony`.
- Spieler-Inventar nur über `player.inv` (Slots). Beute an den Spieler über `pois.give(game, x, y, items)` (Überschuss wird zum Beutehaufen).
- Panels (Inventar, Herstellen, Handel) pausieren über `game.openPanel/closePanel`.
- Baubarkeit: `game.isAvailable(type)` = Einstieg freigeschaltet (`progress.has('b:x')`) und `unlockMet` (Flammenstufe/Bauplan). Bauleiste in `BUILD_CATEGORIES`.
- Neue Gebäude/HUD-Teile/Mechaniken immer über `progress` freischalten (`UNLOCKS`-Eintrag); gesperrte Gebäude erscheinen nicht in der Bauleiste und lassen sich nicht platzieren.
- Treffbares: `game.forEachHittable` / `game.hittables()` (Gegner + Tiere), Treffer immer über `game.hitUnit`. Kampflärm `game.noise(x, y, r)`, Licht `game.lightAt(x, y)`.
- Dash per Shift-Flanke in `handleFrameInput` → `player.requestDash`; Bewegung über `moveEntity` (Substeps), Tore passierbar.
- Figuren: `drawHumanoid(ctx, x, y, o)` mit `walk`, `breath`, `dir`, `arm` (Weltwinkel) + `item`, `lean`, `pose`, `outline`, `silhouette`.
