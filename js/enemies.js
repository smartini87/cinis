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
  // Lernnächte: wenige, langsame Aschgänger
  if (n <= 3) return { walker: [2, 4, 6][n - 1], dog: 0, brute: 0, boss: 0, hpMul: 1, dmgMul: 1, speedMul: [0.7, 0.85, 0.95][n - 1], edges: 1 };
  return {
    speedMul: 1,
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
    this.plan = { n, edges, total: types.length, hpMul: w.hpMul, dmgMul: w.dmgMul, speedMul: w.speedMul, boss: w.boss };
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
      target: null, retarget: 0, dead: false, burn: false, blockedT: 0, kvx: 0, kvy: 0, prep: 0,
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
        if (pos) {
          const e = this.spawn(q.type, pos.x, pos.y, this.plan.hpMul, this.plan.dmgMul);
          e.speed *= this.plan.speedMul ?? 1;
        }
      }
    }
    const sunny = cycle.isSunny;
    for (const e of this.list) {
      if (e.hurt > 0) e.hurt -= dt;
      if (e.attack > 0) e.attack = Math.max(0, e.attack - dt * 3);
      // Rückstoß klingt schnell ab
      if (Math.abs(e.kvx) + Math.abs(e.kvy) > 1) {
        world.moveEntity(e, e.kvx * dt, e.kvy * dt, e.r, 'enemy');
        const k = Math.exp(-12 * dt);
        e.kvx *= k;
        e.kvy *= k;
      }
      e.prep = 0;
      // Wächter in den Lagern stehen im Rauch ihrer Feuer und verbrennen nicht
      e.burn = sunny && !(e.guard && e.guard.shade);
      if (e.burn) {
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
  findUnitTarget(e, game, range = null) {
    const def = ENEMY_DEFS[e.type];
    let best = null, bd = range ?? def.aggro;
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

  /** Elite: deutlich zäher und stärker, glühende Aura. */
  makeElite(e) {
    e.elite = true;
    e.hp *= 2.5;
    e.maxHp *= 2.5;
    e.dmg *= 1.5;
  }

  /**
   * Wächter eines Lagers: patrouillieren um das Feuer, greifen an, wer zu nah kommt,
   * und kehren zurück, wenn das Ziel die Leine (guard.r) verlässt.
   */
  updateGuard(e, dt, game) {
    const def = ENEMY_DEFS[e.type], g = e.guard;
    e.cd -= dt;
    e.retarget -= dt;
    if (e.retarget <= 0) {
      e.retarget = 0.35;
      const t = this.findUnitTarget(e, game, e.raider ? 6 * TILE : def.aggro * 1.2);
      e.target = t && dist(t.x, t.y, g.x, g.y) < g.r * 1.3 ? t : null;
    }
    const t = e.target;
    if (t && !t.dead && !t.hidden && dist(t.x, t.y, g.x, g.y) < g.r * 1.5) {
      const d = dist(e.x, e.y, t.x, t.y);
      if (d <= e.r + 8) {
        this.tryAttack(e, def, game, () => damageUnit(game, t, e.dmg, ((t.x - e.x) / (d || 1)) * 4, ((t.y - e.y) / (d || 1)) * 4), t.x);
        return;
      }
      this.step(e, t.x - e.x, t.y - e.y, dt, game.world);
      return;
    }
    e.target = null;
    // Patrouille: zufällige Punkte rund ums Lager, gemächlich
    e.patrolT = (e.patrolT || 0) - dt;
    if (!e.patrol || e.patrolT <= 0 || dist(e.x, e.y, e.patrol.x, e.patrol.y) < 3) {
      const a = Math.random() * Math.PI * 2, r = 12 + Math.random() * 30;
      e.patrol = { x: g.x + Math.cos(a) * r, y: g.y + Math.sin(a) * r * 0.7 };
      e.patrolT = 3 + Math.random() * 4;
    }
    const sp = e.speed;
    e.speed = sp * 0.45;
    if (this.step(e, e.patrol.x - e.x, e.patrol.y - e.y, dt, game.world)) e.patrolT = 0;
    e.speed = sp;
  }

  updateEnemy(e, dt, game) {
    if (e.guard) {
      this.updateGuard(e, dt, game);
      return;
    }
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
      // Steht ein Gebäude zwischen Gegner und Ziel (z. B. eingemauerter Spieler), wird es eingerissen
      if (e.breach && !e.breach.dead && buildings.distTo(e.breach, e.x, e.y) <= e.r + 5) {
        this.tryAttack(e, def, game, () => damageBuilding(game, e.breach, e.dmg * def.bld), e.breach.x);
        return;
      }
      if (e.breach && e.breach.dead) e.breach = null;
      const blocked = this.step(e, t.x - e.x, t.y - e.y, dt, world);
      if (blocked) {
        e.blockedT += dt;
        if (e.blockedT > 0.8) {
          e.blockedT = 0;
          e.breach = this.nearestBlocker(e, world, buildings, t);
          if (!e.breach) {
            e.target = null; // Gelände im Weg: zurück auf das Flussfeld
            e.retarget = 1.5;
          }
        }
      } else e.blockedT = 0;
      return;
    }

    // 2) Dem Flussfeld Richtung Flamme folgen; Gebäude im Weg werden angegriffen
    const tx = Math.floor(e.x / TILE), ty = Math.floor(e.y / TILE);
    // Festgefahren (z. B. an einer Ecke)? Dann das nächste Gebäude in Laufrichtung angreifen
    if (e.breach && !e.breach.dead) {
      if (buildings.distTo(e.breach, e.x, e.y) <= e.r + 5) {
        this.tryAttack(e, def, game, () => damageBuilding(game, e.breach, e.dmg * def.bld), e.breach.x);
        return;
      }
      // Hinlaufen; klappt das nicht bald, wieder dem Flussfeld folgen
      e.breachT = (e.breachT || 0) + dt;
      if (e.breachT < 2) {
        this.step(e, e.breach.x - e.x, e.breach.y - e.y, dt, world);
        return;
      }
    }
    e.breach = null;
    e.breachT = 0;
    e.progT = (e.progT || 0) + dt;
    if (e.progT >= 0.5) {
      const moved = Math.hypot(e.x - (e.lastX ?? e.x), e.y - (e.lastY ?? e.y));
      e.stuckT = moved < e.speed * 0.5 * 0.15 ? (e.stuckT || 0) + e.progT : 0;
      e.progT = 0;
      e.lastX = e.x;
      e.lastY = e.y;
      if (e.stuckT > 2) {
        e.stuckT = 0;
        e.breach = this.nearestBlocker(e, world, buildings);
      }
    }
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

  /** Gebäude direkt um den Gegner, bevorzugt in Richtung Flamme (Ausweg, wenn er festhängt). */
  nearestBlocker(e, world, buildings, toward = null) {
    const c = toward || buildings.center, tx = Math.floor(e.x / TILE), ty = Math.floor(e.y / TILE);
    let best = null, bs = Infinity;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!world.inBounds(tx + dx, ty + dy)) continue;
        const b = world.buildingAt[world.idx(tx + dx, ty + dy)];
        if (!b || b.dead || b.type === 'center') continue;
        const d = buildings.distTo(b, e.x, e.y);
        if (d > e.r + 6) continue; // nur, was direkt anliegt
        const score = d + (c ? Math.hypot(b.x - c.x, b.y - c.y) * 0.2 : 0);
        if (score < bs) {
          bs = score;
          best = b;
        }
      }
    }
    return best;
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
    // Ausholen kurz vor dem Schlag (sichtbare Vorwarnung)
    e.prep = e.cd < 0.3 ? 1 - Math.max(0, e.cd) / 0.3 : 0;
    if (e.cd > 0) return;
    e.prep = 0;
    e.cd = def.cd;
    e.attack = 1;
    game.noise(e.x, e.y, 4 * TILE);
    fn();
    game.audio.play(e.type === 'brute' || e.type === 'boss' ? 'smash' : 'claw', 0.5);
  }

  /** Treffer durch Spieler oder Turm. */
  hit(e, dmg, game, kx = 0, ky = 0) {
    if (e.dead) return;
    e.hp -= dmg;
    e.hurt = 0.12;
    const kb = e.type === 'boss' ? 0.1 : e.type === 'brute' ? 0.3 : 1;
    e.kvx += kx * kb * 14;
    e.kvy += ky * kb * 14;
    game.effects.burst(e.x, e.y - 8, { n: 4, color: ['#5a5450', '#8a8580', '#e8742a'], speed: 40, life: 0.4 });
    if (e.hp <= 0) this.kill(e, game, true);
  }

  kill(e, game, byPlayer) {
    if (e.dead) return;
    e.dead = true;
    const big = e.type === 'brute' || e.type === 'boss';
    game.effects.burst(e.x, e.y - 8, { n: big ? 40 : 18, color: ['#5a5450', '#3b3634', '#8a8580', '#e8742a', '#b8401c'], speed: big ? 70 : 45, life: 0.9, up: 25 });
    // Zerfall zu Asche: Figur sinkt ein und verblasst, Flocken steigen auf
    const ghost = { ...e, hurt: 0, attack: 0, prep: 0 };
    game.effects.corpse((ctx, k) => drawEnemy(ctx, { ...ghost, y: ghost.y + k * 4 }, 0, k > 0.5 ? '#3b3634' : null), 0.5);
    game.effects.burst(e.x, e.y - 6, { n: big ? 18 : 8, color: ['#8a8580', '#5a5450'], speed: 10, life: 1.4, up: 22, gravity: -8, drag: 0.5 });
    if (byPlayer) {
      game.stats.kills++;
      game.audio.play('enemyDie', 0.6);
    }
    this.drop(e, game, byPlayer);
    if (e.type === 'boss' && byPlayer) game.ui.toast('Der Prätor der Asche ist gefallen!', 'good');
  }

  /** Beute: Kolosse und Eliten lassen Eisen fallen, Aschgänger manchmal Kohle. Spieler bekommt sie direkt. */
  drop(e, game, byPlayer) {
    if (e.raider && !byPlayer) return;
    const items = {};
    const add = (k, n) => n > 0 && (items[k] = (items[k] || 0) + n);
    if (e.type === 'walker' && Math.random() < 0.2) add('coal', 1);
    if (e.type === 'dog' && Math.random() < 0.15) add('hide', 1);
    if (e.type === 'brute') {
      add('iron', 2);
      add('coal', 1);
    }
    if (e.type === 'boss') {
      add('iron', 6);
      add('coal', 4);
    }
    if (e.elite) add('iron', 2);
    if (!Object.keys(items).length) return;
    if (byPlayer) game.pois.give(game, e.x, e.y, items);
    else game.loot.drop(e.x, e.y, items);
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
    if (e.elite) {
      // Glut-Aura der Elite
      const r = 9 + Math.sin(time * 5) * 1.5;
      ctx.fillStyle = 'rgba(255,110,40,0.18)';
      ctx.beginPath();
      ctx.ellipse(Math.round(e.x), Math.round(e.y - 2), r * 1.4, r * 0.6, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    drawEnemy(ctx, e, time, null, e.elite ? '#ff7a2a' : OUTLINE.enemy);
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
      if (e.guard && !e.target) continue; // Lagerwächter nur, wenn sie dich verfolgen
      if (drawEdgeArrow(ctx, cam, e.x, e.y - 8, e.type === 'boss' ? { color: 'rgba(255,90,40,0.95)', size: 1.6 } : { color: 'rgba(208,64,42,0.85)' })) n++;
    }
  }
}
