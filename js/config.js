// config.js – zentrale Konstanten und Balancing-Werte.
// Alle Zeiten in Spielsekunden, Distanzen in Welteinheiten (1 Kachel = TILE Einheiten).

export const TILE = 16;            // Kachelgröße in Weltpixeln
export const MAP_W = 96;           // Kartenbreite in Kacheln
export const MAP_H = 96;           // Kartenhöhe in Kacheln
export const STEP = 1 / 60;        // fester Simulationsschritt (60 Hz)

export const GAME_TITLE = 'CINIS';
export const GAME_SUBTITLE = 'Die letzte Flamme';

/** Die vier Ressourcen der Siedlung */
export const RES = {
  wood: { name: 'Holz', color: '#c49a6a' },
  stone: { name: 'Stein', color: '#d8d4ca' },
  food: { name: 'Nahrung', color: '#c27ab3' },
  water: { name: 'Wasser', color: '#7fc0ea' },
};
export const RES_KEYS = ['wood', 'stone', 'food', 'water'];

export const START_STOCK = { wood: 15, stone: 10, food: 20, water: 20 };

// Spieler
export const PLAYER_CAPACITY = 30;   // maximale Traglast
export const PLAYER_REACH = 22;      // Reichweite für Sammeln (Welteinheiten)
export const DEPOSIT_RANGE = 20;     // Abstand zur Flamme, ab dem automatisch abgeliefert wird
/** Sammelintervall pro Zieltyp in Sekunden */
export const GATHER_TIME = { tree: 0.55, rock: 0.7, bush: 0.4, water: 0.45 };

// Siedler
export const SETTLER = {
  hp: 40,
  speed: 40,
  hungerRate: 100 / 360,   // Sättigung pro Sekunde weniger
  thirstRate: 100 / 240,
  needAt: 45,              // ab hier gehen Siedler essen/trinken
  gain: 35,                // Sättigung pro Einheit Nahrung/Wasser
  carry: 5,                // Traglast
  workTime: 1.1,           // Sekunden pro gesammelter Einheit
  starveDamage: 1,         // LP pro Sekunde bei leerem Magen/Durst
};
export const START_SETTLERS = 3;
export const SETTLER_ARRIVAL_COST = 8;   // Nahrung pro neuem Siedler
export const FARM_GROW_TIME = 36;        // Sekunden Arbeit bis zur Ernte
export const FARM_YIELD = 5;             // Nahrung pro Ernte
