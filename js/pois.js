// pois.js – Orte in der Wildnis (Points of Interest), deterministisch aus dem Seed in drei Ringen um die Flamme:
// Lager von Überlebenden (Siedler finden), Aschgänger-Lager (Wächter, Belohnung + Bauplan), Verliese (Kisten),
// Schreine (Segen einmal pro Tag), Signalfeuer (decken die Karte auf), umgestürzte Wagen (Beute + Hinterhalt),
// Wanderer auf den Straßen. Je weiter außen, desto gefährlicher und lohnender. Dazu Atmosphäre: Rauchsäulen,
// Krähen über Gefahrenzonen, Lagerfeuer als Lichtpunkte, Meilensteine an den Straßen.

import { TILE, RES } from './config.js';
import { T } from './world.js';
import { mulberry32 } from './util.js';
import { Sprites, drawOutlinedImage, drawCampfire, drawHumanoid, OUTLINE } from './sprites.js';
import { TRAIT_KEYS } from './settlers.js';

/** Tauschangebote des Händlers: give = was er gibt, cost = was er verlangt */
const TRADE_POOL = [
  { give: 'iron', n: 3, cost: { food: 12 } },
  { give: 'cloth', n: 4, cost: { hide: 4 } },
  { give: 'resin', n: 3, cost: { wood: 15 } },
  { give: 'coal', n: 5, cost: { stone: 15 } },
  { give: 'herbs', n: 4, cost: { food: 8 } },
  { give: 'iron', n: 2, cost: { stone: 12, wood: 6 } },
  { give: 'hide', n: 3, cost: { food: 10 } },
  { give: 'bolts', n: 20, cost: { wood: 8, iron: 1 } },
];

export const POI_TYPES = {
  camp: { name: 'Lager von Überlebenden', icon: '⌂', color: '#9fe0ff' },
  enemyCamp: { name: 'Aschgänger-Lager', icon: '☠', color: '#ff6a4a' },
  vault: { name: 'Verlies', icon: '◆', color: '#e0b84a' },
  shrine: { name: 'Schrein', icon: '✚', color: '#9fd0f0' },
  watchtower: { name: 'Signalfeuer', icon: '▲', color: '#ffb040' },
  wreck: { name: 'Umgestürzter Wagen', icon: '✦', color: '#d0b088' },
};
/** Ringe (Abstand zur Flamme in Kacheln): außen gefährlicher und lohnender. */
export const RINGS = [[14, 24], [24, 34], [34, 46]];
/** Baupläne aus besiegten Feindlagern (schalten Gebäude frei, sobald es sie gibt) */
export const BLUEPRINTS = { trap: 'Fallen', firebowl: 'Feuerschale', forge: 'Eisenschmiede' };
const BP_ORDER = ['trap', 'firebowl', 'forge'];

/** Startbelegung der Welt: [Typ, Ring] */
const PLAN = [
  ['camp', 0], ['camp', 0], ['camp', 0], ['camp', 1], ['camp', 1], ['camp', 2], ['camp', 2],
  ['enemyCamp', 1], ['enemyCamp', 1], ['enemyCamp', 2],
  ['vault', 0], ['vault', 1], ['vault', 2],
  ['shrine', 0], ['shrine', 1],
  ['watchtower', 1], ['watchtower', 2], ['watchtower', 2],
  ['wreck', 0], ['wreck', 1], ['wreck', 2],
];

let nextId = 1;

/** Beute je Ring (zur Laufzeit gewürfelt). */
export function ringLoot(ring, mult = 1) {
  const k = (1 + ring * 0.7) * mult;
  const r = (a, b) => Math.round((a + Math.random() * (b - a)) * k);
  const out = { wood: r(2, 5), stone: r(1, 4), food: r(2, 4) };
  // seltenere Funde: je weiter außen, desto mehr
  const extra = (key, chance, a, b) => {
    if (Math.random() < chance) out[key] = (out[key] || 0) + Math.max(1, r(a, b));
  };
  extra('cloth', 0.6, 1, 3);
  extra('iron', 0.35 + ring * 0.2, 1, 2);
  extra('coal', 0.4 + ring * 0.15, 1, 3);
  extra('herbs', 0.4, 1, 2);
  extra('resin', 0.25 + ring * 0.1, 1, 2);
  extra('hide', 0.3, 1, 2);
  return out;
}

export class Pois {
  constructor() {
    this.list = [];
    this.markers = [];     // Meilensteine an den Straßen (nur Deko)
    this.wanderT = 30;
    this.scanT = 0;
    this.version = 0;      // ändert sich, wenn Lichtquellen an/aus gehen
    this.trader = null;    // Händler-Karawane { x, y, home, until, offers }
  }

