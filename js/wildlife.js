// wildlife.js – lebendige Wildnis: Tiere mit einfacher Verhaltens-Statemachine (idle, wander, flee, attack,
// sleep). Spawn prozedural nach Biom und Tageszeit in einem Ring um die Kamera, Despawn weit außerhalb.
// Jagdbare Tiere (Hase, Hirsch, Ziege), neutrale Wildschweine, nachts Wolfsrudel; dazu rein dekorative Tiere
// (Vögel, Insekten, Fische, Frösche, Eulen, Fledermäuse, Glühwürmchen), die vereinfacht aktualisiert werden.
// Tiere greifen nie die Flamme oder Gebäude an.

import { TILE, RES } from './config.js';
import { T } from './world.js';
import { drawShadow } from './sprites.js';
import { resolve, moveCircle, placeOnFreeTile } from './physics.js';
import { damageUnit } from './combat.js';
import { dist } from './util.js';

const MAX_ANIMALS = 60;
const MAX_DECO = 30;
const TERRITORY = 13 * TILE;   // jagdbare Tiere und Wölfe meiden den Kern der Siedlung

/**
 * cls: game (jagdbar, flieht), neutral (wird bei Angriff/Nähe aggressiv), hostile (Rudeljäger), deco (nur Optik).
 * biome: erlaubte Bodenarten für den Spawn. time: day | night | dusk | any. cap: Obergrenze gleichzeitig.
 */
export const ANIMAL_DEFS = {
  rabbit: { name: 'Hase', cls: 'game', hp: 8, speed: 30, run: 84, r: 3, flee: 4.5 * TILE, drop: { food: 2 }, biome: ['grass', 'dry'], time: 'day', group: [1, 2], cap: 7, h: 7 },
  deer: { name: 'Hirsch', cls: 'game', hp: 36, speed: 26, run: 96, r: 4.5, flee: 7 * TILE, drop: { food: 6, hide: 1 }, biome: ['grass'], time: 'day', group: [3, 5], cap: 9, herd: true, h: 15 },
  goat: { name: 'Ziege', cls: 'game', hp: 24, speed: 24, run: 72, r: 3.5, flee: 5 * TILE, drop: { food: 4, hide: 1 }, biome: ['dry', 'dirt', 'ash'], time: 'day', group: [2, 3], cap: 5, herd: true, h: 11 },
  boar: { name: 'Wildschwein', cls: 'neutral', hp: 60, speed: 20, run: 128, r: 4.5, dmg: 12, drop: { food: 5, hide: 2 }, biome: ['grass', 'dirt', 'dry'], time: 'day', group: [1, 2], cap: 3, h: 10 },
  wolf: { name: 'Wolf', cls: 'hostile', hp: 42, speed: 36, run: 68, r: 3.5, dmg: 6, cd: 1.1, drop: { hide: 2 }, biome: ['grass', 'dry', 'dirt', 'ash'], time: 'night', group: [3, 4], cap: 8, h: 10 },
  pigeon: { cls: 'deco', kind: 'bird', biome: ['ruin', 'dirt'], time: 'day', group: [2, 4], cap: 8, color: ['#8a8a96', '#b4b4c0', '#6a6a78'] },
  crow: { cls: 'deco', kind: 'bird', biome: ['ruin', 'ash', 'dry'], time: 'dayDusk', group: [2, 3], cap: 6, color: ['#2a2626', '#3e3838', '#151313'] },
  gull: { cls: 'deco', kind: 'bird', biome: ['shore'], time: 'day', group: [1, 3], cap: 4, color: ['#ecebe6', '#ffffff', '#8a8a90'] },
  butterfly: { cls: 'deco', kind: 'insect', biome: ['grass'], time: 'day', group: [1, 2], cap: 6, inView: true },
  dragonfly: { cls: 'deco', kind: 'dragonfly', biome: ['shore', 'water'], time: 'day', group: [1, 1], cap: 3, inView: true },
  fish: { cls: 'deco', kind: 'fish', biome: ['water'], time: 'any', group: [1, 1], cap: 4, inView: true },
  frog: { cls: 'deco', kind: 'frog', biome: ['shore'], time: 'any', group: [1, 2], cap: 3 },
  owl: { cls: 'deco', kind: 'owl', biome: ['grass', 'ruin', 'dry'], time: 'night', group: [1, 1], cap: 2 },
  bat: { cls: 'deco', kind: 'bat', biome: ['any'], time: 'night', group: [2, 3], cap: 5 },
  firefly: { cls: 'deco', kind: 'firefly', biome: ['grass'], time: 'night', group: [3, 5], cap: 12, inView: true },
};

const BIOME = { [T.GRASS]: 'grass', [T.DRY]: 'dry', [T.DIRT]: 'dirt', [T.SAND]: 'shore', [T.PAVE]: 'ruin', [T.SHALLOW]: 'water', [T.WATER]: 'water', [T.ASH]: 'ash' };

let nextId = 1;

export class Wildlife {
  constructor() {
    this.list = [];
    this.spawnT = 0;
    this.soundT = 2;
    this.owlT = 15;
  }

  clear() {
    this.list.length = 0;
  }

  count(pred) {
    let n = 0;
    for (const a of this.list) if (!a.dead && pred(a)) n++;
    return n;
  }

  /** Feindliche Tiere (Wölfe, gereizte Wildschweine) in der Nähe – für die Flucht der Siedler. */
  hostileNear(x, y, r) {
    for (const a of this.list) {
      if (a.dead || !(a.def.cls === 'hostile' || (a.def.cls === 'neutral' && a.aggroT > 0))) continue;
      if (Math.abs(a.x - x) < r && Math.abs(a.y - y) < r && dist(a.x, a.y, x, y) < r) return true;
    }
    return false;
  }

  // ---------------------------------------------------------------- Spawn
  timeOk(def, cycle) {
    switch (def.time) {
      case 'day': return cycle.isSunny;
      case 'dayDusk': return !cycle.isNight;
      case 'night': return cycle.isNight || (cycle.isEvening && cycle.timeToNight < 6);
      default: return true;
    }
  }

