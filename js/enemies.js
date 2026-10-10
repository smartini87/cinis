// enemies.js – Gegnertypen, Wellenplanung pro Nacht (steigende Schwierigkeit), Gegner-KI
// (Flussfeld zur Flamme, Angriff auf Gebäude/Einheiten), Sonnenbrand am Morgen, Zeichnen.

import { TILE, SUN_BURN } from './config.js';
import { NIGHT_LEN } from './time.js';
import { drawEnemy, OUTLINE } from './sprites.js';
import { drawEdgeArrow } from './ui.js';
import { damageBuilding, damageUnit } from './combat.js';
import { dist } from './util.js';

/**
 * Gegnertypen. bld = Faktor für Schaden an Gebäuden, aggro = Radius, in dem Einheiten verfolgt werden,
 * range = Fernkampfreichweite, breaker = folgt dem Brecher-Flussfeld (mitten durch Mauern).
 */
export const ENEMY_DEFS = {
  walker: { name: 'Aschgänger', hp: 40, speed: 26, dmg: 8, cd: 1.0, r: 4, bld: 1, aggro: 4 * TILE },
  dog: { name: 'Ruinenhund (Läufer)', hp: 24, speed: 52, dmg: 5, cd: 0.6, r: 3, bld: 0.5, aggro: 6 * TILE },
  swarm: { name: 'Aschfalter (Schwarm)', hp: 9, speed: 60, dmg: 3, cd: 0.5, r: 2, bld: 0.3, aggro: 7 * TILE },
  breaker: { name: 'Brecher', hp: 95, speed: 21, dmg: 12, cd: 1.2, r: 5, bld: 3, aggro: 1.5 * TILE, breaker: true },
  archer: { name: 'Aschenwerfer (Fernkampf)', hp: 32, speed: 24, dmg: 7, cd: 1.8, r: 4, bld: 1, aggro: 7 * TILE, range: 5 * TILE },
  brute: { name: 'Aschkoloss', hp: 170, speed: 17, dmg: 22, cd: 1.6, r: 6, bld: 2, aggro: 3 * TILE },
  boss: { name: 'Prätor der Asche', hp: 700, speed: 19, dmg: 32, cd: 1.5, r: 8, bld: 1.5, aggro: 5 * TILE },
};
const SPAWN_ORDER = ['walker', 'dog', 'swarm', 'breaker', 'archer', 'brute', 'boss'];

const EDGE_NAMES = { n: 'Norden', s: 'Süden', w: 'Westen', e: 'Osten' };

/**
 * Zusammensetzung der Welle in Nacht n – endlos: mehr Gegner, neue Typen, höhere Werte.
 * Läufer ab 4, Schwärme ab 5, Brecher ab 7, Fernkämpfer ab 8, Kolosse ab 9, Eliten ab 11, Boss alle 5 Nächte.
 */
