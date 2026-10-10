# CINIS – Die letzte Flamme

Rom ist gefallen. Asche bedeckt die sieben Hügel, und nachts kriecht sie als Gestalt aus den Ruinen. Im Zentrum brennt die **Ewige Flamme** – das letzte Licht der Stadt. Sammle Rohstoffe, versorge deine Siedler, baue Mauern und Ballistentürme und verteidige die Flamme **30 Nächte** lang.

Single-Player Survival-/Colony-Builder als HTML5-Spiel: Canvas 2D, Vanilla JavaScript (ES-Module), keine Libraries, keine externen Assets. Grafik (Pixel-Look) und Sound (WebAudio) werden komplett per Code erzeugt.

**Online spielen:** https://smartini87.github.io/cinis/

## Starten

```bash
npm start                    # startet node tools/serve.mjs auf Port 8080
# oder ein beliebiger statischer Server:
python3 -m http.server 8080
```

Dann **http://localhost:8080** öffnen. Wegen der ES-Module funktioniert das direkte Öffnen per `file://` nicht.

URL-Parameter: `?seed=123` erzeugt eine bestimmte Welt, `?play` überspringt das Hauptmenü, `?skiptut` schaltet alles frei, `?intro` spielt das Intro ab.

## Steuerung

| Aktion | Tastatur / Maus | Touch |
|---|---|---|
| Bewegen | WASD / Pfeiltasten | linke Bildschirmseite ziehen (Joystick) |
| Dash / Sprint | Shift drücken = Dash (kurzer Schub, kurz unverwundbar); Shift halten = Sprinten | Knopf „Dash“ (halten = Sprint) |
| Sammeln & angreifen | Leertaste, E oder linke Maustaste **halten** (zielt auf den Mauszeiger) | Ziel antippen und halten |
| Gebäude wählen | 1 – 6 oder Klick auf die Bauleiste | Bauleiste antippen |
| Gebäude setzen | Linksklick (Mauern: Maustaste halten und eine Linie ziehen) | Bauplatz antippen |
| Mauer/Tor drehen | R oder Mausrad im Baumodus (Auto, waagerecht, senkrecht, diagonal ↘, diagonal ↗) | – |
| Bauen abbrechen | Rechtsklick oder Esc | Gebäude in der Bauleiste erneut antippen |
| Material liefern | E an einer Baustelle | Baustelle antippen |
| Abriss (50 % zurück, Baustelle 75 % des Gelieferten) | X, dann Gebäude anklicken | „Abriss“ antippen, dann Gebäude |
| Spieltempo 1× / 2× / 3× | F | Knopf oben rechts |
| Pause | P oder Esc | Knopf oben rechts |
| Ton an/aus | M | Knopf oben rechts |
| Hilfe | H | Knopf „?“ |
| Zoom | Mausrad | – |
| FPS-Anzeige | F3 | – |

## Spielanleitung

### Intro
Beim allerersten neuen Spiel läuft eine kurze Sequenz von etwa 20 Sekunden: vier Sätze auf Schwarz, eine Kamerafahrt über die Aschelandschaft zur Flamme und die Ankunft des Hüters in einem Funkenregen. Jede Taste oder ein Tipp überspringt sie. Im Hauptmenü lässt sich das Intro jederzeit über „Intro ansehen“ abspielen.

### Einstieg
Ein neues Spiel beginnt mit fast leerem Bildschirm: Lebenspunkte und ein Ziel-Banner oben. Ein goldener Pfeil zeigt jeweils auf das nächste Ziel, ein Randpfeil hilft, wenn es außerhalb der Sicht liegt. Die Ziele bauen aufeinander auf:
1. Bewegen
2. Holz sammeln
3. Stein brechen
4. An der Flamme abliefern
5. Hütte bauen
6. Überlebende finden
7. Sie zur Siedlung bringen
8. Farm bauen
9. Erste Nacht überstehen (vorher kommen Dash und Kampf)
10. Turm bauen

