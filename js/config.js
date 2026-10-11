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
  hide: { name: 'Fell', color: '#c9a87a' },
  iron: { name: 'Eisenschrott', color: '#a8b0b8' },
  cloth: { name: 'Stoff', color: '#d8c8a8' },
  coal: { name: 'Kohle', color: '#8a8580' },
  herbs: { name: 'Kräuter', color: '#8ac070' },
  resin: { name: 'Harz', color: '#e0a040' },
  bolts: { name: 'Bolzen', color: '#c9a87a' },
  oil: { name: 'Kräuteröl', color: '#c8d060' },
};
/** Alles, was im Lager an der Flamme liegen kann */
export const RES_KEYS = ['wood', 'stone', 'food', 'water', 'hide', 'iron', 'cloth', 'coal', 'herbs', 'resin', 'bolts', 'oil'];
/** Was Siedler selbst sammeln */
export const GATHER_KEYS = ['wood', 'stone', 'food', 'water', 'coal', 'herbs'];

export const START_STOCK = { wood: 15, stone: 10, food: 20, water: 20, hide: 0, iron: 0, cloth: 0, coal: 0, herbs: 0, resin: 0, bolts: 30, oil: 0 };
/** Größe des Spieler-Inventars (Slots) und Stapelgröße für Rohstoffe */
export const INV_SLOTS = 16;
export const RES_STACK = 20;

// Spieler
export const PLAYER_CAPACITY = 30;   // (veraltet) früher: maximale Traglast – heute begrenzen Inventar-Slots
export const PLAYER_ACCEL = 700;     // Beschleunigung (Welteinheiten/s²)
export const PLAYER_DECEL = 1000;    // Abbremsen ohne Eingabe
export const PLAYER_REACH = 24;      // Sammelreichweite (auch von einer diagonalen Nachbarkachel aus)
/** Dash (Shift): kurzer Schub, kostet Energie, kurze Unverwundbarkeit */
export const DASH = { cost: 30, time: 0.2, speed: 270, cooldown: 0.35, iframes: 0.15 };
/** Energie: Maximum, Regeneration pro Sekunde nach kurzer Pause; Sprint (Shift halten) */
export const ENERGY = { max: 100, regen: 30, delay: 0.8, sprintCost: 18, sprintMul: 1.5, sprintAfter: 0.25 };      // Reichweite für Sammeln (Welteinheiten)
export const DEPOSIT_RANGE = 20;     // Abstand zur Flamme, ab dem automatisch abgeliefert wird
/** Sammelintervall pro Zieltyp in Sekunden */
export const GATHER_TIME = { tree: 0.55, rock: 0.7, bush: 0.4, water: 0.45, herb: 0.5, ashpile: 0.65 };

// Siedler
export const SETTLER = {
  hp: 40,
  speed: 40,
  hungerRate: 100 / 360,   // Sättigung pro Sekunde weniger
  thirstRate: 100 / 240,
  needAt: 45,              // ab hier gehen Siedler essen/trinken
  gain: 35,                // Sättigung pro Einheit Nahrung/Wasser
  carry: 6,                // Traglast
  workTime: 1.5,           // Sekunden pro gesammelter Einheit
  starveDamage: 1,         // LP pro Sekunde bei leerem Magen/Durst
};
export const START_SETTLERS = 0;      // man beginnt allein; Siedler warten in Lagern in der Wildnis
export const FARM_GROW_TIME = 42;        // Sekunden Arbeit bis zur Ernte
export const FARM_YIELD = 4;             // Nahrung pro Ernte

// Kampf
export const PLAYER_HP = 100;
export const PLAYER_DAMAGE = 20;
export const PLAYER_ATTACK_RANGE = 22;
export const PLAYER_ATTACK_TIME = 0.42;
export const PLAYER_RESPAWN = 8;
export const TOWER = { range: 6 * TILE, damage: 11, cooldown: 1.0, boltSpeed: 300 };
export const REPAIR_RATE = 0.01;          // Anteil max. LP pro Sekunde (tagsüber)
export const TOWER_COST_FREE = 4;        // so viele Türme zum Grundpreis
export const TOWER_COST_STEP = 0.6;      // jeder weitere: +60 % der Grundkosten
export const TRAP = { damage: 100, uses: 5, slow: 3 };
export const FIREBOWL_DPS = 24;
export const FIREBOWL_RADIUS = 3.5 * 16;
export const REPAIR_COST = 0.35;          // Anteil der Baukosten je vollständig reparierter LP
export const SUN_BURN = 30;               // Schaden pro Sekunde an Gegnern im Tageslicht
export const RUBBLE_PER_DAY = 7;          // neue Säulentrümmer pro Morgen (Ruinen zerfallen)
export const RUBBLE_IRON = 0.08;          // Chance auf Eisenschrott beim Steinbrechen
