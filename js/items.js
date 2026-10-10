// items.js – Gegenstände (Werkzeuge, Waffen, Ausrüstung, Verbrauchsgüter) und ihre Eigenschaften.
// Rohstoffe stehen in config.js (RES); beides kann im Inventar liegen. Ausrüstung wirkt, solange sie im
// Inventar liegt (das jeweils beste Stück zählt).

import { RES, RES_STACK } from './config.js';

export const ITEMS = {
  axe: { name: 'Axt', stack: 1, color: '#a8b0b8', desc: 'Bäume fällen geht 80 % schneller.', kind: 'tool' },
  pick: { name: 'Spitzhacke', stack: 1, color: '#a8b0b8', desc: 'Stein brechen geht 80 % schneller.', kind: 'tool' },
  ironSword: { name: 'Eisenschwert', stack: 1, color: '#d8dce0', desc: 'Schaden 32 statt 20.', kind: 'weapon' },
  armor: { name: 'Rüstung', stack: 1, color: '#8a7a4a', desc: '30 % weniger Schaden.', kind: 'armor' },
  boots: { name: 'Stiefel', stack: 1, color: '#7a5233', desc: '+40 Energie, +30 % Erholung.', kind: 'boots' },
  torch: { name: 'Fackel', stack: 5, color: '#ffb040', desc: 'T: anzünden/löschen. Leuchtet, hält Wölfe fern; brennt 3 Minuten.', kind: 'use' },
  bandage: { name: 'Verband', stack: 10, color: '#e8e2d4', desc: 'Q: heilt 40 Lebenspunkte.', kind: 'use' },
};

/** Name, Farbe, Stapelgröße, Beschreibung – für Rohstoffe und Gegenstände. */
export function itemInfo(id) {
  if (ITEMS[id]) return ITEMS[id];
  const r = RES[id];
  return r ? { name: r.name, color: r.color, stack: RES_STACK, desc: 'Rohstoff – an der Flamme abliefern.', kind: 'res' } : { name: id, color: '#fff', stack: 1, desc: '', kind: 'misc' };
}