HUD-Teile, Gebäude und Mechaniken erscheinen erst, wenn sie gebraucht werden, jeweils mit kurzer Einblendung und einem Satz Erklärung („Neu: Mauer“). Bis zum Nacht-Ziel bleibt es heller Tag. Die ersten drei Nächte sind Lernnächte mit wenigen, langsamen Gegnern. Im Hauptmenü startet „Neues Spiel – Tutorial überspringen“ mit allem freigeschaltet.

### Ziel
Überlebe 30 Nächte. Mit dem Morgengrauen nach der 30. Nacht hast du gewonnen. Wird die Ewige Flamme zerstört, ist das Spiel verloren. Fällt deine Spielfigur, ruft die Flamme sie nach 8 Sekunden zurück: Funken sammeln sich, die Figur steht auf und ist 1,5 Sekunden unverwundbar. Die Hälfte der getragenen Rohstoffe bleibt als Beutehaufen an der Todesstelle liegen und kann mit E wieder aufgehoben werden.

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
| 1 | Hütte (2×2) | 20 Holz, 5 Stein | +4 Siedlerplätze, nachts Schutz für 4 Siedler |
| 2 | Farm (2×2) | 14 Holz, 6 Wasser | Ein Siedler baut Nahrung an (4 pro Ernte) |
| 3 | Brunnen | 4 Holz, 12 Stein | +1 Wasser alle 9 s |
| 4 | Mauer | 4 Stein | 320 LP, blockiert alle – Gegner, Siedler und dich |
| 5 | Turm | 20 Holz, 18 Stein | Ballista, 6 Felder Reichweite |
| 6 | Tor | 8 Holz, 6 Stein | 420 LP, nur eigene Leute gehen hindurch; auf eine Mauer gesetzt ersetzt es sie (zahlt nur die Differenz) |

Gebaut werden kann im Umkreis von 12 Feldern um die Flamme und 6 Feldern um jedes andere Gebäude. Tagsüber reparieren die Siedler beschädigte Gebäude automatisch.

**Mauern und Tore:** Mauern lassen sich als Linie ziehen. In der Einstellung „Auto“ folgt die Ausrichtung der Ziehrichtung (waagerecht, senkrecht oder diagonal). Mit R oder dem Mausrad legst du sie fest. Die Vorschau zeigt jede Kachel grün (gültig) oder rot. Mauern verbinden sich mit ihren Nachbarn, diagonale Reihen sind lückenlos dicht. Ein Tor setzt du in eine gerade Mauer, es übernimmt deren Richtung und kostet nur die Differenz. Eigene Leute gehen hindurch (es öffnet sich), Gegner nicht. Du kannst dich und die Flamme vollständig einmauern: Gegner suchen dann den billigsten Weg (Tore sind etwas schwächer als Mauern) und brechen durch. Wer beim Verfolgen an einer Mauer hängen bleibt, reißt sie ein.

**Baustellen:** Gebäude lassen sich immer setzen, auch ohne Material. Es entsteht eine Baustelle mit Gerüst und Fortschrittsbalken. In der Nähe (oder unter dem Mauszeiger) zeigt sie, welches Material noch fehlt. Mit E lieferst du aus deinem Gepäck. Liegt die Baustelle im Kerngebiet der Flamme, holst du das Fehlende so auch direkt aus dem Lager. Siedler tragen Material selbstständig vom Lager zur Baustelle, höchstens die Hälfte von ihnen gleichzeitig; Baumeister tragen mehr. Ist alles da, steht das Gebäude mit einer kleinen Aufbau-Animation. Baustellen blockieren den Weg, haben anfangs nur ein Viertel der Lebenspunkte und können von Gegnern zerstört werden. Ein Abriss gibt 75 % des gelieferten Materials zurück.