  byId(id) {
    return this.list.find((p) => p.id === id) || null;
  }

  // ---------------------------------------------------------------- Generierung
  /** Orte deterministisch aus dem Seed anlegen. fresh: Siedler und Wächter erzeugen (nicht beim Laden). */
  generate(game, fresh) {
    const w = game.world;
    this.list.length = 0;
    this.markers.length = 0;
    this.trader = null;
    nextId = 1;
    const rng = mulberry32((w.seed ^ 0x9e3779b9) >>> 0);
    let bp = 0;
    for (const [type, ring] of PLAN) {
      const spot = this.findSpot(w, ring, rng);
      if (!spot) continue;
      const opts = { rng };
      if (type === 'enemyCamp') opts.blueprint = BP_ORDER[bp++ % BP_ORDER.length];
      this.place(game, type, spot[0], spot[1], ring, opts, fresh);
    }
    // Meilensteine entlang der Römerstraßen
    for (const dir of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      for (let d = 14; d < 46; d += 9) {
        const tx = w.cx + dir[0] * d + (dir[1] ? 1 : 0), ty = w.cy + dir[1] * d + (dir[0] ? 1 : 0);
        if (!w.inBounds(tx, ty) || !w.passable(tx, ty, 'friendly') || w.tileAt(tx, ty) === T.SAND) continue;
        this.markers.push({ x: (tx + 0.5) * TILE, y: (ty + 0.8) * TILE });
      }
    }
  }

  /** Freien Platz (5×5) im Ring finden, abseits der Straßen und anderer Orte. */
  findSpot(w, ring, rnd = Math.random) {
    const [lo, hi] = RINGS[ring];
    for (let tries = 0; tries < 300; tries++) {
      const a = rnd() * Math.PI * 2, d = lo + rnd() * (hi - lo);
      const tx = Math.round(w.cx + Math.cos(a) * d), ty = Math.round(w.cy + Math.sin(a) * d);
      if (tx < 4 || ty < 4 || tx > w.w - 5 || ty > w.h - 5) continue;
      let ok = true;
      for (let y = ty - 3; y <= ty + 2 && ok; y++) {
        for (let x = tx - 3; x <= tx + 3 && ok; x++) {
          const t = w.tileAt(x, y);
          if (t === T.WATER || t === T.SHALLOW || x === w.cx || y === w.cy || w.buildingAt[w.idx(x, y)] || w.props[w.idx(x, y)]) ok = false;
        }
      }
      if (!ok) continue;
      if (this.list.some((p) => Math.hypot(p.tx - tx, p.ty - ty) < 10)) continue;
      return [tx, ty];
    }
    return null;
  }

  /** Ort mit Requisiten, Kisten, Feuer, Siedlern bzw. Wächtern anlegen. */
  place(game, type, tx, ty, ring, opts = {}, fresh = true) {
    const w = game.world, rnd = opts.rng || Math.random;
    const p = {
      id: nextId++, type, tx, ty, ring, x: (tx + 0.5) * TILE, y: (ty + 0.5) * TILE,
      discovered: !!opts.discovered, state: 'active', props: [], crates: [], fire: null, chest: null,
      lit: false, lastPray: -1, threat: false, blueprint: opts.blueprint || null, dynamic: !!opts.dynamic, clearedDay: 0,
      level: opts.level || 0,
    };
    // Bäume und Felsen am Ort räumen
    for (let y = ty - 3; y <= ty + 2; y++) for (let x = tx - 3; x <= tx + 3; x++) {
      const n = w.nodeAtTile(x, y);
      if (n && !n.removed) w.removeNode(n);
    }
    const prop = (x0, y0, wt, ht, sprite, ox = 0) => {
      for (let y = y0; y < y0 + ht; y++) for (let x = x0; x < x0 + wt; x++) w.props[w.idx(x, y)] = 1;
      p.props.push({ tx: x0, ty: y0, w: wt, h: ht, sprite, ox });
      w.navDirty = true;
    };
    const fire = (fx, fy, lit) => (p.fire = { x: (fx + 0.5) * TILE, y: (fy + 0.6) * TILE, lit });
    const crate = (cx, cy) => p.crates.push({ x: (cx + 0.5) * TILE, y: (cy + 0.7) * TILE, opened: false });
    switch (type) {
      case 'camp': {
        prop(tx - 2, ty - 2, 2, 2, 'ruinHut');
        p.threat = rnd() < 0.4;
        fire(tx + 1, ty, !p.threat);
        // Zufallswerte immer ziehen (auch beim Laden), damit die Generierung deterministisch bleibt
        const n = opts.settlers ?? (1 + (rnd() < 0.5 ? 1 : 0));
        const traits = [rnd(), rnd()].map((v) => TRAIT_KEYS[Math.floor(v * TRAIT_KEYS.length)]);
        if (fresh) for (let i = 0; i < n; i++) this.spawnWaiting(game, p, (tx + 0.5 + (i ? 2 : 0)) * TILE, (ty + 1.6) * TILE, traits[i]);
        break;
      }
      case 'enemyCamp': {
        prop(tx - 3, ty - 2, 2, 2, 'tentDark');
        prop(tx + 1, ty - 2, 2, 2, 'tentDark');
        fire(tx, ty, true);
        const n = 3 + ring * 2 + Math.floor(rnd() * 2) + (opts.extraGuards || 0);
        if (fresh) this.spawnGuards(game, p, n, ring >= 2 || p.level > 0);
        break;
      }
      case 'vault':
        for (let y = ty - 2; y <= ty + 1; y++) {
          prop(tx - 2, y, 1, 1, 'wallRuin');
          prop(tx + 2, y, 1, 1, 'wallRuin');
        }
        for (let x = tx - 1; x <= tx + 1; x++) prop(x, ty - 2, 1, 1, 'wallRuin');
        crate(tx - 1, ty - 1);
        crate(tx + 1, ty - 1);
        if (rnd() < 0.6) crate(tx, ty);
        if (fresh) this.spawnGuards(game, p, 1 + ring, false);
        break;
      case 'shrine':
        prop(tx, ty - 1, 1, 1, 'shrine');
        break;
      case 'watchtower':
        prop(tx, ty - 1, 1, 1, 'watchtower');
        break;
      case 'wreck':
        prop(tx - 1, ty, 2, 1, 'wagon');
        crate(tx + 1, ty + 1);
        break;
    }
    this.list.push(p);
    this.version++;
    return p;
  }

