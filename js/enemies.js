// enemies.js – Gegnertypen, Wellenplanung pro Nacht (steigende Schwierigkeit), Gegner-KI
// (Flussfeld zur Flamme, Angriff auf Gebäude/Einheiten), Sonnenbrand am Morgen, Zeichnen.

import { TILE, SUN_BURN } from './config.js';
import { NIGHT_LEN } from './time.js';
import { drawEnemy, OUTLINE } from './sprites.js';
import { drawEdgeArrow } from './ui.js';
import { damageBuilding, damageUnit } from './combat.js';
import { dist } from './util.js';

export const ENEMY_DEFS = {
  walker: { name: 'Aschgänger', hp: 40, speed: 26, dmg: 8, cd: 1.0, r: 4, bld: 1, aggro: 4 * TILE },
  dog: { name: 'Ruinenhund', hp: 24, speed: 52, dmg: 5, cd: 0.6, r: 3, bld: 0.5, aggro: 6 * TILE },
  brute: { name: 'Aschkoloss', hp: 170, speed: 17, dmg: 22, cd: 1.6, r: 6, bld: 2, aggro: 3 * TILE },
  boss: { name: 'Prätor der Asche', hp: 700, speed: 19, dmg: 32, cd: 1.5, r: 8, bld: 1.5, aggro: 5 * TILE },
};

const EDGE_NAMES = { n: 'Norden', s: 'Süden', w: 'Westen', e: 'Osten' };

/** Zusammensetzung der Welle in Nacht n. */
export function waveFor(n) {
  return {
    walker: 3 + Math.floor(n * 1.6),
    dog: n >= 3 ? Math.floor((n - 1) * 0.9) : 0,
    brute: n >= 5 ? Math.floor((n - 2) / 1.8) : 0,
    boss: n % 10 === 0 ? n / 10 : n === 25 ? 1 : 0,
    hpMul: 1 + (n - 1) * 0.09,
    dmgMul: 1 + (n - 1) * 0.05,
    edges: n >= 18 ? 3 : n >= 8 ? 2 : 1,
  };
}

let nextId = 1;

export class Enemies {
  constructor() {
    this.list = [];
    this.queue = [];        // geplante Spawns { type, at (s nach Nachteinbruch), edge }
    this.plan = null;       // aktuelle Nacht { n, edges, total }
    this.nightT = 0;
  }

  clear() {
    this.list.length = 0;
    this.queue.length = 0;
    this.plan = null;
  }

  /** Welle für Nacht n planen (bei Abenddämmerung) und ankündigen. */
  planNight(n, game) {
    const w = waveFor(n);
    const all = ['n', 's', 'w', 'e'];
    const edges = [];
    while (edges.length < w.edges) {
      const e = all[Math.floor(Math.random() * all.length)];
      if (!edges.includes(e)) edges.push(e);
    }
    this.queue.length = 0;
    const types = [];
    for (const t of ['walker', 'dog', 'brute', 'boss']) for (let i = 0; i < w[t]; i++) types.push(t);
    // Spawns über die ersten 60 % der Nacht verteilen, Bosse in der Mitte
    types.forEach((type, i) => {
      const at = type === 'boss' ? NIGHT_LEN * 0.3 : (i / Math.max(1, types.length)) * NIGHT_LEN * 0.6 + Math.random() * 3;
      this.queue.push({ type, at, edge: edges[i % edges.length] });
    });
    this.queue.sort((a, b) => a.at - b.at);
    this.plan = { n, edges, total: types.length, hpMul: w.hpMul, dmgMul: w.dmgMul, boss: w.boss };
    return this.plan;
  }

  /** Text für die Ankündigung. */
  describePlan() {
    const p = this.plan;
    if (!p) return '';
    const dirs = p.edges.map((e) => EDGE_NAMES[e]).join(' und ');
    return `${p.total} Feinde aus dem ${dirs}${p.boss ? ' – ein Prätor der Asche führt sie an!' : ''}`;
  }

  startNight() {
    this.nightT = 0;
  }

  /** Spawnpunkt am Kartenrand suchen, der das Zentrum erreichen kann. */
  findSpawn(edge, world) {
    for (let tries = 0; tries < 60; tries++) {
      const r = 2 + Math.floor(Math.random() * (world.w - 4));
      const d = Math.floor(Math.random() * 3);
      const [tx, ty] = edge === 'n' ? [r, d] : edge === 's' ? [r, world.h - 1 - d] : edge === 'w' ? [d, r] : [world.w - 1 - d, r];
      if (world.passable(tx, ty, 'enemy') && Number.isFinite(world.flowAt(tx, ty))) {
        return { x: (tx + 0.5) * TILE, y: (ty + 0.5) * TILE };
      }
    }
    return null;
  }