  /** Ein Tier (bzw. eine Gruppe) an einer passenden Stelle im Ring um die Kamera erzeugen. */
  trySpawn(game) {
    const { camera: cam, world, cycle } = game;
    const living = this.list.length;
    if (living >= MAX_ANIMALS) return;
    const decoCount = this.count((a) => a.def.cls === 'deco');
    const types = Object.keys(ANIMAL_DEFS).filter((k) => {
      const d = ANIMAL_DEFS[k];
      if (!this.timeOk(d, cycle)) return false;
      if (d.cls === 'deco' && decoCount >= MAX_DECO) return false;
      if (k === 'wolf' && cycle.day < 2) return false; // die erste Nacht bleibt ohne Rudel
      return this.count((a) => a.type === k) < d.cap;
    });
    if (!types.length) return;
    const type = types[(Math.random() * types.length) | 0], def = ANIMAL_DEFS[type];
    const cx = cam.x, cy = cam.y;
    const r0 = Math.hypot(cam.viewW, cam.viewH) / 2 + 12;
    const c = game.buildings.center;
    for (let tries = 0; tries < 8; tries++) {
      const a = Math.random() * Math.PI * 2;
      const rr = def.inView ? Math.random() * (r0 + 80) : r0 + Math.random() * 150;
      const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr;
      const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);
      if (!world.inBounds(tx, ty)) continue;
      const biome = BIOME[world.tileAt(tx, ty)];
      if (!def.biome.includes('any') && !def.biome.includes(biome)) continue;
      if (def.kind !== 'fish' && def.kind !== 'bird' && def.kind !== 'bat' && def.kind !== 'owl' && !world.passable(tx, ty, 'animal')) continue;
      const dc = c ? dist(x, y, c.x, c.y) : 1e9;
      if (def.cls !== 'deco' && dc < TERRITORY) continue;
      // Je weiter von der Flamme, desto belebter die Wildnis
      if (def.cls !== 'deco' && Math.random() > 0.35 + dc / (40 * TILE)) continue;
      if (type === 'wolf' && game.lightAt(x, y) > 0.1) continue;
      this.spawnGroup(type, x, y, game);
      return;
    }
  }

  spawnGroup(type, x, y, game) {
    const def = ANIMAL_DEFS[type];
    let n = def.group[0] + Math.floor(Math.random() * (def.group[1] - def.group[0] + 1));
    // Obergrenzen auch für Gruppen einhalten
    n = Math.min(n, def.cap - this.count((a) => a.type === type));
    if (def.cls === 'deco') n = Math.min(n, MAX_DECO - this.count((a) => a.def.cls === 'deco'));
    const pack = def.cls === 'hostile' ? { members: [], target: null, chaseT: 0, cooldown: 0, hpMax: 0, howled: false } : null;
    let leader = null;
    for (let i = 0; i < n && this.list.length < MAX_ANIMALS; i++) {
      const a = this.spawn(type, x + (Math.random() - 0.5) * 24, y + (Math.random() - 0.5) * 24);
      if (def.herd) a.leader = leader || (leader = a);
      if (pack) {
        a.pack = pack;
        pack.members.push(a);
        pack.hpMax += a.hp;
      }
    }
    if (pack) {
      game.audio.play('howl', 0.5);
      pack.howled = true;
    }
  }

  spawn(type, x, y) {
    const def = ANIMAL_DEFS[type];
    const a = {
      id: nextId++, type, def, animal: true, x, y, r: def.r || 2, hp: def.hp || 1, maxHp: def.hp || 1,
      state: 'idle', t: Math.random() * 2, tx: x, ty: y, flip: Math.random() < 0.5, walk: Math.random() * 6,
      hurt: 0, kvx: 0, kvy: 0, z: 0, alpha: def.inView ? 0 : 1, dead: false, aggroT: 0, cd: 0, target: null,
      passive: def.cls === 'game' || def.cls === 'neutral', home: { x, y }, phase: Math.random() * 10, sense: 0, threat: null,
    };
    if (def.kind === 'bird' || def.kind === 'owl' || def.kind === 'bat') {
      a.state = def.kind === 'bird' ? 'ground' : 'fly';
      a.z = def.kind === 'bird' ? 0 : 18 + Math.random() * 10;
    }
    if (def.kind === 'insect' || def.kind === 'dragonfly' || def.kind === 'firefly') a.z = 5 + Math.random() * 6;
    // Landtiere nie in Hindernissen (Baumstamm, Fels, Gebäude) beginnen lassen
    if (this.world && def.cls !== 'deco') {
      placeOnFreeTile(this.world, a, 'animal');
      resolve(this.world, a, a.r, 'animal');
    }
    this.list.push(a);
    return a;
  }

  // ---------------------------------------------------------------- Simulation
  update(dt, game) {
    this.world = game.world;
    this.spawnT -= dt;
    if (this.spawnT <= 0) {
      this.spawnT = 0.4;
      this.trySpawn(game);
    }
    const cam = game.camera;
    const despawnR = Math.hypot(cam.viewW, cam.viewH) / 2 + 240;
    const nearR = Math.hypot(cam.viewW, cam.viewH) / 2 + 60;
    this.frame = (this.frame || 0) + 1;
    for (const a of this.list) {
      if (a.dead) continue;
      const dc = dist(a.x, a.y, cam.x, cam.y);
      if (dc > despawnR) {
        a.dead = true;
        a.gone = true;
        continue;
      }
      // Außerhalb der Sicht genügt jeder dritte Schritt (mit dreifachem dt); Deko friert ganz ein
      let adt = dt;
      if (dc > nearR) {
        if (a.def.cls === 'deco' || (this.frame + a.id) % 3) continue;
        adt = dt * 3;
      }
      this.updateOne(a, adt, game);
    }
    let alive = 0;
    for (const a of this.list) if (!a.dead) this.list[alive++] = a;
    this.list.length = alive;
    this.ambientSounds(dt, game);
  }

  updateOne(a, dt, game) {
    if (a.alpha < 1) a.alpha = Math.min(1, a.alpha + dt);
    if (a.def.cls !== 'deco') this.watchdog(a, dt, game);
    if (a.restT > 0) a.restT -= dt;
    if (a.hurt > 0) a.hurt -= dt;
    if (Math.abs(a.kvx) + Math.abs(a.kvy) > 1) {
      game.world.moveEntity(a, a.kvx * dt, a.kvy * dt, a.r, 'animal');
      const k = Math.exp(-12 * dt);
      a.kvx *= k;
      a.kvy *= k;
    }
    const cls = a.def.cls;
    if (cls === 'deco') this.updateDeco(a, dt, game);
    else if (cls === 'hostile') this.updateWolf(a, dt, game);
    else if (cls === 'neutral') this.updateBoar(a, dt, game);
    else this.updateGame(a, dt, game);
  }

  /**
   * Wächter gegen Festhängen: Will ein Landtier laufen, kommt aber 1 s nicht vom Fleck, weicht es in eine freie
   * Richtung aus; gibt es keine, duckt es sich und wartet (kein weiterer Laufversuch).
   */
  watchdog(a, dt, game) {
    a.wdT = (a.wdT || 0) + dt;
    if (a.wdT < 0.5) return;
    const moved = Math.hypot(a.x - (a.wdX ?? a.x), a.y - (a.wdY ?? a.y)), wants = a.walk !== a.wdWalk;
    a.wdT = 0;
    a.wdX = a.x;
    a.wdY = a.y;
    a.wdWalk = a.walk;
    a.wdStuck = wants && moved < 1.5 ? (a.wdStuck || 0) + 0.5 : 0;
    if (a.wdStuck < 1) return;
    a.wdStuck = 0;
    // Schon kürzlich ausgewichen und wieder festgefahren: dann lieber eine Weile stehen bleiben
    const again = game.time - (a.wdLast || -99) < 4;
    a.wdLast = game.time;
    const esc = again ? null : this.escape(a, game);
    if (esc) {
      a.esc = esc;
      if (a.state === 'wander') {
        a.tx = a.x + esc.x * 30;
        a.ty = a.y + esc.y * 30;
      }
    } else {
      a.state = 'idle';
      a.t = 0;
      a.restT = 3;
      a.esc = null;
      if (a.pack) a.pack.target = null;
    }
  }

  /** Bewegt ein Landtier in Richtung (dx,dy) mit Tempo sp; liefert true bei Hindernis. */
  move(a, dx, dy, sp, dt, game) {
    const d = Math.hypot(dx, dy);
    if (d < 0.5 || a.restT > 0) return false;
    a.walk += dt * sp * 0.25;
    if (Math.abs(dx) > 0.3) a.flip = dx < 0;
    const ox = a.x, oy = a.y;
    const hit = game.world.moveEntity(a, (dx / d) * sp * dt, (dy / d) * sp * dt, a.r, 'animal');
    // Festgefahren? (kaum Bewegung trotz Laufwunsch) – Verhaltensroutinen suchen dann einen anderen Weg
    if (Math.hypot(a.x - ox, a.y - oy) < sp * dt * 0.3) a.blockedT = (a.blockedT || 0) + dt;
    else a.blockedT = 0;
    return hit;
  }

  /**
   * Ausweichrichtung, wenn ein Tier festhängt: von zwölf Richtungen die, in der eine Probebewegung am weitesten
   * kommt. Kommt es nirgends voran (Dickicht), bleibt es stehen (null).
   */
  escape(a, game) {
    let best = null, bd = 3;
    for (let i = 0; i < 12; i++) {
      const ang = (i / 12) * Math.PI * 2 + Math.random() * 0.3, probe = { x: a.x, y: a.y };
      moveCircle(game.world, probe, Math.cos(ang) * 14, Math.sin(ang) * 14, 'animal', a.r);
      const d = Math.hypot(probe.x - a.x, probe.y - a.y);
      if (d > bd) {
        bd = d;
        best = { x: Math.cos(ang), y: Math.sin(ang), t: 0.6 };
      }
    }
    return best;
  }

  /** Nächste Bedrohung (Spieler, Siedler, Gegner, für Beutetiere auch Wölfe) im Umkreis r. */
  findThreat(a, game, r) {
    let best = null, bd = r;
    const p = game.player;
    if (!p.dead) {
      const d = dist(a.x, a.y, p.x, p.y);
      if (d < bd * (Math.hypot(p.vx, p.vy) > 80 ? 1.3 : 1)) {
        bd = d;
        best = p;
      }
    }
    for (const s of game.settlers.list) {
      if (s.hidden || Math.abs(s.x - a.x) > bd || Math.abs(s.y - a.y) > bd) continue;
      const d = dist(a.x, a.y, s.x, s.y);
      if (d < bd * 0.8) {
        bd = d;
        best = s;
      }
    }
    for (const e of game.enemies.list) {
      if (e.dead || Math.abs(e.x - a.x) > bd || Math.abs(e.y - a.y) > bd) continue;
      const d = dist(a.x, a.y, e.x, e.y);
      if (d < bd) {
        bd = d;
        best = e;
      }
    }
    if (a.def.cls === 'game') {
      for (const w of this.list) {
        if (w.dead || w.def.cls !== 'hostile' || Math.abs(w.x - a.x) > bd || Math.abs(w.y - a.y) > bd) continue;
        const d = dist(a.x, a.y, w.x, w.y);
        if (d < bd) {
          bd = d;
          best = w;
        }
      }
    }
    // Kampflärm schreckt auf
    for (const n of game.noises) {
      const d = dist(a.x, a.y, n.x, n.y);
      if (d < n.r && !best) best = n;
    }
    return best;
  }

  /** Jagdbare Tiere: grasen, wandern (Herde folgt dem Leittier), flüchten (Hasen im Zickzack). */
  updateGame(a, dt, game) {
    const def = a.def;
    a.sense -= dt;
    if (a.sense <= 0) {
      a.sense = 0.2;
      const th = this.findThreat(a, game, def.flee);
      if (th) {
        a.threat = { x: th.x, y: th.y };
        if (a.state !== 'flee') {
          a.state = 'flee';
          a.t = 0;
          if (a.type === 'rabbit' && Math.random() < 0.5) game.audio.play('squeak', 0.25);
          // Die Herde flieht gemeinsam
          if (def.herd) for (const o of this.list) if (o !== a && o.type === a.type && !o.dead && dist(o.x, o.y, a.x, a.y) < 60) {
            o.state = 'flee';
            o.t = 0;
            o.threat = a.threat;
          }
        }
      }
    }
    a.t += dt;
    if (a.state === 'flee') {
      const th = a.threat;
      let dx = a.x - th.x, dy = a.y - th.y;
      const d = Math.hypot(dx, dy) || 1;
      dx /= d;
      dy /= d;
      if (a.type === 'rabbit') {
        // Zickzack: seitlich pendeln
        const z = Math.sin(a.t * 9 + a.phase) * 0.9;
        const ox = -dy * z, oy = dx * z;
        dx += ox;
        dy += oy;
      }
      if (a.esc && a.esc.t > 0) {
        a.esc.t -= dt;
        this.move(a, a.esc.x, a.esc.y, def.run, dt, game);
      } else if (this.move(a, dx, dy, def.run, dt, game)) {
        // Hindernis: zur Seite ausweichen; hängt es fest, eine freie Richtung suchen
        this.move(a, -dy, dx, def.run * 0.8, dt, game);
        if (a.blockedT > 0.6) {
          a.esc = this.escape(a, game);
          if (!a.esc) {
            // eingekeilt: Tier duckt sich und wartet
            a.state = 'idle';
            a.t = 0;
            a.blockedT = 0;
          }
        }
      }
      if (d > def.flee * 1.6 || a.t > 5) {
        a.state = 'idle';
        a.t = 0;
      }
      return;
    }
    if (a.state === 'idle') {
      if (a.t > 1.5 + (a.phase % 2.5)) {
        a.state = 'wander';
        a.t = 0;
        const base = a.leader && !a.leader.dead && a.leader !== a ? a.leader : a;
        const ang = Math.random() * Math.PI * 2, rr = 10 + Math.random() * (a.leader === a ? 50 : 24);
        a.tx = base.x + Math.cos(ang) * rr;
        a.ty = base.y + Math.sin(ang) * rr;
      }
      return;
    }
    // Wandern
    const dx = a.tx - a.x, dy = a.ty - a.y;
    if (Math.hypot(dx, dy) < 3 || a.t > 6 || (this.move(a, dx, dy, def.speed, dt, game) && a.blockedT > 0.3)) {
      a.state = 'idle';
      a.t = 0;
      a.phase = Math.random() * 10;
    }
  }

  /** Wildschwein: neutral; bei Treffer oder zu großer Nähe Anlauf (Scharren) und Charge. */
  updateBoar(a, dt, game) {
    const def = a.def;
    a.t += dt;
    a.cd -= dt;
    if (a.aggroT > 0) {
      a.aggroT -= dt;
      const tg = a.target;
      if (!tg || tg.dead || tg.hidden || dist(a.x, a.y, tg.x, tg.y) > 10 * TILE) {
        a.aggroT = 0;
        a.state = 'idle';
        return;
      }
      if (a.state === 'prep') {
        a.flip = tg.x < a.x;
        if (a.t > 0.55) {
          a.state = 'charge';
          a.t = 0;
          a.hitDone = false;
          const d = Math.max(1, dist(a.x, a.y, tg.x, tg.y));
          a.cdx = (tg.x - a.x) / d;
          a.cdy = (tg.y - a.y) / d;
          game.audio.play('grunt', 0.5);
        }
        return;
      }
      if (a.state === 'charge') {
        const blocked = this.move(a, a.cdx, a.cdy, def.run, dt, game);
        if (!a.hitDone) {
          for (const u of [game.player, ...game.settlers.list]) {
            if (u.dead || u.hidden) continue;
            if (dist(a.x, a.y, u.x, u.y) < a.r + (u.r || 3) + 3) {
              damageUnit(game, u, def.dmg, a.cdx * 8, a.cdy * 8);
              a.hitDone = true;
              break;
            }
          }
        }
        if (a.t > 0.75 || blocked) {
          a.state = 'recover';
          a.t = 0;
        }
        return;
      }
      if (a.state === 'recover') {
        if (a.t > 0.9) {
          a.state = 'prep';
          a.t = 0;
        }
        return;
      }
      a.state = 'prep';
      a.t = 0;
      return;
    }
    // Neutral: zu nah gekommen?
    a.sense -= dt;
    if (a.sense <= 0) {
      a.sense = 0.3;
      const p = game.player;
      let tg = null;
      if (!p.dead && dist(a.x, a.y, p.x, p.y) < 2 * TILE) tg = p;
      for (const s of game.settlers.list) if (!tg && !s.hidden && dist(a.x, a.y, s.x, s.y) < 1.6 * TILE) tg = s;
      if (tg) this.provoke(a, tg, game);
    }
    if (a.state === 'idle' || a.state === 'prep' || a.state === 'recover' || a.state === 'charge') {
      if (a.t > 2 + (a.phase % 3)) {
        a.state = 'wander';
        a.t = 0;
        const ang = Math.random() * Math.PI * 2;
        a.tx = a.x + Math.cos(ang) * 30;
        a.ty = a.y + Math.sin(ang) * 30;
      }
      return;
    }
    const dx = a.tx - a.x, dy = a.ty - a.y;
    if (Math.hypot(dx, dy) < 3 || a.t > 6 || this.move(a, dx, dy, def.speed, dt, game)) {
      a.state = 'idle';
      a.t = 0;
    }
  }

  provoke(a, tg, game) {
    if (a.aggroT <= 0) game.audio.play('grunt', 0.6);
    a.aggroT = 9;
    a.target = tg;
    if (a.state !== 'charge' && a.state !== 'prep') {
      a.state = 'prep';
      a.t = 0;
    }
  }

  /**
   * Wolf: jagt im Rudel Spieler oder Siedler außerhalb der Siedlung, meidet Licht und Feuer,
   * gibt nach einer Weile auf, flieht bei schweren Verlusten und verschwindet im Morgengrauen.
   */
  updateWolf(a, dt, game) {
    const def = a.def, pack = a.pack, cyc = game.cycle, c = game.buildings.center;
    a.cd -= dt;
    a.t += dt;
    if (a.attack > 0) a.attack = Math.max(0, a.attack - dt * 3);
    // Morgengrauen oder schwere Verluste: Rückzug
    const packHp = pack ? pack.members.reduce((s, m) => s + (m.dead ? 0 : Math.max(0, m.hp)), 0) : a.hp;
    if (cyc.isSunny || (pack && packHp < pack.hpMax * 0.4)) {
      if (a.state !== 'leave') {
        a.state = 'leave';
        a.t = 0;
      }
      if (a.blockedT > 0.6 && !(a.esc && a.esc.t > 0)) a.esc = this.escape(a, game) || { x: 0, y: 0, t: 1 };
      if (a.esc && a.esc.t > 0) {
        a.esc.t -= dt;
        this.move(a, a.esc.x, a.esc.y, def.run, dt, game);
      } else {
        const dx = a.x - (c ? c.x : a.x), dy = a.y - (c ? c.y : a.y);
        this.move(a, dx || 1, dy, def.run, dt, game);
      }
      if (a.t > 10) a.dead = true;
      return;
    }
    // Licht meiden: aus dem Schein der Flamme und der Feuer heraus
    if (game.lightAt(a.x, a.y) > 0.35 && c) {
      if (a.blockedT > 0.6) a.esc = this.escape(a, game);
      if (a.esc && a.esc.t > 0 && (a.esc.x || a.esc.y)) {
        a.esc.t -= dt;
        this.move(a, a.esc.x, a.esc.y, def.run, dt, game);
      } else this.move(a, a.x - c.x, a.y - c.y, def.run, dt, game);
      if (pack) {
        pack.target = null;
        pack.cooldown = Math.max(pack.cooldown, 4);
      }
      return;
    }
    if (pack) this.updatePack(pack, dt, game);
    const tg = (pack && pack.target) || a.prey;
    if (tg && !tg.dead && !tg.hidden) {
      const d = dist(a.x, a.y, tg.x, tg.y);
      if (d < a.r + (tg.r || 3) + 5) {
        a.flip = tg.x < a.x;
        a.attack = 1;
        if (a.cd <= 0) {
          a.cd = def.cd;
          if (tg.animal) {
            // Beute (Hase) wird gerissen
            tg.hp = 0;
            this.kill(tg, game, null);
            a.prey = null;
          } else {
            damageUnit(game, tg, def.dmg, ((tg.x - a.x) / (d || 1)) * 3, ((tg.y - a.y) / (d || 1)) * 3);
            game.audio.play('bite', 0.5);
          }
        }
        return;
      }
      // Flankieren: jedes Rudelmitglied kommt etwas versetzt
      const off = ((a.id % 3) - 1) * 10;
      const nx = -(tg.y - a.y) / (d || 1), ny = (tg.x - a.x) / (d || 1);
      const ox = d > 30 ? nx * off : 0, oy = d > 30 ? ny * off : 0;
      // Nicht ins Licht laufen
      const ahead = { x: a.x + ((tg.x - a.x) / d) * 12, y: a.y + ((tg.y - a.y) / d) * 12 };
      if (game.lightAt(ahead.x, ahead.y) > 0.35) {
        if (pack) pack.target = null;
        return;
      }
      if (a.esc && a.esc.t > 0) {
        a.esc.t -= dt;
        this.move(a, a.esc.x, a.esc.y, def.run, dt, game);
        return;
      }
      this.move(a, tg.x - a.x + ox, tg.y - a.y + oy, def.run, dt, game);
      if (a.blockedT > 0.8) {
        // Hindernis zwischen Wolf und Beute: ausweichen oder die Jagd aufgeben
        a.esc = this.escape(a, game);
        if (!a.esc && pack) pack.target = null;
      }
      return;
    }
    a.prey = null;
    // Herumstreifen in der Nähe des Leitwolfs; Hasen in der Nähe werden gejagt
    a.sense -= dt;
    if (a.sense <= 0) {
      a.sense = 0.5;
      for (const r of this.list) {
        if (r.type === 'rabbit' && !r.dead && Math.abs(r.x - a.x) < 6 * TILE && Math.abs(r.y - a.y) < 6 * TILE) {
          a.prey = r;
          break;
        }
      }
    }
    const lead = pack ? pack.members.find((m) => !m.dead) : a;
    if (a.state !== 'wander' || a.t > 4) {
      a.state = 'wander';
      a.t = 0;
      const base = lead === a ? a : lead;
      const ang = Math.random() * Math.PI * 2;
      a.tx = base.x + Math.cos(ang) * (lead === a ? 60 : 20);
      a.ty = base.y + Math.sin(ang) * (lead === a ? 60 : 20);
    }
    const dx = a.tx - a.x, dy = a.ty - a.y;
    if (a.restT > 0) return; // eingekeilt: kurz stehen bleiben
    if (Math.hypot(dx, dy) > 3) {
      this.move(a, dx, dy, def.speed, dt, game);
      if (a.blockedT > 0.5) {
        // Hindernis: neues Ziel, und wenn es gar nicht weitergeht, eine Weile stehen bleiben
        a.t = 99;
        a.blockedT = 0;
        if (!this.escape(a, game)) a.restT = 3;
      }
    }
  }

  /** Rudelziel wählen: Spieler/Siedler außerhalb der Siedlung und außerhalb des Lichts; nach 12 s aufgeben. */
  updatePack(pack, dt, game) {
    if (pack.updated === game.time) return;
    pack.updated = game.time;
    pack.cooldown -= dt;
    const alive = pack.members.filter((m) => !m.dead);
    if (!alive.length) return;
    const px = alive.reduce((s, m) => s + m.x, 0) / alive.length, py = alive.reduce((s, m) => s + m.y, 0) / alive.length;
    const c = game.buildings.center;
    const valid = (u) => u && !u.dead && !u.hidden && (!c || dist(u.x, u.y, c.x, c.y) > TERRITORY) && game.lightAt(u.x, u.y) < 0.35;
    if (pack.target) {
      pack.chaseT += dt;
      if (!valid(pack.target) || pack.chaseT > 12 || dist(px, py, pack.target.x, pack.target.y) > 14 * TILE) {
        pack.target = null;
        pack.cooldown = 10;
      }
      return;
    }
    if (pack.cooldown > 0) return;
    pack.scanT = (pack.scanT || 0) - dt;
    if (pack.scanT > 0) return;
    pack.scanT = 0.5;
    let best = null, bd = 11 * TILE;
    for (const u of [game.player, ...game.settlers.list]) {
      if (!valid(u)) continue;
      const d = dist(px, py, u.x, u.y);
      if (d < bd) {
        bd = d;
        best = u;
      }
    }
    if (best) {
      pack.target = best;
      pack.chaseT = 0;
      if (!pack.howled || Math.random() < 0.3) game.audio.play('howl', 0.5);
      pack.howled = true;
    }
  }

  /** Dekorative Tiere: vereinfachte Bewegung ohne Kollision. */
  updateDeco(a, dt, game) {
    const k = a.def.kind;
    a.t += dt;
    a.phase += dt;
    if (k === 'bird') this.updateBird(a, dt, game);
    else if (k === 'insect' || k === 'firefly') {
      // Flattern: weiche Zufallsbahn um den Startpunkt
      const sp = k === 'firefly' ? 8 : 16;
      a.x += Math.cos(a.phase * 1.3 + a.id) * sp * dt + Math.sin(a.phase * 3.1) * sp * 0.6 * dt;
      a.y += Math.sin(a.phase * 1.1 + a.id * 2) * sp * dt;
      a.x += (a.home.x - a.x) * 0.05 * dt;
      a.y += (a.home.y - a.y) * 0.05 * dt;
      a.z = 6 + Math.sin(a.phase * 2) * 2;
      a.flip = Math.sin(a.phase * 1.3 + a.id) < 0;
      if (k === 'firefly' && game.cycle.isSunny) a.dead = true;
    } else if (k === 'dragonfly') {
      // Kurze schnelle Flüge, dazwischen Schweben
      if (a.state !== 'dart' && a.t > 0.8 + (a.id % 5) * 0.3) {
        a.state = 'dart';
        a.t = 0;
        const ang = Math.random() * Math.PI * 2;
        a.tx = a.home.x + Math.cos(ang) * 30;
        a.ty = a.home.y + Math.sin(ang) * 20;
      }
      if (a.state === 'dart') {
        const dx = a.tx - a.x, dy = a.ty - a.y, d = Math.hypot(dx, dy);
        if (d < 2 || a.t > 0.6) {
          a.state = 'hover';
          a.t = 0;
        } else {
          a.x += (dx / d) * 90 * dt;
          a.y += (dy / d) * 90 * dt;
          a.flip = dx < 0;
        }
      }
    } else if (k === 'fish') {
      // Unter Wasser kreisen, gelegentlich springen (Ripples)
      if (a.state === 'jump') {
        a.z = Math.sin((a.t / 0.6) * Math.PI) * 9;
        a.x += a.jdx * dt;
        if (a.t >= 0.6) {
          a.state = 'swim';
          a.t = 0;
          a.z = 0;
          a.ripple = 1;
          if (game.camera.visible(a.x, a.y, 1, 1, 0)) game.effects.burst(a.x, a.y, { n: 4, color: ['#cfeaf8', '#7fc0ea'], speed: 20, life: 0.4, up: 20 });
        }
      } else {
        const nx = a.x + Math.cos(a.phase * 0.7 + a.id) * 10 * dt, ny = a.y + Math.sin(a.phase * 0.5 + a.id) * 6 * dt;
        if (game.world.isWaterTile(Math.floor(nx / TILE), Math.floor(ny / TILE))) {
          a.x = nx;
          a.y = ny;
        }
        if (a.t > 4 && Math.random() < dt * 0.3) {
          a.state = 'jump';
          a.t = 0;
          a.jdx = (Math.random() - 0.5) * 30;
          a.ripple = 1;
        }
      }
      if (a.ripple > 0) a.ripple -= dt * 0.8;
    } else if (k === 'frog') {
      if (a.state === 'hop') {
        a.z = Math.sin((a.t / 0.35) * Math.PI) * 4;
        a.x += a.jdx * dt;
        a.y += a.jdy * dt;
        if (a.t >= 0.35) {
          a.state = 'sit';
          a.t = 0;
          a.z = 0;
          if (game.world.isWaterTile(Math.floor(a.x / TILE), Math.floor(a.y / TILE))) a.ripple = 1;
        }
      } else if (a.t > 2 + (a.id % 4)) {
        a.state = 'hop';
        a.t = 0;
        const ang = Math.random() * Math.PI * 2;
        a.jdx = Math.cos(ang) * 30;
        a.jdy = Math.sin(ang) * 20;
        a.flip = a.jdx < 0;
      }
      if (a.ripple > 0) a.ripple -= dt * 0.8;
    } else if (k === 'owl' || k === 'bat') {
      // Kreisen um Lichtquellen (Fledermäuse) bzw. Ruinen/Bäume (Eulen)
      const c = game.buildings.center;
      const anchor = k === 'bat' && c && dist(a.x, a.y, c.x, c.y) < 260 ? c : a.home;
      const rad = k === 'bat' ? 50 + (a.id % 4) * 12 : 70;
      const sp = k === 'bat' ? 1.6 : 0.5;
      const ang = a.phase * sp + a.id;
      const tx = anchor.x + Math.cos(ang) * rad + (k === 'bat' ? Math.sin(a.phase * 7) * 8 : 0);
      const ty = anchor.y + Math.sin(ang) * rad * 0.6;
      a.flip = tx < a.x;
      a.x += (tx - a.x) * Math.min(1, dt * 2);
      a.y += (ty - a.y) * Math.min(1, dt * 2);
      a.z = (k === 'bat' ? 18 : 26) + Math.sin(a.phase * 2) * 3;
      if (game.cycle.isSunny) a.dead = true;
    }
  }

  /** Vögel: picken am Boden, steigen bei Nähe auf (Federn), fliegen in Bögen, landen; Krähen kreisen abends. */
  updateBird(a, dt, game) {
    const cyc = game.cycle;
    if (a.state === 'ground') {
      a.z = 0;
      a.sense -= dt;
      if (a.t > 0.6) {
        a.t = 0;
        a.peck = Math.random() < 0.5 ? 0.25 : 0;
        if (Math.random() < 0.3) {
          a.x += (Math.random() - 0.5) * 6;
          a.flip = Math.random() < 0.5;
        }
      }
      if (a.peck > 0) a.peck -= dt;
      if (a.sense <= 0) {
        a.sense = 0.25;
        const th = this.findThreat(a, game, 3 * TILE);
        const dusk = a.type === 'crow' && cyc.isEvening;
        if (th || dusk || Math.random() < 0.01) this.takeOff(a, game, th, dusk);
      }
      return;
    }
    if (a.state === 'circle') {
      // Krähen kreisen in der Dämmerung über der Ruine
      const ang = a.phase * 0.9 + a.id;
      a.x += (a.home.x + Math.cos(ang) * 40 - a.x) * Math.min(1, dt * 2);
      a.y += (a.home.y + Math.sin(ang) * 22 - a.y) * Math.min(1, dt * 2);
      a.z = 34 + Math.sin(a.phase) * 4;
      a.flip = Math.cos(ang) > 0;
      if (cyc.isNight) {
        a.state = 'fly';
        a.t = 0;
        a.fx = a.x;
        a.fy = a.y;
        a.tx = a.x + 400;
        a.ty = a.y - 200;
        a.dur = 6;
      }
      return;
    }
    // Flug im Bogen von (fx,fy) nach (tx,ty)
    const k = Math.min(1, a.t / a.dur);
    a.x = a.fx + (a.tx - a.fx) * k;
    a.y = a.fy + (a.ty - a.fy) * k;
    a.z = Math.sin(k * Math.PI) * 26 + (a.land ? 0 : k * 30);
    if (k >= 1) {
      if (a.land) {
        a.state = 'ground';
        a.t = 0;
        a.z = 0;
      } else a.dead = true;
    }
  }

  takeOff(a, game, threat, dusk) {
    a.state = dusk ? 'circle' : 'fly';
    a.t = 0;
    a.fx = a.x;
    a.fy = a.y;
    const awayX = threat ? a.x - threat.x : Math.random() - 0.5, awayY = threat ? a.y - threat.y : Math.random() - 0.5;
    const l = Math.hypot(awayX, awayY) || 1;
    const d = 90 + Math.random() * 110;
    a.tx = a.x + (awayX / l) * d + (Math.random() - 0.5) * 40;
    a.ty = a.y + (awayY / l) * d + (Math.random() - 0.5) * 40;
    a.dur = d / 70;
    // Landeplatz: passende Bodenart, sonst wegfliegen
    const tile = BIOME[game.world.tileAt(Math.floor(a.tx / TILE), Math.floor(a.ty / TILE))];
    a.land = !dusk && a.def.biome.includes(tile);
    a.flip = a.tx < a.x;
    if (game.camera.visible(a.x, a.y, 1, 1, 0)) {
      game.effects.burst(a.x, a.y - 3, { n: 3, color: [a.def.color[1], a.def.color[0]], speed: 18, life: 0.9, up: 14, gravity: 18, drag: 2 });
      game.audio.play('flap', 0.25);
    }
  }

  /** Treffer durch den Spieler. */
  hit(a, dmg, game, kx = 0, ky = 0) {
    if (a.dead) return;
    a.hp -= dmg;
    a.hurt = 0.12;
    a.kvx += kx * 12;
    a.kvy += ky * 12;
    game.effects.burst(a.x, a.y - 5, { n: 4, color: ['#8a1c1c', '#5a3a2a'], speed: 35, life: 0.4 });
    if (a.def.cls === 'neutral') this.provoke(a, game.player, game);
    if (a.def.cls === 'game') {
      a.state = 'flee';
      a.t = 0;
      a.threat = { x: game.player.x, y: game.player.y };
    }
    if (a.pack && !a.pack.target) {
      a.pack.target = game.player;
      a.pack.chaseT = 0;
    }
    if (a.hp <= 0) this.kill(a, game, game.player);
  }

  /** Tod: Beute direkt ins Inventar des Jägers (passt sie nicht, bleibt ein Beutehaufen). */
  kill(a, game, killer) {
    if (a.dead) return;
    a.dead = true;
    game.effects.burst(a.x, a.y - 4, { n: 10, color: ['#8a1c1c', '#5a3a2a', '#c9a87a'], speed: 40, life: 0.6 });
    const ghost = { ...a, hurt: 0 };
    game.effects.corpse((ctx, k) => drawAnimal(ctx, { ...ghost, y: ghost.y + k * 2, dying: true }, 0), 0.6);
    if (!killer || killer !== game.player) return;
    const p = game.player, rest = {};
    let off = 0, left = 0;
    for (const [k, n] of Object.entries(a.def.drop || {})) {
      const fit = n - p.inv.add(k, n);
      if (fit > 0) {
        game.effects.text(a.x, a.y - 14 - off, `+${fit} ${RES[k].name}`, RES[k].color);
        off += 7;
      }
      if (n - fit > 0) {
        rest[k] = n - fit;
        left += n - fit;
      }
    }
    if (left) game.loot.drop(a.x, a.y, rest);
    game.stats.hunted = (game.stats.hunted || 0) + 1;
  }

  // ---------------------------------------------------------------- Klänge
  ambientSounds(dt, game) {
    const cyc = game.cycle, cam = game.camera;
    this.soundT -= dt;
    this.owlT -= dt;
    if (this.soundT <= 0) {
      if (cyc.isNight) {
        this.soundT = 0.8 + Math.random() * 1.4;
        game.audio.play('cricket', 0.35);
      } else {
        this.soundT = 2 + Math.random() * 4;
        const birds = this.count((a) => a.def.kind === 'bird' && cam.visible(a.x, a.y, 1, 1, 80));
        if (birds && cyc.isSunny) game.audio.play('chirp', 0.25 + Math.min(0.3, birds * 0.04));
      }
    }
    if (this.owlT <= 0) {
      this.owlT = 18 + Math.random() * 20;
      if (cyc.isNight && this.count((a) => a.type === 'owl') > 0) game.audio.play('owl', 0.35);
    }
  }

  // ---------------------------------------------------------------- Rendering
  /** Landtiere y-sortiert; Fliegende werfen nur ihren Schatten in die sortierte Liste. */
  collectDrawables(out, ctx, cam, time, glowFor) {
    for (const a of this.list) {
      if (!cam.visible(a.x - 10, a.y - 40, 20, 42)) continue;
      const k = a.def.kind;
      if (k === 'firefly') continue; // nach der Beleuchtung gezeichnet
      if (a.z > 2 || k === 'fish') {
        out.push({ y: a.y - 100, draw: () => this.drawGroundFx(ctx, a) });
        continue;
      }
      out.push({ y: a.y, draw: () => drawAnimal(ctx, a, time, glowFor(a, time)), unit: a.def.cls !== 'deco' ? [a.x - 6, a.y - (a.def.h || 6), 12, a.def.h || 6] : null, sil: () => drawAnimal(ctx, a, time, 0, '#e8d8c0') });
    }
  }

  /** Schatten fliegender Tiere bzw. Wellenringe von Fischen und Fröschen. */
  drawGroundFx(ctx, a) {
    if (a.def.kind === 'fish') {
      if (a.ripple > 0) drawRipple(ctx, a.x, a.y, a.ripple);
      if (a.state !== 'jump') {
        ctx.fillStyle = 'rgba(20,40,60,0.45)';
        ctx.fillRect(Math.round(a.x) - 2, Math.round(a.y), 5, 2);
      }
      return;
    }
    if (a.ripple > 0) drawRipple(ctx, a.x, a.y, a.ripple);
    drawShadow(ctx, a.x, a.y, a.def.kind === 'bird' || a.def.kind === 'owl' ? 3 : 2, 0.18 * a.alpha);
  }

  /** Fliegende Tiere über allem (vor der Beleuchtung). */
  drawAir(ctx, cam, time) {
    for (const a of this.list) {
      const k = a.def.kind;
      if (k === 'firefly' || !(a.z > 2 || k === 'fish')) continue;
      if (!cam.visible(a.x - 10, a.y - 50, 20, 52)) continue;
      drawAnimal(ctx, a, time);
    }
  }

  /** Glühwürmchen nach der Beleuchtung (leuchten im Dunkeln). */
  drawGlow(ctx, cam, time) {
    for (const a of this.list) {
      if (a.def.kind !== 'firefly' || !cam.visible(a.x, a.y, 1, 1, 8)) continue;
      const on = Math.sin(time * 3 + a.id * 1.7) > 0.2;
      if (!on) continue;
      const x = Math.round(a.x), y = Math.round(a.y - a.z);
      ctx.fillStyle = `rgba(210,255,120,${0.25 * a.alpha})`;
      ctx.fillRect(x - 1, y - 1, 3, 3);
      ctx.fillStyle = `rgba(240,255,170,${0.95 * a.alpha})`;
      ctx.fillRect(x, y, 1, 1);
    }
  }
}

