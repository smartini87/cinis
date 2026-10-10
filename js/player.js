// player.js – der Spieler: Bewegung, Zielwahl, Sammeln, Inventar und Abliefern an der Flamme.

import { TILE, RES, RES_KEYS, PLAYER_CAPACITY, PLAYER_REACH, DEPOSIT_RANGE, GATHER_TIME } from './config.js';
import { NODE_DEFS } from './world.js';
import { drawHumanoid } from './sprites.js';
import { dist } from './util.js';

/** Partikelfarben beim Abbauen */
const CHIP_COLORS = {
  tree: ['#8d6240', '#c49a6a', '#3d6e33'],
  rock: ['#d8d4ca', '#8e8a80', '#b9b4a8'],
  bush: ['#7a3266', '#3f7234', '#a8579a'],
  water: ['#7fc0ea', '#cfeaf8', '#3f86c0'],
};

export class Player {
  constructor(x, y) {
    this.x = x;
    this.y = y;
    this.r = 4;           // Kollisionsradius
    this.speed = 72;      // Welteinheiten pro Sekunde
    this.flip = false;
    this.walk = 0;        // Laufanimationsphase
    this.moving = false;
    this.aimX = 1;        // Blickrichtung (normiert)
    this.aimY = 0;
    this.inv = { wood: 0, stone: 0, food: 0, water: 0 };
    this.capacity = PLAYER_CAPACITY;
    this.actionT = 0;     // Abklingzeit bis zur nächsten Aktion
    this.swing = 0;       // Restdauer der Schwunganimation
    this.target = null;   // aktuelles Sammelziel
  }

  get tx() {
    return Math.floor(this.x / TILE);
  }
  get ty() {
    return Math.floor(this.y / TILE);
  }
  get carried() {
    return RES_KEYS.reduce((s, k) => s + this.inv[k], 0);
  }

  update(dt, game) {
    const { input, world } = game;
    const ax = input.axis();
    this.moving = ax.x !== 0 || ax.y !== 0;
    if (this.moving) {
      world.moveEntity(this, ax.x * this.speed * dt, ax.y * this.speed * dt, this.r, world.solidFriendly);
      this.walk += dt * 12;
      const l = Math.hypot(ax.x, ax.y);
      this.aimX = ax.x / l;
      this.aimY = ax.y / l;
      if (ax.x !== 0) this.flip = ax.x < 0;
    } else {
      this.walk = 0;
    }

    this.target = this.findTarget(game);
    this.actionT -= dt;
    this.swing = Math.max(0, this.swing - dt);
    const mouseAct = input.mouse.down && game.mouseActionAllowed();
    if ((input.isDown('Space', 'KeyE') || mouseAct) && this.actionT <= 0) this.act(game, mouseAct);

    // Automatisch an der Ewigen Flamme abliefern
    const center = game.buildings.center;
    if (center && this.carried > 0 && game.buildings.distTo(center, this.x, this.y) < DEPOSIT_RANGE) this.deposit(game);
  }