export function waveFor(n) {
  // Lernnächte: wenige, langsame Aschgänger
  if (n <= 3) return { walker: [2, 4, 6][n - 1], hpMul: 1, dmgMul: 1, speedMul: [0.7, 0.85, 0.95][n - 1], edges: 1, elite: 0, swarmGroups: 0 };
  const total = Math.round(1 + 1.5 * n + 0.028 * n * n);
  const weights = { walker: 1, dog: 0.5, breaker: n >= 7 ? 0.18 : 0, archer: n >= 8 ? 0.28 : 0, brute: n >= 9 ? 0.16 : 0 };
  const sum = Object.values(weights).reduce((a, b) => a + b, 0);
  const w = { speedMul: 1 };
  for (const [k, v] of Object.entries(weights)) w[k] = Math.floor((total * v) / sum);
  w.walker += total - Object.keys(weights).reduce((a, k) => a + w[k], 0);
  w.swarmGroups = n >= 5 ? 1 + Math.floor((n - 5) / 5) : 0;
  w.boss = n % 5 === 0 ? 1 + Math.floor(n / 25) : 0;
  w.bossAbility = (n / 5) % 2 === 1 ? 'stomp' : 'summon';
  w.hpMul = 1 + 0.09 * n + 0.002 * n * n;
  w.dmgMul = 1 + 0.05 * n;
  w.edges = n >= 20 ? 4 : n >= 12 ? 3 : n >= 6 ? 2 : 1;
  w.elite = n >= 11 ? Math.min(0.3, 0.05 + (n - 11) * 0.015) : 0;
  return w;
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
    for (const t of SPAWN_ORDER) for (let i = 0; i < (w[t] || 0); i++) types.push(t);
    // Bunt mischen, damit nicht erst alle Aschgänger und dann alle Kolosse kommen
    for (let i = types.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [types[i], types[j]] = [types[j], types[i]];
    }
    // Spawns über die ersten 60 % der Nacht verteilen, Bosse in der Mitte, Schwärme als Gruppe
    types.forEach((type, i) => {
      const at = type === 'boss' ? NIGHT_LEN * 0.3 : (i / Math.max(1, types.length)) * NIGHT_LEN * 0.6 + Math.random() * 3;
      this.queue.push({ type, at, edge: edges[i % edges.length], elite: type !== 'boss' && Math.random() < w.elite });
    });
    for (let gI = 0; gI < (w.swarmGroups || 0); gI++) {
      this.queue.push({ type: 'swarm', at: NIGHT_LEN * (0.15 + 0.4 * Math.random()), edge: edges[gI % edges.length], group: 6 + Math.floor(Math.random() * 5) });
    }
    this.queue.sort((a, b) => a.at - b.at);
    const swarmN = this.queue.filter((q) => q.group).reduce((a, q) => a + q.group, 0);
    this.plan = { n, edges, total: types.length + swarmN, hpMul: w.hpMul, dmgMul: w.dmgMul, speedMul: w.speedMul, boss: w.boss || 0, bossAbility: w.bossAbility, counts: w };
    return this.plan;
  }

  /** Text für die Ankündigung. */
  describePlan() {
    const p = this.plan;
    if (!p) return '';
    const dirs = p.edges.map((e) => EDGE_NAMES[e]).join(', ').replace(/, ([^,]*)$/, ' und $1');
    const news = [];
    if (p.counts && p.counts.breaker) news.push('Brecher');
    if (p.counts && p.counts.archer) news.push('Aschenwerfer');
    if (p.counts && p.counts.swarmGroups) news.push('Schwärme');
    return `${p.total} Feinde aus dem ${dirs}${news.length ? ` (darunter ${news.join(', ')})` : ''}${p.boss ? ` – ein Prätor der Asche (${p.bossAbility === 'stomp' ? 'Stampfer' : 'Beschwörer'}) führt sie an!` : ''}`;
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
          for (let k = 0; k < (q.group || 1); k++) {
            const e = this.spawn(q.type, pos.x + (k ? (Math.random() - 0.5) * 20 : 0), pos.y + (k ? (Math.random() - 0.5) * 20 : 0), this.plan.hpMul * (q.type === 'boss' ? 1 + this.plan.n * 0.04 : 1), this.plan.dmgMul);
            e.speed *= this.plan.speedMul ?? 1;
            if (q.elite) this.makeElite(e);
            if (q.type === 'boss') {
              e.ability = this.plan.bossAbility;
              e.abilityT = 4;
              game.ui.toast(`Ein Prätor der Asche ist erschienen – ${e.ability === 'stomp' ? 'er erschüttert den Boden!' : 'er ruft Schwärme herbei!'}`, 'danger');
            }
          }
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
      if (e.slowT > 0) e.slowT -= dt;
      this.checkTrap(e, game);
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

  /** Falle unter dem Gegner auslösen: Schaden und Verlangsamung, nach 3 Auslösungen kaputt. */
  checkTrap(e, game) {
    const w = game.world, tx = Math.floor(e.x / TILE), ty = Math.floor(e.y / TILE);
    if (!w.inBounds(tx, ty)) return;
    const b = w.buildingAt[ty * w.w + tx];
    if (!b || b.type !== 'trap' || b.site || b.dead || (b.cd || 0) > game.time) return;
    b.cd = game.time + 0.8;
    b.uses--;
    e.slowT = 3;
    game.effects.burst(e.x, e.y - 4, { n: 8, color: ['#9aa0a6', '#8a1c1c'], speed: 40, life: 0.4 });
    game.audio.play('trap', 0.6);
    this.hit(e, 50, game);
    if (b.uses <= 0) {
      b.flash = 0.2;
      game.buildings.remove(b);
    }
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
    if (e.type === 'boss' && e.ability && this.updateBoss(e, def, dt, game)) return;
    if (def.range && this.updateRanged(e, def, dt, game)) return;
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
    const brk = !!def.breaker;
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
    let bestI = -1, bestF = world.flowAt(tx, ty, brk), bx = tx, by = ty;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = tx + dx, ny = ty + dy;
        if (dx && dy && (solid(tx + dx, ty) || solid(tx, ty + dy))) continue;
        const f = world.flowAt(nx, ny, brk);
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
    if (b && !b.dead && b.type !== 'trap') {
      if (buildings.distTo(b, e.x, e.y) <= e.r + 4) {
        this.tryAttack(e, def, game, () => damageBuilding(game, b, e.dmg * def.bld), b.x);
        return;
      }
    }
    this.step(e, (bx + 0.5) * TILE - e.x, (by + 0.5) * TILE - e.y, dt, world);
  }

  /**
   * Fernkämpfer: nimmt Türme (bis 10 Felder), sonst Spieler/Siedler, sonst die Flamme ins Visier, hält Abstand
   * und wirft Glut. Liefert true, wenn er sich in diesem Schritt selbst gesteuert hat.
   */
  updateRanged(e, def, dt, game) {
    const B = game.buildings;
    e.aimT = (e.aimT || 0) - dt;
    if (e.aimT <= 0) {
      e.aimT = 0.5;
      let best = null, bd = 10 * TILE;
      for (const b of B.list) {
        if ((b.type !== 'tower' && b.type !== 'tower2') || b.dead) continue;
        const d = B.distTo(b, e.x, e.y);
        if (d < bd) {
          bd = d;
          best = b;
        }
      }
      e.shot = best || this.findUnitTarget(e, game) || (B.center && B.distTo(B.center, e.x, e.y) < def.range * 1.4 ? B.center : null);
    }
    const t = e.shot;
    if (!t || t.dead || t.hidden) return false;
    const isB = t.size !== undefined;
    const d = isB ? B.distTo(t, e.x, e.y) : dist(e.x, e.y, t.x, t.y);
    if (d <= def.range) {
      e.flip = t.x < e.x;
      if (e.cd <= 0) {
        e.cd = def.cd;
        e.attack = 1;
        game.combat.fireShot(e.x, e.y - 10, t, e.dmg * (isB ? def.bld : 1), isB);
        game.noise(e.x, e.y, 4 * TILE);
        if (game.camera.visible(e.x, e.y, 1, 1, 0)) game.audio.play('throw', 0.4);
      }
      return true;
    }
    if (isB && t === B.center) return false; // zur Flamme: dem Flussfeld folgen
    e.blockedT = this.step(e, t.x - e.x, t.y - e.y, dt, game.world) ? (e.blockedT || 0) + dt : 0;
    if (e.blockedT > 1.5) {
      e.shot = null;
      e.aimT = 3;
      return false;
    }
    return true;
  }

  /** Boss-Fähigkeiten: „Stampfer“ erschüttert mit Vorwarnung den Boden, „Beschwörer“ ruft Schwärme. */
  updateBoss(e, def, dt, game) {
    e.abilityT -= dt;
    if (e.ability === 'summon') {
      if (e.abilityT <= 0) {
        e.abilityT = 9;
        for (let i = 0; i < 4; i++) {
          const a = (i / 4) * Math.PI * 2;
          const s = this.spawn('swarm', e.x + Math.cos(a) * 14, e.y + Math.sin(a) * 10, this.plan ? this.plan.hpMul : 1, this.plan ? this.plan.dmgMul : 1);
          s.retarget = 0;
        }
        game.effects.burst(e.x, e.y - 12, { n: 24, color: ['#8a3aa0', '#3b3634', '#e8742a'], speed: 50, life: 0.7 });
        game.audio.play('summon', 0.7);
      }
      return false;
    }
    // Stampfen: nur, wenn etwas in Reichweite ist; während der Vorwarnung steht der Boss still
    if (e.telegraph > 0) {
      e.telegraph -= dt;
      if (e.telegraph <= 0) this.stomp(e, game);
      return true;
    }
    if (e.abilityT <= 0) {
      const r = 3 * TILE, p = game.player;
      const near = (!p.dead && dist(e.x, e.y, p.x, p.y) < r) || game.settlers.list.some((s) => !s.hidden && dist(e.x, e.y, s.x, s.y) < r) || game.buildings.list.some((b) => b.type !== 'trap' && game.buildings.distTo(b, e.x, e.y) < 2 * TILE);
      if (near) {
        e.telegraph = 1;
        e.abilityT = 7;
        game.audio.play('alarm', 0.4);
        return true;
      }
    }
    return false;
  }

  stomp(e, game) {
    const r = 3 * TILE, p = game.player;
    const hitU = (u) => {
      const d = dist(e.x, e.y, u.x, u.y);
      if (d < r) damageUnit(game, u, e.dmg * 0.8, ((u.x - e.x) / (d || 1)) * 10, ((u.y - e.y) / (d || 1)) * 10);
    };
    if (!p.dead) hitU(p);
    for (const s of game.settlers.list) if (!s.hidden) hitU(s);
    for (const b of [...game.buildings.list]) if (b.type !== 'center' && game.buildings.distTo(b, e.x, e.y) < 2 * TILE) damageBuilding(game, b, e.dmg * 2);
    const c = game.buildings.center;
    if (c && game.buildings.distTo(c, e.x, e.y) < 2 * TILE) damageBuilding(game, c, e.dmg * 1.5);
    game.camera.addShake(5, 0.4);
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      game.effects.burst(e.x + Math.cos(a) * r * 0.8, e.y + Math.sin(a) * r * 0.5, { n: 1, color: ['#5a5450', '#8a8580', '#e8742a'], speed: 30, life: 0.6, up: 20 });
    }
    game.audio.play('smash', 1);
  }

  /** Gebäude direkt um den Gegner, bevorzugt in Richtung Flamme (Ausweg, wenn er festhängt). */
  nearestBlocker(e, world, buildings, toward = null) {
    const c = toward || buildings.center, tx = Math.floor(e.x / TILE), ty = Math.floor(e.y / TILE);
    let best = null, bs = Infinity;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!world.inBounds(tx + dx, ty + dy)) continue;
        const b = world.buildingAt[world.idx(tx + dx, ty + dy)];
        if (!b || b.dead || b.type === 'center' || b.type === 'trap') continue;
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
    const sp = e.speed * dt * (e.slowT > 0 ? 0.4 : 1);
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
    if (e.telegraph > 0) {
      // Vorwarnung des Stampfens: roter Ring wächst auf die Wirkungsfläche
      const k = 1 - e.telegraph, r = 3 * TILE * (0.3 + 0.7 * k);
      ctx.strokeStyle = `rgba(255,70,40,${0.4 + 0.5 * k})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.ellipse(Math.round(e.x), Math.round(e.y), r, r * 0.6, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = `rgba(255,70,40,${0.12 * k})`;
      ctx.fill();
    }
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