  spawnWaiting(game, p, x, y, trait) {
    const s = game.settlers.spawn(x, y, trait);
    s.mode = 'waiting';
    s.poi = p;
    s.flip = Math.random() < 0.5;
    return s;
  }

  /** Wächter um das Lager; mit Anführer (Elite) in den äußeren Ringen. */
  spawnGuards(game, p, n, leader) {
    const hpMul = 1 + p.ring * 0.35 + p.level * 0.25, dmgMul = 1 + p.ring * 0.15 + p.level * 0.1;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const type = leader && i === 0 ? 'brute' : i % 3 === 2 && p.ring > 0 ? 'dog' : 'walker';
      const e = game.enemies.spawn(type, p.x + Math.cos(a) * 26, p.y + Math.sin(a) * 18, hpMul, dmgMul);
      e.guard = { poi: p.id, x: p.x, y: p.y, r: 7 * TILE, shade: true };
      if (leader && i === 0) game.enemies.makeElite(e);
    }
  }

  /** Neue Siedlerlager und Feindlager entstehen im Lauf der Zeit (zur Laufzeit gewürfelt). */
  spawnDynamic(game, type, ring, extra = {}) {
    const spot = this.findSpot(game.world, ring);
    if (!spot) return null;
    return this.place(game, type, spot[0], spot[1], ring, { dynamic: true, ...extra }, true);
  }

  // ---------------------------------------------------------------- Ereignisse
  onRecruit(p, s, game) {
    if (!game.settlers.list.some((o) => o.mode === 'waiting' && o.poi === p)) {
      if (p.fire) p.fire.lit = false;
      p.state = 'empty';
      this.version++;
    }
  }

  /** Morgen: neue Lager; befriedete Feindlager bekommen nach einem Tag einen Siedler. */
  onDawn(day, game) {
    if (!this.trader && day >= 2 && day % 3 === 2) this.spawnTrader(game);
    for (const p of this.list) {
      if (p.type === 'enemyCamp' && p.state === 'cleared' && day > p.clearedDay) {
        p.state = 'safe';
        this.spawnWaiting(game, p, p.x + 10, p.y + 12, TRAIT_KEYS[Math.floor(Math.random() * TRAIT_KEYS.length)]);
        if (p.fire) p.fire.lit = true;
        this.version++;
        if (p.discovered) game.ui.toast('Im befriedeten Aschgänger-Lager wartet ein Überlebender.', 'good');
      }
    }
    if (day % 2 === 0) {
      const ring = Math.min(2, Math.floor(Math.random() * 3));
      const p = this.spawnDynamic(game, 'camp', ring, { discovered: true });
      if (p) game.ui.toast(`Rauch im ${this.direction(game, p)}: Überlebende haben ein Lager aufgeschlagen.`, 'good');
    }
    if (day % 3 === 0) {
      const ring = Math.min(2, 1 + Math.floor(day / 9));
      const lvl = Math.floor(day / 3);
      const p = this.spawnDynamic(game, 'enemyCamp', ring, { level: lvl, extraGuards: Math.floor(day / 4), blueprint: BP_ORDER[(day / 3) % BP_ORDER.length] });
      if (p) game.ui.toast(`Späher melden ein neues Aschgänger-Lager im ${this.direction(game, p)}.`, 'warn');
    }
  }

  /** Händler-Karawane: alle drei Tage für anderthalb Tage, bevorzugt in einem befriedeten Feindlager. */
  spawnTrader(game) {
    const safe = this.list.filter((o) => o.type === 'enemyCamp' && (o.state === 'safe' || o.state === 'cleared'));
    let x, y;
    if (safe.length) {
      const o = safe[Math.floor(Math.random() * safe.length)];
      x = o.x + 24;
      y = o.y + 20;
    } else {
      const spot = this.findSpot(game.world, 0);
      if (!spot) return;
      x = (spot[0] + 0.5) * TILE;
      y = (spot[1] + 0.5) * TILE;
    }
    const pool = [...TRADE_POOL].sort(() => Math.random() - 0.5).slice(0, 4).map((o) => ({ ...o, cost: { ...o.cost } }));
    const missing = Object.keys(BLUEPRINTS).filter((k) => !game.progress.blueprints.has(k));
    if (missing.length) {
      const bp = missing[Math.floor(Math.random() * missing.length)];
      pool.push({ blueprint: bp, label: BLUEPRINTS[bp], cost: { wood: 20, stone: 12, hide: 4 } });
    }
    this.trader = { x, y, home: { x, y }, until: game.time + 225 * 1.5, offers: pool, t: 0, flip: false, walk: 0, moving: false, id: 9999 };
    game.ui.toast(`Ein Händler hat im ${this.direction(game, this.trader)} sein Lager aufgeschlagen.`, 'good');
    game.audio.play('trade');
  }

  /** Tauschen: bezahlen aus Lager und Gepäck, Ware ins Gepäck bzw. Bauplan. */
  trade(game, t, o) {
    if (o.sold) return;
    if (!game.buildings.canAfford(game, o.cost)) {
      game.ui.toast('Dafür fehlt dir etwas.', 'warn', 'trade');
      return;
    }
    game.buildings.pay(game, o.cost);
    o.sold = true;
    if (o.blueprint) {
      game.progress.addBlueprint(o.blueprint);
      game.ui.toast(`<b>Bauplan erworben: ${o.label}</b>`, 'unlock');
    } else this.give(game, t.x, t.y, { [o.give]: o.n });
    game.audio.play('trade');
  }

  updateTrader(dt, game) {
    const t = this.trader;
    if (!t) return;
    if (game.time > t.until) {
      if (game.camera.visible(t.x, t.y, 1, 1, 40)) game.ui.toast('Der Händler zieht weiter.', 'info');
      this.trader = null;
      return;
    }
    // gemächlich um den Karren schlendern
    t.t += dt;
    const tx = t.home.x + Math.cos(t.t * 0.25) * 14, ty = t.home.y + 10 + Math.sin(t.t * 0.4) * 4;
    t.moving = Math.hypot(tx - t.x, ty - t.y) > 0.5;
    if (t.moving) t.flip = tx < t.x;
    t.x += (tx - t.x) * Math.min(1, dt * 2);
    t.y += (ty - t.y) * Math.min(1, dt * 2);
    t.walk += dt * 6;
  }

  /** Abenddämmerung: bedrohte Lager werden von Aschgängern heimgesucht. */
  onDusk(day, game) {
    for (const p of this.list) {
      if (p.type !== 'camp' || !p.threat || p.state !== 'active') continue;
      if (!game.settlers.list.some((s) => s.mode === 'waiting' && s.poi === p)) continue;
      const n = 2 + p.ring;
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2;
        const e = game.enemies.spawn('walker', p.x + Math.cos(a) * 80, p.y + Math.sin(a) * 60, 1 + day * 0.05, 1);
        e.guard = { poi: p.id, x: p.x, y: p.y, r: 8 * TILE, shade: false };
        e.raider = true;
      }
    }
  }

  direction(game, p) {
    const c = game.buildings.center, dx = p.x - c.x, dy = p.y - c.y;
    const names = ['Osten', 'Südosten', 'Süden', 'Südwesten', 'Westen', 'Nordwesten', 'Norden', 'Nordosten'];
    return names[(Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) + 8) % 8];
  }

  /** Bietet der Ort noch etwas (Randpfeil, Minikarte hervorgehoben)? */
  interesting(o, game) {
    switch (o.type) {
      case 'camp': return game.settlers.list.some((s) => s.mode === 'waiting' && s.poi === o);
      case 'enemyCamp': return o.state === 'active' || (o.chest && !o.chest.opened) || o.state === 'safe';
      case 'vault':
      case 'wreck': return o.crates.some((c) => !c.opened);
      case 'shrine': return o.lastPray !== game.cycle.day;
      case 'watchtower': return !o.lit;
      default: return false;
    }
  }

  // ---------------------------------------------------------------- Simulation
  update(dt, game) {
    this.updateTrader(dt, game);
    this.scanT -= dt;
    if (this.scanT > 0) return;
    this.scanT = 0.25;
    const w = game.world, p = game.player;
    if (!p.dead) w.reveal(p.tx, p.ty, 9);
    for (const o of this.list) {
      // Entdecken: in Sichtweite oder auf aufgedeckter Karte
      if (!o.discovered && ((!p.dead && Math.hypot(o.x - p.x, o.y - p.y) < 10 * TILE) || w.isExplored(o.tx, o.ty))) {
        o.discovered = true;
        // Nur wichtige Funde melden; die übrigen erscheinen still auf der Minikarte
        if (o.type === 'camp' || o.type === 'enemyCamp') {
          game.ui.toast(`Entdeckt: ${POI_TYPES[o.type].name}`, 'info', 'disc' + o.type);
          game.audio.play('discover', 0.6);
        }
      }
      if ((o.type === 'enemyCamp' || o.type === 'vault') && o.state === 'active') {
        const alive = game.enemies.list.some((e) => !e.dead && e.guard && e.guard.poi === o.id && !e.raider);
        if (!alive) this.clear(o, game);
      }
    }
    this.wanderers(game);
    this.crows(game);
  }

  /** Alle Wächter besiegt: Belohnung, Lager wird zur sicheren Zone. */
  clear(o, game) {
    o.state = 'cleared';
    o.clearedDay = game.cycle.day;
    if (o.type !== 'enemyCamp') return;
    o.chest = { x: o.x, y: o.y + TILE * 1.2, opened: false };
    if (o.fire) o.fire.lit = false;
    this.version++;
    game.stats.camps = (game.stats.camps || 0) + 1;
    game.ui.toast('Das Aschgänger-Lager ist befreit! Eine Truhe wartet auf dich.', 'good', 'campCleared');
    game.audio.play('questDone');
    game.effects.burst(o.x, o.y - 6, { n: 30, color: ['#ffd36a', '#fff3c4', '#e8742a'], speed: 50, life: 1, up: 30 });
  }

  /** Wanderer auf den Straßen: Deko, gelegentlich ein Überlebender, der sich anschließen will. */
  wanderers(game) {
    this.wanderT -= 0.25;
    if (this.wanderT > 0) return;
    this.wanderT = 50 + Math.random() * 60;
    const w = game.world, cam = game.camera;
    for (let tries = 0; tries < 20; tries++) {
      const onX = Math.random() < 0.5, d = (Math.random() < 0.5 ? -1 : 1) * (16 + Math.random() * 26);
      const tx = onX ? Math.round(w.cx + d) : w.cx, ty = onX ? w.cy : Math.round(w.cy + d);
      if (!w.inBounds(tx, ty) || !w.passable(tx, ty, 'friendly')) continue;
      const x = (tx + 0.5) * TILE, y = (ty + 0.5) * TILE;
      if (cam.visible(x, y, 1, 1, 20) || Math.hypot(x - cam.x, y - cam.y) > 40 * TILE) continue;
      const s = game.settlers.spawn(x, y, TRAIT_KEYS[Math.floor(Math.random() * TRAIT_KEYS.length)]);
      s.mode = 'waiting';
      s.wander = { dx: onX ? -Math.sign(d) : 0, dy: onX ? 0 : -Math.sign(d), joinable: Math.random() < 0.35 };
      s.tunic = '#6a5a48';
      return;
    }
  }

  /** Krähenschwärme kreisen über Feindlagern und Wagen in Kameranähe. */
  crows(game) {
    const cam = game.camera, W = game.wildlife;
    for (const o of this.list) {
      if (!((o.type === 'enemyCamp' && o.state === 'active') || (o.type === 'wreck' && o.crates.some((c) => !c.opened)))) continue;
      if (Math.hypot(o.x - cam.x, o.y - cam.y) > 32 * TILE) continue;
      if (W.list.some((a) => a.type === 'crow' && a.persist === o.id)) continue;
      if (W.count((a) => a.def.cls === 'deco') > 26 || W.list.length > 56) return; // Obergrenzen der Wildnis
      for (let i = 0; i < 3; i++) {
        const a = W.spawn('crow', o.x + (Math.random() - 0.5) * 40, o.y - 20);
        a.state = 'circle';
        a.persist = o.id;
        a.home = { x: o.x, y: o.y };
        a.alpha = 0;
      }
    }
  }

  /** Atmosphäre: Rauchsäulen über Lagerfeuern (auch weit entfernt sichtbar). */
  ambient(dt, game) {
    const cam = game.camera, fx = game.effects;
    for (const o of this.list) {
      if (!o.fire || !o.fire.lit) continue;
      if (Math.abs(o.x - cam.x) > cam.viewW || o.y - cam.y > cam.viewH || cam.y - o.y > cam.viewH * 2.2) continue;
      if (Math.random() < dt * 5) {
        fx.burst(o.fire.x + (Math.random() - 0.5) * 3, o.fire.y - 6, { n: 1, color: o.type === 'enemyCamp' ? ['rgba(40,30,30,0.55)', 'rgba(70,50,45,0.5)'] : ['rgba(150,145,140,0.5)', 'rgba(110,105,100,0.45)'], speed: 4, life: 6, up: 14, gravity: -1.5, drag: 0.05, size: 2 });
      }
    }
  }

  /** Lichtquellen (Lagerfeuer, Signalfeuer) für Beleuchtung und Wölfe. */
  lights() {
    const out = [];
    for (const o of this.list) {
      if (o.fire && o.fire.lit) out.push({ x: o.fire.x, y: o.fire.y - 4, r: o.type === 'enemyCamp' ? 46 : 64, k: 0.8, warm: o.type === 'enemyCamp' ? 'red' : 'warm' });
      if (o.type === 'watchtower' && o.lit) out.push({ x: o.x, y: o.y - TILE * 2.4, r: 90, k: 0.9, warm: 'warm' });
    }
    return out;
  }

  // ---------------------------------------------------------------- Interaktion
  provider = (game, out) => {
    const p = game.player, tr = this.trader;
    if (tr && Math.abs(tr.x - p.x) < 34 && Math.abs(tr.y - p.y) < 34) {
      out.push({ kind: 'trader', obj: tr, x: tr.x, y: tr.y, label: 'Mit dem Händler handeln', promptH: 28, reach: 30, prio: -6, eOnly: true,
        hit: (mx, my) => Math.abs(mx - tr.x) < 8 && my < tr.y + 2 && my > tr.y - 22, act: (g) => g.openTrader(tr) });
    }
    for (const o of this.list) {
      if (Math.abs(o.x - p.x) > 5 * TILE || Math.abs(o.y - p.y) > 5 * TILE) continue;
      for (const c of o.crates) {
        if (c.opened) continue;
        out.push({ kind: 'crate', obj: c, x: c.x, y: c.y, label: 'Kiste öffnen', promptH: 12, prio: -3, reach: 24,
          hit: (mx, my) => Math.abs(mx - c.x) < 8 && Math.abs(my - c.y + 4) < 7, act: (g) => this.openCrate(g, o, c) });
      }
      if (o.chest && !o.chest.opened) {
        const c = o.chest;
        out.push({ kind: 'chest', obj: c, x: c.x, y: c.y, label: 'Truhe öffnen', promptH: 13, prio: -5, reach: 24,
          hit: (mx, my) => Math.abs(mx - c.x) < 8 && Math.abs(my - c.y + 4) < 7, act: (g) => this.openChest(g, o) });
      }
      if (o.type === 'shrine') {
        const ready = o.lastPray !== game.cycle.day;
        out.push({ kind: 'shrine', obj: o, x: o.x, y: o.y, label: ready ? 'Am Schrein beten' : 'Schrein (heute schon gesegnet)', promptH: 30, reach: 28,
          hit: (mx, my) => Math.abs(mx - o.x) < 10 && my < o.y + 4 && my > o.y - 32, act: (g) => this.pray(g, o) });
      }
      if (o.type === 'watchtower' && !o.lit) {
        out.push({ kind: 'tower', obj: o, x: o.x, y: o.y, label: 'Signalfeuer entzünden (5 Holz)', promptH: 46, reach: 28,
          hit: (mx, my) => Math.abs(mx - o.x) < 9 && my < o.y + 4 && my > o.y - 48, act: (g) => this.light(g, o) });
      }
    }
  };

  /** Beute ins Inventar, Überschuss als Beutehaufen. */
  give(game, x, y, items) {
    const p = game.player, rest = {};
    let off = 0, left = 0;
    for (const [k, n] of Object.entries(items)) {
      if (!n) continue;
      const fit = n - p.inv.add(k, n);
      if (fit > 0) {
        game.effects.text(x, y - 14 - off, `+${fit} ${RES[k].name}`, RES[k].color);
        off += 7;
      }
      if (n > fit) {
        rest[k] = n - fit;
        left += n - fit;
      }
    }
    if (left) {
      game.loot.drop(x + 8, y + 4, rest);
      game.ui.toast('Nicht alles passt in deine Traglast – der Rest liegt daneben.', 'info', 'full');
    }
  }

  openCrate(game, o, c) {
    if (c.opened) return;
    c.opened = true;
    this.give(game, c.x, c.y, ringLoot(o.ring));
    game.audio.play('crate');
    game.effects.burst(c.x, c.y - 5, { n: 10, color: ['#c09468', '#8a6240', '#ffd36a'], speed: 35, life: 0.6, up: 25 });
    if (o.type === 'wreck' && !o.ambushed) {
      // Hinterhalt: Aschgänger kriechen unter dem Wagen hervor
      o.ambushed = true;
      const n = 2 + o.ring;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const e = game.enemies.spawn(i === 0 && o.ring > 0 ? 'dog' : 'walker', o.x + Math.cos(a) * 34, o.y + Math.sin(a) * 26, 1 + o.ring * 0.3, 1 + o.ring * 0.1);
        e.guard = { poi: o.id, x: o.x, y: o.y, r: 9 * TILE, shade: true };
        e.retarget = 0;
      }
      game.ui.toast('Ein Hinterhalt!', 'danger');
      game.audio.play('alarm', 0.6);
    }
  }

  openChest(game, o) {
    const c = o.chest;
    if (!c || c.opened) return;
    c.opened = true;
    this.give(game, c.x, c.y, ringLoot(o.ring, 2.2));
    if (o.blueprint && game.progress.addBlueprint(o.blueprint)) {
      game.ui.toast(`<b>Bauplan gefunden: ${BLUEPRINTS[o.blueprint]}</b> – wird mit der passenden Flammenstufe baubar.`, 'unlock');
    }
    game.audio.play('unlock');
    game.effects.burst(c.x, c.y - 6, { n: 24, color: ['#ffd36a', '#fff3c4', '#e0b84a'], speed: 45, life: 0.9, up: 30 });
  }

  pray(game, o) {
    const p = game.player;
    if (o.lastPray === game.cycle.day) {
      game.ui.toast('Der Schrein hat dich heute schon gesegnet.', 'info', 'shrine');
      return;
    }
    o.lastPray = game.cycle.day;
    p.hp = p.maxHp;
    const speed = o.id % 2 === 0;
    p.buffs[speed ? 'speed' : 'regen'] = 90;
    game.ui.toast(speed ? 'Segen der Quelle: 90 s schneller unterwegs, Leben aufgefüllt.' : 'Segen der Quelle: 90 s schnellere Energie, Leben aufgefüllt.', 'good');
    game.audio.play('respawn', 0.6);
    game.effects.converge(p.x, p.y - 8, { n: 24, radius: 30, life: 0.6, color: ['#9fd0f0', '#fff3c4'] });
  }

  light(game, o) {
    if (o.lit) return;
    const cost = { wood: 5 };
    if (!game.buildings.canAfford(game, cost)) {
      game.ui.toast('Du brauchst 5 Holz, um das Signalfeuer zu entzünden.', 'warn', 'afford');
      game.audio.play('error');
      return;
    }
    game.buildings.pay(game, cost);
    o.lit = true;
    this.version++;
    game.world.reveal(o.tx, o.ty, 25);
    game.ui.toast('Das Signalfeuer brennt – die Umgebung zeigt sich auf der Karte.', 'good');
    game.audio.play('build');
    game.effects.burst(o.x, o.y - TILE * 2.6, { n: 26, color: ['#ffd36a', '#f0a53a', '#e8742a'], speed: 40, life: 0.9, up: 30 });
  }

  // ---------------------------------------------------------------- Rendering
  collectDrawables(out, ctx, cam, time, glowFor) {
    for (const o of this.list) {
      if (!cam.visible(o.x - 4 * TILE, o.y - 6 * TILE, 8 * TILE, 9 * TILE)) continue;
      for (const pr of o.props) {
        const spr = pr.sprite === 'wallRuin' ? Sprites.wall : Sprites[pr.sprite];
        const x = pr.tx * TILE + (pr.w * TILE - spr.width) / 2, bottom = (pr.ty + pr.h) * TILE + 2;
        const glow = glowFor(o, time);
        out.push({
          y: bottom - 3, occ: [x, bottom - spr.height, spr.width, spr.height],
          draw: () => {
            if (glow > 0) drawOutlinedImage(ctx, spr, Math.round(x), bottom - spr.height, '#ffd36a', glow);
            else ctx.drawImage(spr, Math.round(x), bottom - spr.height);
            if (pr.sprite === 'watchtower' && o.lit) drawCampfire(ctx, o.x, bottom - spr.height + 6, true, time);
          },
        });
      }
      if (o.fire) out.push({ y: o.fire.y - 2, draw: () => drawCampfire(ctx, o.fire.x, o.fire.y, o.fire.lit, time, o.type === 'enemyCamp') });
      for (const c of o.crates) out.push({ y: c.y, draw: () => this.drawBox(ctx, c.opened ? Sprites.crateOpen : Sprites.crate, c, glowFor(c, time)) });
      if (o.chest) out.push({ y: o.chest.y, draw: () => this.drawBox(ctx, o.chest.opened ? Sprites.chestOpen : Sprites.chest, o.chest, glowFor(o.chest, time) || (o.chest.opened ? 0 : 0.35)) });
    }
    for (const m of this.markers) {
      if (cam.visible(m.x - 4, m.y - 14, 8, 14)) out.push({ y: m.y, draw: () => ctx.drawImage(Sprites.milestone, Math.round(m.x - 3), Math.round(m.y - 12)) });
    }
    const tr = this.trader;
    if (tr && cam.visible(tr.home.x - 30, tr.home.y - 40, 60, 60)) {
      const spr = Sprites.tent;
      out.push({ y: tr.home.y - 2, draw: () => ctx.drawImage(spr, Math.round(tr.home.x - spr.width / 2), Math.round(tr.home.y - spr.height)) });
      out.push({ y: tr.y, draw: () => drawHumanoid(ctx, tr.x, tr.y, { flip: tr.flip, walk: tr.moving ? tr.walk : 0, breath: time, tunic: '#6a3a7a', skin: '#c99a6e', hair: '#2a1d14', belt: '#c9a24a', outline: glowFor(tr, time) > 0 ? '#ffd36a' : OUTLINE.settler, item: 'staff', arm: tr.flip ? Math.PI * 0.6 : Math.PI * 0.4 }) });
    }
  }

  drawBox(ctx, spr, c, glow) {
    const x = Math.round(c.x - spr.width / 2), y = Math.round(c.y - spr.height + 2);
    if (glow > 0) drawOutlinedImage(ctx, spr, x, y, '#ffd36a', glow);
    else ctx.drawImage(spr, x, y);
  }

  // ---------------------------------------------------------------- Speichern
  serialize() {
    return this.list.map((o) => ({
      id: o.id, type: o.type, tx: o.tx, ty: o.ty, ring: o.ring, dynamic: o.dynamic, level: o.level, blueprint: o.blueprint,
      discovered: o.discovered, state: o.state, lit: o.lit, lastPray: o.lastPray, clearedDay: o.clearedDay, ambushed: !!o.ambushed,
      threat: o.threat, fire: o.fire ? o.fire.lit : null, crates: o.crates.map((c) => (c.opened ? 1 : 0)), chest: o.chest ? (o.chest.opened ? 1 : 0) : -1,
    }));
  }

  serializeTrader(game) {
    const t = this.trader;
    return t ? { x: t.home.x, y: t.home.y, left: t.until - game.time, offers: t.offers } : null;
  }

  restoreTrader(game, d) {
    if (!d) return;
    this.trader = { x: d.x, y: d.y, home: { x: d.x, y: d.y }, until: game.time + d.left, offers: d.offers, t: 0, flip: false, walk: 0, moving: false, id: 9999 };
  }

  restore(game, data) {
    if (!data) return;
    for (const d of data) {
      let o = this.list.find((p) => p.id === d.id && p.type === d.type && p.tx === d.tx);
      if (!o && d.dynamic) {
        nextId = Math.max(nextId, d.id);
        o = this.place(game, d.type, d.tx, d.ty, d.ring, { dynamic: true, level: d.level, blueprint: d.blueprint }, false);
        o.id = d.id;
        nextId = Math.max(nextId, d.id + 1);
      }
      if (!o) continue;
      Object.assign(o, { discovered: d.discovered, state: d.state, lit: d.lit, lastPray: d.lastPray, clearedDay: d.clearedDay, ambushed: d.ambushed, threat: d.threat });
      if (o.fire && d.fire !== null) o.fire.lit = d.fire;
      d.crates.forEach((v, i) => o.crates[i] && (o.crates[i].opened = !!v));
      if (d.chest >= 0) o.chest = { x: o.x, y: o.y + TILE * 1.2, opened: !!d.chest };
    }
    this.version++;
  }
}

/** Wanderer-Zeichner (Kapuze, Stab) – wird von settlers.js für wandernde Siedler genutzt. */
export function drawWanderer(ctx, s, time, sil) {
  drawHumanoid(ctx, s.x, s.y, {
    flip: s.flip, walk: s.moving ? s.walk : 0, breath: time + s.id, tunic: '#6a5a48', skin: '#c99a6e', hair: '#4a3a2c',
    outline: OUTLINE.settler, silhouette: sil, item: 'staff', arm: s.flip ? Math.PI * 0.62 : Math.PI * 0.38,
  });
}