  spawn(type, x, y, hpMul = 1, dmgMul = 1) {
    const def = ENEMY_DEFS[type];
    const e = {
      id: nextId++, type, x, y, r: def.r,
      hp: def.hp * hpMul, maxHp: def.hp * hpMul, dmg: def.dmg * dmgMul,
      speed: def.speed * (0.9 + Math.random() * 0.2),
      cd: Math.random() * def.cd, flip: false, walk: Math.random() * 6, hurt: 0, attack: 0,
      target: null, retarget: 0, dead: false, burn: false, blockedT: 0,
    };
    this.list.push(e);
    return e;
  }

  update(dt, game) {
    const { cycle, world } = game;
    // Geplante Spawns während der Nacht
    if (cycle.isNight) {
      this.nightT += dt;
      while (this.queue.length && this.queue[0].at <= this.nightT) {
        const q = this.queue.shift();
        const pos = this.findSpawn(q.edge, world);
        if (pos) this.spawn(q.type, pos.x, pos.y, this.plan.hpMul, this.plan.dmgMul);
      }
    }
    const sunny = cycle.isSunny;
    for (const e of this.list) {
      if (e.hurt > 0) e.hurt -= dt;
      if (e.attack > 0) e.attack = Math.max(0, e.attack - dt * 3);
      e.burn = sunny;
      if (sunny) {
        // Im Sonnenlicht zerfallen sie zu Asche
        e.hp -= SUN_BURN * dt;
        if (Math.random() < dt * 10) game.effects.burst(e.x, e.y - 8, { n: 1, color: ['#e8742a', '#5a5450'], speed: 10, life: 0.6, up: 30, gravity: -20 });
        if (e.hp <= 0) this.kill(e, game, false);
        continue;
      }
      this.updateEnemy(e, dt, game);
    }
    this.list = this.list.filter((e) => !e.dead);
  }