  /** Bestes Sammelziel bestimmen: Mauszeiger > Blickrichtung > nächstes Wasser. */
  findTarget(game) {
    const { world, camera, input } = game;
    const reach = PLAYER_REACH;
    const valid = (n) => n && !n.removed && n.amount > 0;
    if (input.mouse.inside) {
      const w = camera.screenToWorld(input.mouse.x, input.mouse.y);
      const tx = Math.floor(w.x / TILE), ty = Math.floor(w.y / TILE);
      const n = world.nodeAtTile(tx, ty);
      if (valid(n) && dist(this.x, this.y, n.x, n.y) <= reach + 6) return { kind: 'node', node: n, x: n.x, y: n.y };
      if (world.isWaterTile(tx, ty) && this.distToTile(tx, ty) <= 10) return { kind: 'water', x: (tx + 0.5) * TILE, y: (ty + 0.5) * TILE, tx, ty };
    }
    let best = null, bestScore = Infinity;
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const n = world.nodeAtTile(this.tx + dx, this.ty + dy);
        if (!valid(n)) continue;
        const d = dist(this.x, this.y, n.x, n.y);
        if (d > reach) continue;
        const dot = ((n.x - this.x) * this.aimX + (n.y - this.y) * this.aimY) / Math.max(d, 1);
        const score = d - dot * 10;
        if (score < bestScore) {
          bestScore = score;
          best = n;
        }
      }
    }
    if (best) return { kind: 'node', node: best, x: best.x, y: best.y };
    let bestW = null, bestD = 10;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const tx = this.tx + dx, ty = this.ty + dy;
        if (!world.isWaterTile(tx, ty)) continue;
        const d = this.distToTile(tx, ty);
        if (d <= bestD) {
          bestD = d;
          bestW = { kind: 'water', x: (tx + 0.5) * TILE, y: (ty + 0.5) * TILE, tx, ty };
        }
      }
    }
    return bestW;
  }

  distToTile(tx, ty) {
    const x0 = tx * TILE, y0 = ty * TILE;
    const dx = Math.max(x0 - this.x, 0, this.x - (x0 + TILE)), dy = Math.max(y0 - this.y, 0, this.y - (y0 + TILE));
    return Math.hypot(dx, dy);
  }

  /** Eine Aktion ausführen (Sammeln). */
  act(game, viaMouse) {
    const { world, effects, ui, input, camera } = game;
    this.swing = 0.22;
    this.actionT = 0.45;
    if (viaMouse && input.mouse.inside) {
      const w = camera.screenToWorld(input.mouse.x, input.mouse.y);
      this.faceTowards(w.x, w.y);
    }
    const t = this.target;
    if (!t) return;
    this.faceTowards(t.x, t.y);
    if (this.carried >= this.capacity) {
      ui.toast('Voll beladen! Bring die Ressourcen zur Ewigen Flamme.', 'warn', 'full');
      return;
    }
    let res, kind;
    if (t.kind === 'node') {
      kind = t.node.type;
      res = NODE_DEFS[kind].res;
      if (world.harvest(t.node, 1) <= 0) return;
    } else {
      kind = 'water';
      res = 'water';
    }
    this.inv[res] += 1;
    this.actionT = GATHER_TIME[kind];
    effects.burst(t.x, t.y - (kind === 'tree' ? 6 : 2), { n: 5, color: CHIP_COLORS[kind], speed: 45, life: 0.5, up: 35 });
    effects.text(t.x, t.y - 14, `+1 ${RES[res].name}`, RES[res].color);
  }

  faceTowards(x, y) {
    const dx = x - this.x, dy = y - this.y;
    const l = Math.hypot(dx, dy);
    if (l < 1) return;
    this.aimX = dx / l;
    this.aimY = dy / l;
    if (Math.abs(dx) > 1) this.flip = dx < 0;
  }

  /** Gesamtes Inventar ins Lager der Siedlung legen. */
  deposit(game) {
    let off = 0;
    for (const k of RES_KEYS) {
      if (this.inv[k] <= 0) continue;
      game.stock[k] += this.inv[k];
      game.effects.text(this.x, this.y - 22 - off, `+${this.inv[k]} ${RES[k].name}`, RES[k].color);
      off += 7;
      this.inv[k] = 0;
    }
  }

  draw(ctx) {
    drawHumanoid(ctx, this.x, this.y, {
      flip: this.flip, walk: this.moving ? this.walk : 0,
      tunic: '#a8322c', skin: '#c99a6e', helmet: '#b8a04a', plume: '#c0392b', belt: '#6b4a2a',
    });
    if (this.swing > 0) {
      // Werkzeug-/Waffenschwung in Blickrichtung
      const base = Math.atan2(this.aimY, this.aimX);
      const a = base + (this.swing / 0.22 - 0.5) * 2.2 * (this.flip ? -1 : 1);
      ctx.save();
      ctx.translate(Math.round(this.x), Math.round(this.y - 8));
      ctx.rotate(a);
      ctx.fillStyle = '#6b4a2a';
      ctx.fillRect(2, -1, 7, 2);
      ctx.fillStyle = '#c8ccd0';
      ctx.fillRect(8, -2, 4, 4);
      ctx.restore();
    }
  }
}
