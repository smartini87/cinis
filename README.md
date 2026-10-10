# CINIS – Die letzte Flamme

Rom ist gefallen. Asche bedeckt die sieben Hügel, und nachts kriecht sie als Gestalt aus den Ruinen. Im Zentrum brennt die **Ewige Flamme** – das letzte Licht der Stadt. Sammle Rohstoffe, versorge deine Siedler, baue Mauern und Ballistentürme und verteidige die Flamme **30 Nächte** lang.

Single-Player Survival-/Colony-Builder als HTML5-Spiel: Canvas 2D, Vanilla JavaScript (ES-Module), keine Libraries, keine externen Assets. Grafik (Pixel-Look) und Sound (WebAudio) werden komplett per Code erzeugt.

## Starten

```bash
npm start                    # startet node tools/serve.mjs auf Port 8080
# oder ein beliebiger statischer Server:
python3 -m http.server 8080
```

Dann **http://localhost:8080** öffnen. Wegen der ES-Module funktioniert das direkte Öffnen per `file://` nicht.

URL-Parameter: `?seed=123` erzeugt eine bestimmte Welt, `?play` überspringt das Hauptmenü.

## Steuerung

| Aktion | Tastatur / Maus | Touch |
|---|---|---|
| Bewegen | WASD / Pfeiltasten | linke Bildschirmseite ziehen (Joystick) |
| Sammeln & angreifen | Leertaste, E oder linke Maustaste **halten** (zielt auf den Mauszeiger) | Ziel antippen und halten |
| Gebäude wählen | 1 – 5 oder Klick auf die Bauleiste | Bauleiste antippen |
| Gebäude setzen | Linksklick (Mauern: Maustaste halten und ziehen) | Bauplatz antippen |
| Bauen abbrechen | Rechtsklick oder Esc | Gebäude in der Bauleiste erneut antippen |
| Abriss (50 % zurück) | X, dann Gebäude anklicken | „Abriss“ antippen, dann Gebäude |
| Spieltempo 1× / 2× / 3× | F | Knopf oben rechts |
| Pause | P oder Esc | Knopf oben rechts |
| Ton an/aus | M | Knopf oben rechts |
| Hilfe | H | Knopf „?“ |
| Zoom | Mausrad | – |
| FPS-Anzeige | F3 | – |

## Spielanleitung

### Ziel
Überlebe 30 Nächte. Mit dem Morgengrauen nach der 30. Nacht hast du gewonnen. Wird die Ewige Flamme zerstört, ist das Spiel verloren. Fällt deine Spielfigur, kehrt sie nach 8 Sekunden an der Flamme zurück (getragene Ressourcen gehen verloren).

### Ressourcen
| Ressource | Quelle |
|---|---|
| **Holz** | Pinien und Zypressen fällen. Stümpfe wachsen nach einiger Zeit nach. |
| **Stein** | Säulentrümmer in Ruinen brechen. Die Ruinen zerfallen weiter: jeden Morgen entstehen neue Trümmer. |
| **Nahrung** | Feigensträucher (wachsen nach) und Farmen. |
| **Wasser** | Am Ufer von Fluss und Teich schöpfen; Brunnen fördern automatisch. |

Du trägst bis zu 30 Einheiten. In der Nähe der Flamme wird automatisch ins Lager abgeliefert. Baukosten werden zuerst aus dem Lager und dann aus deinem Inventar bezahlt.

### Gebäude
| Taste | Gebäude | Kosten | Wirkung |
|---|---|---|---|
| 1 | Hütte (2×2) | 20 Holz, 5 Stein | +2 Siedlerplätze, nachts Schutz für 2 Siedler |
| 2 | Farm (2×2) | 14 Holz, 6 Wasser | Ein Siedler baut Nahrung an (4 pro Ernte) |
| 3 | Brunnen | 4 Holz, 12 Stein | +1 Wasser alle 9 s |
| 4 | Mauer | 4 Stein | 320 LP, hält Gegner auf; eigene Leute gehen durch (Tore) |
| 5 | Turm | 20 Holz, 18 Stein | Ballista, 6 Felder Reichweite |

Gebaut werden kann im Umkreis von 12 Feldern um die Flamme und 6 Feldern um jedes andere Gebäude. Tagsüber reparieren die Siedler beschädigte Gebäude automatisch.

### Siedler
- Du startest mit 3 Siedlern. Jeden Morgen kommt ein neuer hinzu, wenn ein Platz frei ist (Flamme: 3, jede Hütte: +2) und 8 Nahrung im Lager liegen.
- Siedler haben **Hunger** und **Durst**. Sie essen und trinken selbstständig aus dem Lager. Fehlt beides zu lange, verlieren sie Leben und sterben.
- Farmen bekommen automatisch einen Arbeiter. Alle anderen sammeln. Links im HUD legst du den **Arbeitsschwerpunkt** fest (Auto, Holz, Stein, Nahrung, Wasser). „Auto“ sammelt, was gerade am knappsten ist.
- Nachts und wenn Gegner in der Nähe sind, flüchten Siedler in Hütten oder zur Flamme. Wird ihre Hütte zerstört, fliehen sie ins Freie.