  /** Nächstes lebendes Ziel (Spieler/Siedler) im Aggro-Radius. */
  findUnitTarget(e, game) {
    const def = ENEMY_DEFS[e.type];
    let best = null, bd = def.aggro;
    const p = game.player;
    if (!p.dead) {
      const d = dist(e.x, e.y, p.x, p.y);
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    for (const s of game.settlers.list) {
      if (s.hidden) continue;
      const d = dist(e.x, e.y, s.x, s.y);
      if (d < bd) {
        bd = d;
        best = s;
      }
    }
    return best;
  }

  updateEnemy(e, dt, game) {
    const { world, buildings } = game;
    const def = ENEMY_DEFS[e.type];
    e.cd -= dt;
    e.retarget -= dt;
    if (e.retarget <= 0) {
      e.retarget = 0.4;
      e.target = this.findUnitTarget(e, game);
    }
    const solid = (tx, ty) => !world.passable(tx, ty, 'enemy');

    // 1) Einheit verfolgen und angreifen
    const t = e.target;
    if (t && !t.dead && !t.hidden) {
      const d = dist(e.x, e.y, t.x, t.y);
      if (d <= e.r + 8) {
        this.tryAttack(e, def, game, () => damageUnit(game, t, e.dmg, ((t.x - e.x) / (d || 1)) * 4, ((t.y - e.y) / (d || 1)) * 4), t.x);
        return;
      }
      const blocked = this.step(e, t.x - e.x, t.y - e.y, dt, world);
      if (blocked) {
        e.blockedT += dt;
        if (e.blockedT > 0.6) {
          e.target = null; // Hindernis: zurück auf das Flussfeld
          e.retarget = 1.5;
          e.blockedT = 0;
        }
      } else e.blockedT = 0;
      return;
    }

    // 2) Dem Flussfeld Richtung Flamme folgen; Gebäude im Weg werden angegriffen
    const tx = Math.floor(e.x / TILE), ty = Math.floor(e.y / TILE);
    let bestI = -1, bestF = world.flowAt(tx, ty), bx = tx, by = ty;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = tx + dx, ny = ty + dy;
        if (dx && dy && (solid(tx + dx, ty) || solid(tx, ty + dy))) continue;
        const f = world.flowAt(nx, ny);
        if (f < bestF) {
          bestF = f;
          bestI = ny * world.w + nx;
          bx = nx;
          by = ny;
        }
      }
    }
    if (bestI < 0) {
      // Kein Flussfeld (z. B. eingeschlossen): direkt auf die Flamme zu
      const c = buildings.center;
      if (!c) return;
      if (buildings.distTo(c, e.x, e.y) <= e.r + 4) {
        this.tryAttack(e, def, game, () => damageBuilding(game, c, e.dmg * def.bld), c.x);
        return;
      }
      this.step(e, c.x - e.x, c.y - e.y, dt, world);
      return;
    }
    const b = world.buildingAt[bestI];
    if (b && !b.dead) {
      if (buildings.distTo(b, e.x, e.y) <= e.r + 4) {
        this.tryAttack(e, def, game, () => damageBuilding(game, b, e.dmg * def.bld), b.x);
        return;
      }
    }
    this.step(e, (bx + 0.5) * TILE - e.x, (by + 0.5) * TILE - e.y, dt, world);
  }

  /** Schritt in Richtung (dx,dy); liefert true, wenn blockiert. */
  step(e, dx, dy, dt, world) {
    const d = Math.hypot(dx, dy);
    if (d < 0.5) return false;
    const sp = e.speed * dt;
    e.walk += dt * (e.type === 'dog' ? 16 : 9);
    if (Math.abs(dx) > 0.5) e.flip = dx < 0;
    return world.moveEntity(e, (dx / d) * sp, (dy / d) * sp, e.r, 'enemy');
  }

  tryAttack(e, def, game, fn, tx) {
    e.flip = tx < e.x;
    if (e.cd > 0) return;
    e.cd = def.cd;
    e.attack = 1;
    fn();
    game.audio.play(e.type === 'brute' || e.type === 'boss' ? 'smash' : 'claw', 0.5);
  }

  /** Treffer durch Spieler oder Turm. */
  hit(e, dmg, game, kx = 0, ky = 0) {
    if (e.dead) return;
    e.hp -= dmg;
    e.hurt = 0.12;
    const kb = e.type === 'boss' ? 0.1 : e.type === 'brute' ? 0.3 : 1;
    game.world.moveEntity(e, kx * kb, ky * kb, e.r, 'enemy');
    game.effects.burst(e.x, e.y - 8, { n: 4, color: ['#5a5450', '#8a8580', '#e8742a'], speed: 40, life: 0.4 });
    if (e.hp <= 0) this.kill(e, game, true);
  }

  kill(e, game, byPlayer) {
    if (e.dead) return;
    e.dead = true;
    const big = e.type === 'brute' || e.type === 'boss';
    game.effects.burst(e.x, e.y - 8, { n: big ? 40 : 18, color: ['#5a5450', '#3b3634', '#8a8580', '#e8742a', '#b8401c'], speed: big ? 70 : 45, life: 0.9, up: 25 });
    if (byPlayer) {
      game.stats.kills++;
      game.audio.play('enemyDie', 0.6);
    }
    if (e.type === 'boss' && byPlayer) game.ui.toast('Der Prätor der Asche ist gefallen!', 'good');
  }

  // ---------------------------------------------------------------- Rendering
  collectDrawables(out, ctx, cam, time) {
    for (const e of this.list) {
      if (!cam.visible(e.x - 12, e.y - 34, 24, 36)) continue;
      const h = e.type === 'boss' ? 32 : e.type === 'brute' ? 24 : 17;
      out.push({ y: e.y, draw: () => this.drawOne(ctx, e, time), unit: [e.x - 6, e.y - h, 12, h], sil: () => drawEnemy(ctx, e, time, '#ff9070') });
    }
  }

  drawOne(ctx, e, time) {
    drawEnemy(ctx, e, time, null, OUTLINE.enemy);
    if (e.hp < e.maxHp) {
      const w = e.type === 'boss' ? 20 : e.type === 'brute' ? 14 : 10;
      const top = e.type === 'boss' ? 36 : e.type === 'brute' ? 28 : 21;
      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      ctx.fillRect(Math.round(e.x - w / 2), Math.round(e.y - top), w, 2);
      ctx.fillStyle = '#d0402a';
      ctx.fillRect(Math.round(e.x - w / 2), Math.round(e.y - top), Math.max(0, Math.round((w * e.hp) / e.maxHp)), 2);
    }
  }

  /** Pfeile am Bildschirmrand, die auf Gegner außerhalb der Sicht zeigen. */
  drawIndicators(ctx, cam) {
    let n = 0;
    for (const e of this.list) {
      if (n > 12) break;
      if (drawEdgeArrow(ctx, cam, e.x, e.y - 8, e.type === 'boss' ? { color: 'rgba(255,90,40,0.95)', size: 1.6 } : { color: 'rgba(208,64,42,0.85)' })) n++;
    }
  }
}
