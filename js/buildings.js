// buildings.js – Gebäudedefinitionen, Belegungsraster und Zeichnen. Das Zentrum (Ewige Flamme)
// ist das Lager der Siedlung: Ressourcen werden hier abgeliefert.

import { TILE } from './config.js';
import { Sprites, drawFlame } from './sprites.js';

export const BUILDING_DEFS = {
  center: { name: 'Ewige Flamme', size: 3, hp: 1200, desc: 'Herz der Siedlung und Lager. Fällt sie, ist das Spiel verloren.' },
};

let nextId = 1;

export class Buildings {
  constructor(world) {
    this.world = world;
    this.list = [];
    this.center = null;
  }

  /** Gebäude anlegen und Kacheln belegen (ohne Kostenprüfung). */
  add(type, tx, ty) {
    const def = BUILDING_DEFS[type];
    const b = {
      id: nextId++, type, tx, ty, size: def.size,
      hp: def.hp, maxHp: def.hp,
      x: (tx + def.size / 2) * TILE, y: (ty + def.size / 2) * TILE,
      flash: 0,
    };
    for (let y = ty; y < ty + def.size; y++) {
      for (let x = tx; x < tx + def.size; x++) this.world.buildingAt[this.world.idx(x, y)] = b;
    }
    this.list.push(b);
    if (type === 'center') this.center = b;
    return b;
  }

  /** Abstand eines Punkts zum Rand des Gebäuderechtecks (0 = innerhalb). */
  distTo(b, x, y) {
    const x0 = b.tx * TILE, y0 = b.ty * TILE, x1 = x0 + b.size * TILE, y1 = y0 + b.size * TILE;
    const dx = Math.max(x0 - x, 0, x - x1), dy = Math.max(y0 - y, 0, y - y1);
    return Math.hypot(dx, dy);
  }

  update(dt) {
    for (const b of this.list) if (b.flash > 0) b.flash -= dt;
  }

  /** Zeichenaufträge (nach y sortierbar) für sichtbare Gebäude sammeln. */
  collectDrawables(out, ctx, cam, time) {
    for (const b of this.list) {
      const x = b.tx * TILE, y = b.ty * TILE, s = b.size * TILE;
      if (!cam.visible(x, y - 40, s, s + 40)) continue;
      out.push({ y: y + s - 2, draw: () => this.drawBuilding(ctx, b, time) });
    }
  }

  drawBuilding(ctx, b, time) {
    const x = b.tx * TILE, y = b.ty * TILE, s = b.size * TILE;
    if (b.type === 'center') {
      const spr = Sprites.center;
      ctx.drawImage(spr, Math.round(x + s / 2 - spr.width / 2), y + s - spr.height + 6);
      drawFlame(ctx, x + s / 2, y + s - 32, 7, time);
    }
  }
}
