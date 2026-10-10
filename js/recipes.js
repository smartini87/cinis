// recipes.js – Herstellung an der Flamme (Grundlegendes), an der Werkbank und (ab Phase 8) in der Schmiede.
// Bezahlt wird aus Lager und Gepäck; Gegenstände landen im Gepäck, Bolzen und Öl im Lager.

import { RES } from './config.js';
import { ITEMS, itemInfo } from './items.js';

/**
 * station: flame | workbench | forge. unlock: { level?, blueprint? } (Flammenstufe/Bauplan, ab Phase 8).
 * out: { item, n } → Gepäck, { res, n } → Lager. unique: nur einmal nötig (Werkzeug/Ausrüstung).
 */
export const RECIPES = [
  { id: 'bolts', station: 'flame', cost: { wood: 3, stone: 1 }, out: { res: 'bolts', n: 10 }, desc: 'Munition für die Türme (ins Lager).' },
  { id: 'bandage', station: 'flame', cost: { cloth: 1, herbs: 1 }, out: { item: 'bandage', n: 2 }, desc: 'Q: heilt 40 Lebenspunkte.' },
  { id: 'torch', station: 'workbench', cost: { wood: 2, cloth: 1, resin: 1 }, out: { item: 'torch', n: 2 }, desc: 'Licht in der Nacht, hält Wölfe fern.' },
  { id: 'axe', station: 'workbench', cost: { wood: 4, stone: 2, iron: 1 }, out: { item: 'axe', n: 1 }, unique: true },
  { id: 'pick', station: 'workbench', cost: { wood: 4, stone: 3, iron: 1 }, out: { item: 'pick', n: 1 }, unique: true },
  { id: 'boots', station: 'workbench', cost: { hide: 3, cloth: 2 }, out: { item: 'boots', n: 1 }, unique: true },
  { id: 'oil', station: 'workbench', cost: { herbs: 3, resin: 1 }, out: { res: 'oil', n: 1 }, desc: 'Brennstoff der höchsten Flammenstufen (ins Lager).' },
  { id: 'ironSword', station: 'workbench', cost: { iron: 6, wood: 2, coal: 2 }, out: { item: 'ironSword', n: 1 }, unique: true },
  { id: 'armor', station: 'workbench', cost: { iron: 5, hide: 3, cloth: 2 }, out: { item: 'armor', n: 1 }, unique: true },
];

export const STATION_NAMES = { flame: 'Ewige Flamme', workbench: 'Werkbank', forge: 'Schmiede' };

export function recipeName(r) {
  const o = r.out;
  const base = o.item ? ITEMS[o.item].name : RES[o.res].name;
  return o.n > 1 ? `${base} ×${o.n}` : base;
}

export function recipeDesc(r) {
  return r.desc || (r.out.item ? itemInfo(r.out.item).desc : '');
}

/** Ist das Rezept freigeschaltet? (Flammenstufe/Bauplan, sofern vorhanden) */
export function recipeUnlocked(game, r) {
  const u = r.unlock;
  if (!u) return true;
  if (u.level && (game.flame ? game.flame.level : 1) < u.level) return false;
  if (u.blueprint && !game.progress.blueprints.has(u.blueprint)) return false;
  return true;
}

/** Herstellen; liefert eine Fehlermeldung oder null. */
export function craft(game, r) {
  const p = game.player, B = game.buildings;
  if (!recipeUnlocked(game, r)) return 'Noch nicht freigeschaltet.';
  if (r.unique && p.inv.has(r.out.item)) return 'Hast du schon.';
  if (!B.canAfford(game, r.cost)) return 'Es fehlt Material.';
  if (r.out.item && p.inv.room(r.out.item) < r.out.n) return 'Kein Platz im Gepäck.';
  B.pay(game, r.cost);
  if (r.out.item) p.inv.add(r.out.item, r.out.n);
  else game.stock[r.out.res] += r.out.n;
  game.stats.crafted = (game.stats.crafted || 0) + 1;
  game.audio.play('craft');
  return null;
}
