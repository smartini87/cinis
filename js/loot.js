// loot.js – Beutehaufen am Boden (z. B. Rohstoffe, die der Spieler beim Tod verliert). Mit „E“ aufheben.

import { RES, RES_KEYS } from './config.js';
import { drawOutlinedImage, Sprites } from './sprites.js';

export class Loot {
  constructor() {
    this.piles = [];   // { x, y, items: { res: n } }
  }

  clear() {
    this.piles.length = 0;
  }

  drop(x, y, items) {
    this.piles.push({ x, y, items: { ...items } });
  }

  /** Interaktions-Provider: Haufen in Reichweite. */
  provider = (game, out) => {
    const p = game.player;
    for (const pile of this.piles) {
      if (Math.abs(pile.x - p.x) > 40 || Math.abs(pile.y - p.y) > 40) continue;
      out.push({
        kind: 'loot', obj: pile, x: pile.x, y: pile.y, label: 'Beute aufheben', promptH: 12, prio: -4,
        hit: (mx, my) => Math.abs(mx - pile.x) < 8 && Math.abs(my - pile.y + 3) < 7,
        act: (g) => this.pickUp(g, pile),
      });
    }
  };

  /** So viel aufheben, wie in die Traglast passt. */
  pickUp(game, pile) {
    const p = game.player;
    let got = 0, off = 0;
    for (const k of RES_KEYS) {
      const n = Math.min(pile.items[k] || 0, p.capacity - p.carried);
      if (n <= 0) continue;
      p.inv[k] += n;
      pile.items[k] -= n;
      got += n;
      game.effects.text(pile.x, pile.y - 12 - off, `+${n} ${RES[k].name}`, RES[k].color);
      off += 7;
    }
    if (RES_KEYS.every((k) => !(pile.items[k] > 0))) this.piles.splice(this.piles.indexOf(pile), 1);
    else if (!got) game.ui.toast('Voll beladen! Erst an der Flamme abliefern.', 'warn', 'full');
    if (got) game.audio.play('pick');
  }

  collectDrawables(out, ctx, cam, time, glowFor) {
    for (const pile of this.piles) {
      if (!cam.visible(pile.x - 8, pile.y - 12, 16, 14)) continue;
      out.push({ y: pile.y, draw: () => drawOutlinedImage(ctx, Sprites.sack, Math.round(pile.x - 6), Math.round(pile.y - 10), '#ffd36a', glowFor(pile, time) || 0.25) });
    }
  }

  serialize() {
    return this.piles.map((p) => ({ x: Math.round(p.x), y: Math.round(p.y), items: p.items }));
  }

  restore(list) {
    this.piles = (list || []).map((p) => ({ x: p.x, y: p.y, items: { ...p.items } }));
  }
}