### Wildnis und Jagd
Tagsüber leben Hasen, Hirsche, Ziegen und Wildschweine in der Wildnis. Dazu kommen Tauben, Krähen, Möwen, Schmetterlinge, Libellen, Fische und Frösche. Nachts sind Eulen, Fledermäuse und Glühwürmchen unterwegs, und ab der zweiten Nacht streifen Wolfsrudel umher.

| Tier | Verhalten | Beute |
|---|---|---|
| Hase | flieht im Zickzack, auch vor Kampflärm | 2 Nahrung |
| Hirsch | Herde, flieht früh, schnell | 6 Nahrung, 1 Fell |
| Ziege | kleine Herde auf trockenem Boden | 4 Nahrung, 1 Fell |
| Wildschwein | neutral; wer zu nah kommt oder es angreift, wird nach kurzem Scharren angerannt | 5 Nahrung, 2 Fell |
| Wolf (Rudel, nachts) | jagt dich und Siedler außerhalb der Siedlung, meidet das Licht von Flamme, Hütten und Türmen, gibt nach einer Weile auf und flieht bei schweren Verlusten | 2 Fell |

Erlegte Tiere geben ihre Beute direkt in dein Inventar. Jagbare Tiere in Reichweite leuchten golden, ein Druck auf E greift sie an. Tiere greifen nie die Flamme oder Gebäude an.

### Energie und Dash
Die Energieleiste steht unter deinen Lebenspunkten. Ein Dash kostet 30 Energie, ein Sprint verbraucht Energie, solange du ihn hältst. Nach einer kurzen Pause lädt sich die Leiste wieder auf. Reicht die Energie nicht, blinkt die Leiste und der Dash bleibt aus. Auch beim Dash blockieren Mauern, Tore dagegen nicht.

### Orte in der Wildnis
Die Welt um die Flamme ist in drei Ringe geteilt: Je weiter draußen, desto gefährlicher und lohnender. Entdeckte Orte erscheinen auf der Minikarte (Unerkundetes liegt im Nebel). Liegen sie in der Nähe, aber außerhalb der Sicht, zeigt ein Pfeil am Bildschirmrand dorthin.

| Ort | Was dich erwartet |
|---|---|
| Lager von Überlebenden ⌂ | 1–2 wartende Siedler mit Namen und Gabe. Manche Lager sind nachts bedroht. |
| Aschgänger-Lager ☠ | 3–8 Wächter, die patrouillieren und angreifen, wer zu nah kommt; außen mit Elite-Anführer. Besiegt: Truhe mit Beute und einem **Bauplan**. Das Lager wird sicher, und nach einem Tag wartet dort ein Überlebender. |
| Verlies ◆ | Ruinenmauern, 2–3 Kisten, 1–3 Wächter |
| Schrein ✚ | Einmal pro Tag: volle Heilung und 90 s Segen (schneller laufen oder schnellere Energie) |
| Signalfeuer ▲ | Für 5 Holz entzündet: deckt die Karte im weiten Umkreis auf und leuchtet nachts |
| Umgestürzter Wagen ✦ | Beutekiste, aber Vorsicht: Hinterhalt |

Dazu kommen Wanderer auf den Straßen (manche wollen sich anschließen), Rauchsäulen über Lagern, Krähenschwärme über Gefahrenzonen, Lagerfeuer als Lichtpunkte in der Nacht und Meilensteine an den Straßen. Jeden zweiten Morgen schlagen neue Überlebende irgendwo ein Lager auf, jeden dritten entsteht ein neues, stärkeres Aschgänger-Lager.