function drawRipple(ctx, x, y, k) {
  const r = Math.round(2 + (1 - k) * 6);
  ctx.strokeStyle = `rgba(220,240,255,${0.6 * k})`;
  ctx.lineWidth = 1;
  ctx.strokeRect(Math.round(x) - r + 0.5, Math.round(y) - Math.round(r * 0.4) + 0.5, r * 2, Math.max(1, Math.round(r * 0.8)));
}

const OFFS = [[-1, 0], [1, 0], [0, -1], [0, 1]];

/**
 * Tier zeichnen (Füße bei a.x, a.y; fliegend um a.z angehoben).
 * glow > 0: goldene Kontur (jagdbares Ziel in Reichweite); sil: einfarbige Silhouette.
 */
export function drawAnimal(ctx, a, time, glow = 0, sil = null) {
  const def = a.def, k = def.kind;
  const solid = def.cls !== 'deco';
  if (solid && !sil && !a.dying) {
    // Schatten + Umriss wie bei Figuren, jagdbare Tiere im Fokus golden
    drawShadow(ctx, a.x, a.y, Math.max(3, a.r + 1), 0.34);
    const col = glow > 0 ? '#ffd36a' : '#1d140e';
    const ga = ctx.globalAlpha;
    if (glow > 0) ctx.globalAlpha = ga * glow;
    for (const [dx, dy] of OFFS) drawAnimal(ctx, { ...a, x: a.x + dx, y: a.y + dy, dying: true }, time, 0, col);
    ctx.globalAlpha = ga;
  }
  const x = Math.round(a.x), y = Math.round(a.y - (a.z || 0));
  const f = a.flip ? -1 : 1;
  const white = a.hurt > 0;
  const R = (rx, ry, w, h, c) => {
    ctx.fillStyle = sil || (white ? '#ffffff' : c);
    ctx.fillRect(f === 1 ? x + rx : x - rx - w, y + ry, w, h);
  };
  const moving = a.state === 'flee' || a.state === 'wander' || a.state === 'charge' || a.state === 'leave';
  const step = moving ? Math.round(Math.sin(a.walk) * 1.2) : 0;
  const fa = ctx.globalAlpha;
  if (a.alpha < 1) ctx.globalAlpha = fa * a.alpha;
  switch (a.type) {
    case 'rabbit': {
      const hop = moving ? -Math.abs(Math.round(Math.sin(a.walk * 0.8) * 2)) : 0;
      R(-3, -4 + hop, 6, 3, '#9a8a74');
      R(-3, -2 + hop, 2, 1, '#7a6a58');
      R(1, -2 + hop, 2, 1, '#7a6a58');
      R(2, -6 + hop, 3, 3, '#a89880');
      R(3, -9 + hop, 1, 3, '#a89880');
      R(2, -8 + hop, 1, 2, '#8a7a64');
      R(4, -5 + hop, 1, 1, '#1d1712');
      R(-4, -4 + hop, 1, 1, '#f0ece4');
      break;
    }
    case 'deer': {
      const male = a.id % 3 === 0;
      R(-4, -6, 1, 6 + Math.max(0, step), '#5a3a20');
      R(-2, -6, 1, 6 + Math.max(0, -step), '#5a3a20');
      R(2, -6, 1, 6 + Math.max(0, step), '#5a3a20');
      R(4, -6, 1, 6 + Math.max(0, -step), '#5a3a20');
      R(-5, -10, 10, 5, '#9a6a40');
      R(-5, -8, 10, 1, '#b8885a');
      R(-6, -10, 2, 2, '#f0ece4');
      R(3, -14, 3, 5, '#9a6a40');
      R(5, -14, 3, 3, '#a87a4a');
      R(7, -13, 1, 1, '#1d1712');
      if (male) {
        R(3, -18, 1, 4, '#d8c8a0');
        R(5, -18, 1, 3, '#d8c8a0');
        R(2, -17, 1, 1, '#d8c8a0');
      } else R(4, -15, 1, 1, '#7a5a3a');
      break;
    }
    case 'goat': {
      R(-3, -5, 1, 5 + Math.max(0, step), '#8e8a80');
      R(-1, -5, 1, 5 + Math.max(0, -step), '#8e8a80');
      R(2, -5, 1, 5 + Math.max(0, step), '#8e8a80');
      R(-4, -9, 8, 5, '#c8c0b0');
      R(-4, -9, 8, 1, '#e0dcd0');
      R(3, -12, 3, 4, '#c8c0b0');
      R(3, -14, 1, 2, '#6a6460');
      R(5, -9, 1, 2, '#e8e4dc');
      R(5, -11, 1, 1, '#1d1712');
      break;
    }
    case 'boar': {
      const shake = a.state === 'prep' ? Math.round(Math.sin(time * 40)) : 0;
      R(-5 + shake, -4, 2, 4 + Math.max(0, step), '#2c2420');
      R(3 + shake, -4, 2, 4 + Math.max(0, -step), '#2c2420');
      R(-6 + shake, -9, 12, 6, '#4a3a30');
      R(-6 + shake, -10, 9, 1, '#3a2c24');
      R(5 + shake, -8, 3, 4, '#5a4a3e');
      R(8 + shake, -6, 1, 2, '#e8e2d4');
      R(6 + shake, -8, 1, 1, a.aggroT > 0 ? '#ff5030' : '#1d1712');
      R(-7 + shake, -8, 1, 2, '#3a2c24');
      break;
    }
    case 'wolf': {
      const lunge = a.attack > 0 ? 2 : 0;
      R(-5, -4, 1, 4 + Math.max(0, step), '#4a4440');
      R(-3, -4, 1, 4 + Math.max(0, -step), '#4a4440');
      R(2, -4, 1, 4 + Math.max(0, step), '#4a4440');
      R(4, -4, 1, 4 + Math.max(0, -step), '#4a4440');
      R(-6, -8, 11, 4, '#6a6460');
      R(-6, -8, 11, 1, '#8a8480');
      R(-9, -8, 3, 1, '#6a6460');
      R(4 + lunge, -10, 4, 4, '#7a7470');
      R(5 + lunge, -12, 1, 2, '#5a5450');
      R(7 + lunge, -10, 1, 1, '#ffd36a');
      R(8 + lunge, -8, 2, 1, '#e8e2d4');
      break;
    }
    case 'pigeon':
    case 'crow':
    case 'gull': {
      const [c0, c1, c2] = def.color;
      if (a.z > 2) {
        // Flug: Flügelschlag
        const up = Math.sin(time * 18 + a.id) > 0;
        R(-2, -1, 4, 2, c0);
        R(2, -2, 1, 1, c2);
        if (up) {
          R(-4, -3, 3, 1, c1);
          R(1, -3, 3, 1, c1);
        } else {
          R(-4, 0, 3, 1, c1);
          R(1, 0, 3, 1, c1);
        }
      } else {
        const peck = a.peck > 0 ? 1 : 0;
        R(-2, -3, 4, 2, c0);
        R(-3, -3, 1, 1, c2);
        R(1, -5 + peck * 2, 2, 2, c1);
        R(3, -4 + peck * 2, 1, 1, '#d8a040');
        R(-1, -1, 1, 1, '#c87050');
        R(1, -1, 1, 1, '#c87050');
      }
      break;
    }
    case 'butterfly': {
      const open = Math.sin(time * 16 + a.id) > 0;
      const col = ['#f0d060', '#e8e8f0', '#e08040', '#a0c0f0'][a.id % 4];
      R(0, -1, 1, 2, '#2a2420');
      if (open) {
        R(-2, -2, 2, 2, col);
        R(1, -2, 2, 2, col);
      } else R(-1, -3, 1, 2, col);
      break;
    }
    case 'dragonfly': {
      R(-2, 0, 5, 1, '#3a7ac0');
      R(2, -1, 1, 1, '#2a5a90');
      const up = Math.sin(time * 30 + a.id) > 0;
      R(-1, up ? -2 : 1, 3, 1, 'rgba(220,240,255,0.7)');
      break;
    }
    case 'fish': {
      // nur beim Sprung sichtbar
      R(-2, -1, 4, 2, '#8aa0b0');
      R(-3, -2, 1, 1, '#6a8090');
      R(-3, 0, 1, 1, '#6a8090');
      R(1, -1, 1, 1, '#1d1712');
      break;
    }
    case 'frog': {
      R(-2, -2, 4, 2, '#4a7a3a');
      R(-2, -3, 1, 1, '#6a9a4a');
      R(1, -3, 1, 1, '#6a9a4a');
      R(-3, -1, 1, 1, '#3a6a2a');
      R(2, -1, 1, 1, '#3a6a2a');
      break;
    }
    case 'owl': {
      const up = Math.sin(time * 6 + a.id) > 0;
      R(-2, -3, 4, 4, '#6a5038');
      R(-1, -2, 1, 1, '#ffd36a');
      R(1, -2, 1, 1, '#ffd36a');
      R(-5, up ? -4 : -1, 3, 2, '#5a4030');
      R(2, up ? -4 : -1, 3, 2, '#5a4030');
      break;
    }
    case 'bat': {
      const up = Math.sin(time * 22 + a.id) > 0;
      R(-1, -1, 2, 2, '#1d1712');
      R(-4, up ? -2 : 0, 3, 1, '#2a2420');
      R(1, up ? -2 : 0, 3, 1, '#2a2420');
      break;
    }
  }
  ctx.globalAlpha = fa;
  if (solid && !sil && !a.dying && a.hp < a.maxHp) {
    const w = 10, top = (def.h || 8) + 4;
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.fillRect(x - w / 2, y - top, w, 2);
    ctx.fillStyle = def.cls === 'game' ? '#d9b25a' : '#d0402a';
    ctx.fillRect(x - w / 2, y - top, Math.max(0, Math.round((w * a.hp) / a.maxHp)), 2);
  }
}