### Nächte und Gegner
Ein Tag dauert 150 s, eine Nacht 75 s. In der Abenddämmerung wird angekündigt, wie viele Feinde aus welcher Richtung kommen. Rote Pfeile am Bildschirmrand und die Minikarte zeigen Gegner außerhalb der Sicht. Mit jeder Nacht kommen mehr und stärkere Gegner. Das erste Sonnenlicht verbrennt alle Überlebenden.

| Gegner | ab Nacht | Eigenschaften |
|---|---|---|
| Aschgänger | 1 | Standardgegner |
| Ruinenhund | 3 | schnell, schwach, jagt Einheiten |
| Aschkoloss | 5 | langsam, zäh, doppelter Schaden an Gebäuden |
| Prätor der Asche | 10, 20, 25, 30 | Boss |

Gegner laufen auf dem kürzesten Weg zur Flamme. Ist der Umweg um eine Mauer zu lang, schlagen sie sich durch. Spieler und Siedler in ihrer Nähe greifen sie direkt an.

### Tipps
- Baue vor der ersten Nacht eine Hütte und einen Turm.
- Brunnen und Farm früh bauen – Siedler ohne Versorgung arbeiten nicht lange.
- Furten im Fluss und Straßen sind natürliche Engstellen. Türme hinter Mauerringen sind am wirksamsten.
- In den Bossnächten (10, 20, 25, 30) lohnt es sich, selbst an der Flamme zu kämpfen.

### Speichern
Das Spiel speichert automatisch im Browser (localStorage): alle 30 Spielsekunden, bei jedem Morgengrauen, beim Verlassen der Seite und über „Speichern & Hauptmenü“. Im Hauptmenü setzt „Fortsetzen“ den letzten Stand fort. Nach Sieg oder Niederlage wird der Spielstand gelöscht.

## Getroffene Annahmen (Designentscheidungen)
- **Eigene Welt:** Name, Figuren, Gegner und Texte sind eigenständig. Die Karte wird per Seed prozedural erzeugt: Fluss mit Furten, Teich, Römerstraßen, Ruinenfelder und Aschefelder.
- **Lager an der Flamme:** Die Ewige Flamme ist zugleich Zentrum und einziges Lager. Ressourcen zählen erst nach dem Abliefern.
- **Tore statt Türen:** Eigene Einheiten passieren alle eigenen Gebäude, auch Mauern. Gegner nicht. Das hält die Wegfindung robust und Mauern trotzdem sinnvoll.
- **Sofortbau:** Gebäude stehen sofort, ohne Bauphase. Reparatur ist als tägliche Regeneration abstrahiert (1 % LP/s, Flamme 0,5 % LP/s).
- **Nur Siedler essen und trinken.** Die Spielfigur hat keine Bedürfnisse, regeneriert aber Leben, wenn sie eine Weile nicht getroffen wurde.
- **Siedler-Zuzug:** höchstens ein neuer Siedler pro Morgen, gegen Nahrung und nur bei freiem Platz.
- **Stein wächst nach:** Ohne Nachschub ginge der Stein ab etwa Nacht 19 aus (im Balancing-Bot beobachtet). Deshalb erzeugen zerfallende Ruinen jeden Morgen 5 neue Trümmer.
- **Gegner sterben bei Tagesanbruch** (Sonnenbrand). Es geht ums Durchhalten, nicht ums vollständige Aufräumen.
- **Schwierigkeit:** Ein Bot mit festen Bauregeln gewinnt mit etwa 48 Türmen knapp. Die Nächte 2–3 und die Bossnächte sind am gefährlichsten. Feinjustierung über `js/config.js` und `waveFor()` in `js/enemies.js`.
- **Spieltempo:** 1×, 2× und 3× wählbar, weil 30 volle Tage bei 1× rund 110 Minuten dauern.

## Entwicklung
Architektur, Konventionen und Testablauf stehen in [`CLAUDE.md`](CLAUDE.md). Kurzfassung:

```bash
npm install                                   # nur Dev-Abhängigkeit: Playwright
CHROMIUM_PATH=/usr/bin/chromium npm test      # Headless-Smoke-Test (Konsole muss fehlerfrei sein)
node tools/smoke-test.mjs tools/scenarios/balance.mjs   # Bot spielt 30 Nächte im Schnelldurchlauf
```