### Siedler
- Du beginnst **allein**. Siedler findest du in Lagern in der Wildnis. Sprich sie mit E an, dann folgen sie dir. In der Siedlung angekommen, gehören sie dazu.
- Mitnehmen geht nur mit freiem Wohnplatz: Jede Hütte bietet 4 Plätze. Fehlt einer, heißt es „Du brauchst eine weitere Hütte“.
- Jeder Siedler hat eine Gabe: Bauer (Farmen +35 %), Holzfäller, Steinmetz, Jäger (Nahrung sammeln +35 %), Baumeister, Läufer (+20 % Tempo), Zäh (+50 % LP) oder Arbeiter (ohne Bonus).
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
- **Einstieg statt Textwand:** Das frühere Tutorial mit mehreren Textseiten ist durch den Questpfad ersetzt. H zeigt nur noch die Tastenübersicht. Der Spielstand speichert den Questschritt und alle Freischaltungen (Format v2). Spielstände der Vorversion sind nicht kompatibel und werden mit einem Hinweis verworfen.
- **Wildlife:** Tiere entstehen in einem Ring um die Kamera, passend zum Boden und zur Tageszeit, und verschwinden weit außerhalb der Sicht wieder. Es sind höchstens 60 gleichzeitig, davon höchstens 30 dekorative. Deko-Tiere und Tiere außerhalb der Sicht werden vereinfacht aktualisiert. Tiere werden nicht gespeichert. Fell ist eine neue Ressource, für Rezepte ab Phase 7.
- **Kampfgefühl:** Ein Schwerthieb holt aus, zieht mit Bogenspur durch und lässt die Figur nach vorn ausfallen. Bei Treffern hält das Bild für drei Frames an (Trefferpause), dazu ein leichtes Wackeln, Rückstoß und weißes Aufblitzen. Sammeln braucht gehaltene Taste und zeigt einen Fortschrittsbalken. Das Werkzeug passt zum Ziel (Axt, Spitzhacke, Eimer).
- **Lesbarkeit:** Der Boden ist bewusst entsättigt und etwas dunkler. Gebäude, Bäume, Felsen und Sträucher haben kräftigere Farben und eine dunkle Kontur. Der Spieler trägt einen hellen Umriss, Siedler einen dunklen, Gegner einen dunkelroten, alle mit Bodenschatten. Das Ziel in Reichweite leuchtet golden und zeigt ein „E“. Liegt die Flamme außerhalb der Sicht, zeigt ein goldener Pfeil am Bildschirmrand dorthin.
- **Kollision:** Alle Figuren haben kreisförmige Hitboxen und gleiten an Hindernissen entlang. Gebäude, Mauern, Baumstämme und Felsen blockieren jeden – auch den Spieler und die Siedler. Nur **Tore** lassen eigene Leute durch, Gegner nicht. Siedler arbeiten, liefern und schlafen an einem Zugangspunkt am Gebäuderand und betreten Gebäude nie. Wer hinter einem Gebäude oder Baum steht, scheint als Silhouette durch.
- **Baustellen statt Sofortbau:** Die Bauzeit ergibt sich allein aus der Materiallieferung. Der Spieler darf im Kerngebiet der Flamme direkt aus dem Lager liefern, damit der Start ohne Siedler nicht stockt. Reparatur ist weiterhin als tägliche Regeneration abstrahiert (1 % LP/s, Flamme 0,5 % LP/s).
- **Nur Siedler essen und trinken.** Die Spielfigur hat keine Bedürfnisse, regeneriert aber Leben, wenn sie eine Weile nicht getroffen wurde.
- **Siedler-Zuzug:** Neue Siedler kommen nur durch Rettung aus Lagern und von Wanderern. Ohne Retten wächst die Siedlung nicht. Die Lager entstehen aus dem Seed, neue kommen im Lauf der Zeit hinzu.
- **Feindlager-Wächter** stehen im Rauch ihrer Feuer und verbrennen nicht im Sonnenlicht. Wer bedrohte Lager nachts überfällt, verbrennt dagegen wie alle Aschgänger.
- **Baupläne** aus Feindlagern (Fallen, Feuerschale, Eisenschmiede) werden gespeichert und schalten die Gebäude frei, sobald die passende Flammenstufe erreicht ist.
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
