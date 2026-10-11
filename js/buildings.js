// buildings.js – Gebäudedefinitionen, Bausystem (Vorschau, Platzierung, Abriss), Belegungsraster,
// Produktion (Brunnen) und Zeichnen. Das Zentrum (Ewige Flamme) ist das Lager der Siedlung.

import { TILE, RES, RES_KEYS, TOWER, REPAIR_RATE, REPAIR_COST, TOWER_COST_FREE, TOWER_COST_STEP, TRAP, FIREBOWL_DPS, FIREBOWL_RADIUS } from './config.js';
import { dist } from './util.js';
import { T } from './world.js';
import { Sprites, drawFlame, drawCrops, drawBallista, drawGate, drawWall, drawCampfire } from './sprites.js';

export const BUILDING_DEFS = {
  center: { name: 'Ewige Flamme', size: 3, hp: 1500, cost: {}, desc: 'Herz der Siedlung und Lager. Fällt sie, ist alles verloren.' },
  hut: { name: 'Hütte', size: 2, hp: 180, cost: { wood: 20, stone: 5 }, key: '1', beds: 4, desc: '+4 Siedlerplätze. Siedler schlafen hier geschützt.' },
  farm: { name: 'Farm', size: 2, hp: 120, cost: { wood: 14, water: 6 }, key: '2', desc: 'Ein Siedler baut hier tagsüber Nahrung an.' },
  well: { name: 'Brunnen', size: 1, hp: 150, cost: { stone: 12, wood: 4 }, key: '3', desc: 'Fördert stetig Wasser ins Lager.' },
  wall: { name: 'Mauer', size: 1, hp: 400, cost: { stone: 3 }, key: '4', desc: 'Hält Gegner auf. Eigene Leute passieren das Tor.' },
  tower: { name: 'Turm', size: 1, hp: 260, cost: { wood: 20, stone: 18 }, key: '5', repairMul: 2, desc: 'Ballista: beschießt Gegner in 6 Feldern Umkreis, verbraucht Bolzen. Ab dem 5. Turm wird jeder weitere teurer.' },
  gate: { name: 'Tor', size: 1, hp: 420, cost: { wood: 8, stone: 6 }, key: '6', desc: 'Eigene Leute gehen hindurch, Gegner nicht. Lässt sich in Mauern setzen.' },
  workbench: { name: 'Werkbank', size: 1, hp: 200, cost: { wood: 24, stone: 8 }, unlock: { level: 2 }, desc: 'Hier stellst du Werkzeuge, Fackeln, Stiefel und Kräuteröl her (E).' },
  storehouse: { name: 'Lagerhaus', size: 2, hp: 260, cost: { wood: 40, stone: 30 }, unlock: { level: 3 }, desc: 'Zweites Lager: Du und deine Siedler liefern auch hier ab – kürzere Wege.' },
  trap: { name: 'Falle', size: 1, hp: 60, cost: { wood: 2, iron: 3 }, unlock: { level: 3, blueprint: 'trap', any: true }, desc: 'Gegner, die darüber laufen, nehmen Schaden und werden langsamer. Hält 5 Auslösungen.' },
  firebowl: { name: 'Feuerschale', size: 1, hp: 150, cost: { stone: 8, iron: 1, coal: 2 }, unlock: { level: 3, blueprint: 'firebowl', any: true }, desc: 'Licht und Brennschaden an Gegnern ringsum. Verbrennt jede Nacht 1 Kohle.' },
  forge: { name: 'Schmiede', size: 2, hp: 320, cost: { wood: 20, stone: 40, iron: 10 }, unlock: { level: 4, blueprint: 'forge' }, desc: 'Eisenschwert und Rüstung schmieden (E).' },
  tower2: { name: 'Wachturm II', size: 1, hp: 420, cost: { wood: 20, stone: 30, iron: 6 }, unlock: { level: 5 }, upgradeOf: 'tower', repairMul: 2, desc: '8 Felder Reichweite, Doppelschuss. Auf einen Turm gesetzt kostet er nur die Differenz.' },
};
/** Reihenfolge aller baubaren Gebäude */
export const BUILDABLE = ['hut', 'farm', 'well', 'storehouse', 'wall', 'gate', 'tower', 'tower2', 'trap', 'firebowl', 'workbench', 'forge'];
/** Kategorien der Bauleiste (B wechselt, 1–9 wählt innerhalb) */
export const BUILD_CATEGORIES = [
  { id: 'home', name: 'Siedlung', types: ['hut', 'farm', 'well', 'storehouse'] },
  { id: 'defense', name: 'Wehr', types: ['wall', 'gate', 'tower', 'tower2', 'trap', 'firebowl'] },
  { id: 'craft', name: 'Handwerk', types: ['workbench', 'forge'] },
];
BUILDING_DEFS.gate.upgradeOf = 'wall';
BUILDING_DEFS.firebowl.light = 90;

/** Erfüllt der Spielstand die Freischaltbedingung (Flammenstufe/Bauplan) eines Gebäudes? */
export function unlockMet(game, type) {
  const u = BUILDING_DEFS[type].unlock;
  if (!u) return true;
  const lvl = !u.level || (game.flame ? game.flame.level : 1) >= u.level;
  const bp = !u.blueprint || game.progress.blueprints.has(u.blueprint);
  return u.any ? (u.level && lvl) || (u.blueprint && bp) : lvl && bp;
}

export const WELL_INTERVAL = 9;    // Sekunden pro Wasser
export const SITE_HP = 0.25;       // Baustellen haben ein Viertel der Lebenspunkte (steigt mit dem Material)
export const CENTER_BEDS = 0;      // Die Flamme selbst bietet keine Wohnplätze (nachts aber Schutz)
export const TERRITORY_CENTER = 12; // Bauradius um die Flamme (Kacheln)
const TERRITORY_BUILDING = 6;      // Bauradius um jedes andere Gebäude

let nextId = 1;

export class Buildings {
  constructor(world) {
    this.world = world;
    this.list = [];
    this.center = null;
    this.selected = null;     // gewählter Bautyp oder 'demolish'
    this.ghost = null;        // { tx, ty, ok, reason }
    this.dragStart = null;    // Startkachel beim Ziehen einer Mauerlinie
    this.rotation = 'auto';   // Mauer/Tor: 'auto' (Ziehrichtung/Nachbarn) oder 0 waagerecht, 1 senkrecht, 2 ↘, 3 ↗
    this.changed = true;      // Belegung geändert (Wegfindung neu berechnen)
    this.version = 0;         // zählt jede Änderung der Gebäudeliste (Caches)
    this.territoryCenter = TERRITORY_CENTER; // Bauradius um die Flamme (wächst mit der Flammenstufe)
  }

  /** Gebäude anlegen und Kacheln belegen (ohne Kostenprüfung). */
  add(type, tx, ty, rot = null) {
    const def = BUILDING_DEFS[type];
    const b = {
      id: nextId++, type, tx, ty, size: def.size,
      hp: def.hp, maxHp: def.hp,
      x: (tx + def.size / 2) * TILE, y: (ty + def.size / 2) * TILE,
      flash: 0, timer: 0, growth: 0, worker: null, aim: -Math.PI / 2, cooldown: 0, recoil: 0,
      sleepers: [], rot: 0, open: 0,
    };
    if (type === 'trap') b.uses = TRAP.uses;
    if (type === 'gate') b.rot = rot ?? this.gateRotation(tx, ty);
    if (type === 'wall') b.rot = rot ?? this.wallRotation(tx, ty);
    this.setTiles(b, b);
    this.list.push(b);
    if (type === 'center') this.center = b;
    this.changed = true;
    this.version++;
    return b;
  }

  setTiles(b, value) {
    this.world.navDirty = true;
    for (let y = b.ty; y < b.ty + b.size; y++) {
      for (let x = b.tx; x < b.tx + b.size; x++) this.world.buildingAt[this.world.idx(x, y)] = value;
    }
  }

  remove(b) {
    this.setTiles(b, null);
    const i = this.list.indexOf(b);
    if (i >= 0) this.list.splice(i, 1);
    b.dead = true;
    this.changed = true;
    this.version++;
  }

  /** Anzahl fertiger Gebäude eines Typs (Baustellen zählen nicht). */
  count(type) {
    return this.list.reduce((n, b) => n + (b.type === type && !b.site ? 1 : 0), 0);
  }
  /** Anzahl einschließlich Baustellen. */
  countAll(type) {
    return this.list.reduce((n, b) => n + (b.type === type ? 1 : 0), 0);
  }
  /** Fertige Gebäude eines Typs. */
  ofType(type) {
    return this.list.filter((b) => b.type === type && !b.site);
  }
  /** Alle offenen Baustellen. */
  get sites() {
    return this.list.filter((b) => b.site);
  }

  /** Abstand eines Punkts zum Rand des Gebäuderechtecks (0 = innerhalb). */
  distTo(b, x, y) {
    const x0 = b.tx * TILE, y0 = b.ty * TILE, x1 = x0 + b.size * TILE, y1 = y0 + b.size * TILE;
    const dx = Math.max(x0 - x, 0, x - x1), dy = Math.max(y0 - y, 0, y - y1);
    return Math.hypot(dx, dy);
  }

  /**
   * Zugangspunkt: nächste begehbare Kachel direkt am Gebäuderand (von (fx,fy) aus gesehen).
   * Siedler arbeiten, liefern und schlafen dort – nie im Gebäude. Liefert [tx,ty] oder null.
   */
  accessPoint(b, fx, fy) {
    const w = this.world;
    let best = null, bd = Infinity;
    for (let y = b.ty - 1; y <= b.ty + b.size; y++) {
      for (let x = b.tx - 1; x <= b.tx + b.size; x++) {
        const edgeX = x === b.tx - 1 || x === b.tx + b.size, edgeY = y === b.ty - 1 || y === b.ty + b.size;
        if (!edgeX && !edgeY) continue;
        if (edgeX && edgeY) continue; // Ecken: diagonal am Gebäude vorbei ist kein echter Zugang
        if (!w.passable(x, y, 'friendly')) continue;
        const d = Math.hypot((x + 0.5) * TILE - fx, (y + 0.5) * TILE - fy);
        if (d < bd) {
          bd = d;
          best = [x, y];
        }
      }
    }
    return best;
  }

  /** Ausrichtung einer einzelnen Mauer nach den Nachbarn (ohne Nachbarn waagerecht). */
  wallRotation(tx, ty) {
    return this.gateRotation(tx, ty);
  }

  /** Mauer-Verbindungen zu den vier Nachbarn (für Zeichnen und Kollision). */
  wallArms(b) {
    const w = this.world, at = (dx, dy) => {
      const o = w.inBounds(b.tx + dx, b.ty + dy) ? w.buildingAt[w.idx(b.tx + dx, b.ty + dy)] : null;
      return !!o && (o.type === 'wall' || o.type === 'gate');
    };
    return { w: at(-1, 0), e: at(1, 0), n: at(0, -1), s: at(0, 1) };
  }

  /** Rotation weiterschalten (R bzw. Mausrad im Baumodus). */
  rotate(dir = 1) {
    const opts = this.selected === 'gate' ? ['auto', 0, 1] : ['auto', 0, 1, 2, 3];
    const i = opts.indexOf(this.rotation);
    this.rotation = opts[(i + dir + opts.length * 2) % opts.length];
  }

  get rotationLabel() {
    return { auto: 'Auto', 0: 'waagerecht', 1: 'senkrecht', 2: 'diagonal ↘', 3: 'diagonal ↗' }[this.rotation];
  }

  /** Tor-Ausrichtung nach den Nachbarmauern: 0 = Mauer läuft waagerecht, 1 = senkrecht. */
  gateRotation(tx, ty) {
    const w = this.world;
    const isWall = (x, y) => {
      const o = w.inBounds(x, y) ? w.buildingAt[w.idx(x, y)] : null;
      return !!o && (o.type === 'wall' || o.type === 'gate');
    };
    if (isWall(tx - 1, ty) || isWall(tx + 1, ty)) return 0;
    if (isWall(tx, ty - 1) || isWall(tx, ty + 1)) return 1;
    return 0;
  }

  // ---------------------------------------------------------------- Kosten
  /** Verfügbar = Lager + Spielerinventar. */
  canAfford(game, cost) {
    return RES_KEYS.every((k) => (cost[k] || 0) <= game.stock[k] + game.player.inv.count(k));
  }

  pay(game, cost) {
    for (const k of RES_KEYS) {
      let need = cost[k] || 0;
      const fromStock = Math.min(need, game.stock[k]);
      game.stock[k] -= fromStock;
      need -= fromStock;
      if (need > 0) game.player.inv.remove(k, need);
    }
  }

  // ---------------------------------------------------------------- Platzierung
  inTerritory(tx, ty, size) {
    const mx = tx + size / 2, my = ty + size / 2;
    for (const b of this.list) {
      const r = b.type === 'center' ? this.territoryCenter : TERRITORY_BUILDING;
      if (Math.hypot(b.tx + b.size / 2 - mx, b.ty + b.size / 2 - my) <= r) return true;
    }
    return false;
  }

  /** Prüft, ob ein Gebäude an (tx,ty) gebaut werden darf. */
  canPlace(type, tx, ty) {
    const size = BUILDING_DEFS[type].size, w = this.world;
    for (let y = ty; y < ty + size; y++) {
      for (let x = tx; x < tx + size; x++) {
        if (!w.inBounds(x, y)) return { ok: false, reason: 'Außerhalb der Karte' };
        const t = w.tileAt(x, y);
        if (t === T.WATER || t === T.SHALLOW) return { ok: false, reason: 'Nicht im Wasser bauen' };
        if (w.props[w.idx(x, y)]) return { ok: false, reason: 'Platz ist belegt' };
        const occ = w.buildingAt[w.idx(x, y)];
        const up = BUILDING_DEFS[type].upgradeOf;
        if (occ && !(up && occ.type === up && !occ.site)) return { ok: false, reason: 'Platz ist belegt' };
        if (occ && type === 'gate' && occ.rot >= 2) return { ok: false, reason: 'Tore nur in geraden Mauern' };
        const n = w.nodeAtTile(x, y);
        if (n && !n.removed && (n.amount > 0 || n.type === 'rock')) return { ok: false, reason: `${n.type === 'tree' ? 'Baum' : n.type === 'rock' ? 'Trümmer' : 'Strauch'} im Weg – erst abbauen` };
      }
    }
    if (!this.inTerritory(tx, ty, size)) return { ok: false, reason: 'Zu weit von der Siedlung entfernt' };
    return { ok: true, reason: '' };
  }

  /** Kosten am Bauplatz: Ein Tor in einer Mauer kostet nur die Differenz. */
  costAt(type, tx, ty) {
    const def = BUILDING_DEFS[type], cost = def.cost;
    const occ = this.world.inBounds(tx, ty) ? this.world.buildingAt[this.world.idx(tx, ty)] : null;
    if (type === 'tower') return this.towerCost();
    if (!def.upgradeOf || !occ || occ.type !== def.upgradeOf) return cost;
    const out = {};
    for (const k of RES_KEYS) if (cost[k]) out[k] = Math.max(0, cost[k] - (BUILDING_DEFS[def.upgradeOf].cost[k] || 0));
    return out;
  }

  /**
   * Türme werden teurer, je mehr schon stehen: ab dem 5. Turm +60 % der Grundkosten pro weiterem Turm
   * (Wartung und Bedienung der Ballisten binden Material) – reiner Turm-Spam lohnt sich nicht.
   */
  towerCost() {
    const n = this.countAll('tower') + this.countAll('tower2');
    const mul = 1 + TOWER_COST_STEP * Math.max(0, n - TOWER_COST_FREE);
    const out = {};
    for (const [k, v] of Object.entries(BUILDING_DEFS.tower.cost)) out[k] = Math.round(v * mul);
    return out;
  }

  /** Lager-Annahmestellen: die Flamme und fertige Lagerhäuser. */
  depots() {
    const out = this.center ? [this.center] : [];
    for (const b of this.list) if (b.type === 'storehouse' && !b.site) out.push(b);
    return out;
  }

  /** Nächste Annahmestelle zu einem Punkt. */
  nearestDepot(x, y) {
    let best = this.center, bd = Infinity;
    for (const b of this.depots()) {
      const d = this.distTo(b, x, y);
      if (d < bd) {
        bd = d;
        best = b;
      }
    }
    return best;
  }

  place(game, type, tx, ty, rot = null) {
    const def = BUILDING_DEFS[type];
    if (!game.progress.has('b:' + type) || !unlockMet(game, type)) {
      game.ui.toast(`${def.name} ist noch nicht freigeschaltet.`, 'warn', 'locked');
      return null;
    }
    const chk = this.canPlace(type, tx, ty);
    if (!chk.ok) {
      game.ui.toast(chk.reason, 'warn', 'place');
      game.audio.play('error');
      return null;
    }
    // Gebaut wird immer: Es entsteht eine Baustelle, die Material braucht
    const cost = this.costAt(type, tx, ty);
    const old = this.world.buildingAt[this.world.idx(tx, ty)];
    if (old) {
      if (rot === null && type === 'gate') rot = old.rot; // Tor übernimmt die Richtung der Mauer
      this.remove(old); // Mauer wird zum Tor, Turm zum Wachturm II
    }
    // Stümpfe/leere Sträucher unter dem Bauplatz verschwinden
    for (let y = ty; y < ty + def.size; y++) {
      for (let x = tx; x < tx + def.size; x++) {
        const n = this.world.nodeAtTile(x, y);
        if (n) this.world.removeNode(n);
      }
    }
    const b = this.add(type, tx, ty, rot);
    const need = {};
    for (const k of RES_KEYS) if (cost[k] > 0) need[k] = cost[k];
    b.site = { need, got: {}, incoming: {}, since: game.time };
    b.hp = Math.max(1, Math.round(b.maxHp * SITE_HP));
    game.effects.burst(b.x, b.y + (def.size * TILE) / 2 - 2, { n: 10, color: ['#b9a98a', '#8e8a80', '#a07c52'], speed: 40, life: 0.5, up: 16 });
    game.audio.play('place');
    if (this.siteMissing(b).length === 0) this.completeSite(game, b);
    return b;
  }

  /** Was fehlt der Baustelle noch? [[res, n], …] (unterwegs befindliches Material zählt nicht als fehlend, wenn incl = true) */
  siteMissing(b, inclIncoming = false) {
    const st = b.site, out = [];
    if (!st) return out;
    for (const [k, n] of Object.entries(st.need)) {
      const have = (st.got[k] || 0) + (inclIncoming ? st.incoming[k] || 0 : 0);
      if (have < n) out.push([k, n - have]);
    }
    return out;
  }

  /** Fortschritt der Baustelle 0..1 (nach Materialmenge). */
  siteProgress(b) {
    const st = b.site;
    if (!st) return 1;
    let need = 0, got = 0;
    for (const [k, n] of Object.entries(st.need)) {
      need += n;
      got += Math.min(n, st.got[k] || 0);
    }
    return need ? got / need : 1;
  }

  /** Material an eine Baustelle liefern; liefert die tatsächlich angenommene Menge. */
  deliverTo(game, b, res, n) {
    const st = b.site;
    if (!st || b.dead || !st.need[res]) return 0;
    const take = Math.min(n, st.need[res] - (st.got[res] || 0));
    if (take <= 0) return 0;
    st.got[res] = (st.got[res] || 0) + take;
    b.hp = Math.min(b.maxHp, b.hp + b.maxHp * 0.75 * (take / Object.values(st.need).reduce((a, v) => a + v, 0)));
    if (game.camera.visible(b.x, b.y, 1, 1, 0)) game.effects.text(b.x, b.y - 10, `+${take} ${RES[res].name}`, RES[res].color);
    if (this.siteMissing(b).length === 0) this.completeSite(game, b);
    return take;
  }

  /**
   * Spieler liefert mit E: zuerst aus dem Inventar, dann – wenn die Baustelle im Kerngebiet der Flamme liegt –
   * direkt aus dem Lager.
   */
  playerDeliver(game, b) {
    const p = game.player;
    let total = 0;
    for (const [k, n] of this.siteMissing(b)) {
      const fromInv = Math.min(n, p.inv.count(k));
      if (fromInv > 0) {
        p.inv.remove(k, fromInv);
        total += this.deliverTo(game, b, k, fromInv);
      }
    }
    const nearFlame = this.center && Math.hypot(b.x - this.center.x, b.y - this.center.y) <= this.territoryCenter * TILE;
    if (nearFlame && b.site) {
      for (const [k, n] of this.siteMissing(b, true)) {
        const fromStock = Math.min(n, Math.floor(game.stock[k] || 0));
        if (fromStock > 0) {
          game.stock[k] -= fromStock;
          total += this.deliverTo(game, b, k, fromStock);
        }
      }
    }
    if (total) game.audio.play('deposit');
    else game.ui.toast(nearFlame ? 'Das fehlende Material liegt weder in deinem Gepäck noch im Lager.' : 'Du trägst nichts, was die Baustelle braucht.', 'warn', 'deliver');
    return total;
  }

  /** Baustelle fertig: Aufbau-Animation, Funken, Gebäude nimmt die Arbeit auf. */
  completeSite(game, b) {
    if (!b.site) return;
    b.site = null;
    b.hp = b.maxHp;
    b.spawn = 0.6;
    b.flash = 0;
    this.changed = true;
    this.version++;
    this.world.navDirty = true;
    const def = BUILDING_DEFS[b.type], s = def.size * TILE;
    game.effects.burst(b.x, b.y + s / 2 - 2, { n: 22, color: ['#b9a98a', '#8e8a80', '#d8d4ca'], speed: 55, life: 0.7, up: 22 });
    game.effects.burst(b.x, b.y - s / 2, { n: 16, color: ['#ffd36a', '#fff3c4', '#f0a53a'], speed: 45, life: 0.8, up: 35 });
    game.audio.play('build');
    game.stats.built++;
    if (game.camera.visible(b.x, b.y, 1, 1, 0)) game.effects.text(b.x, b.y - s / 2 - 10, `${def.name} fertig!`, '#ffd36a');
  }

  /** Alle Baustellen sofort fertigstellen (nur für Tests und Debugging). */
  finishAllSites(game) {
    for (const b of [...this.list]) if (b.site) this.completeSite(game, b);
  }

  /** Interaktions-Provider: Baustellen in Reichweite („Material liefern“). */
  provider = (game, out) => {
    const p = game.player;
    for (const b of this.list) {
      if (!b.site || Math.abs(b.x - p.x) > 3 * TILE || Math.abs(b.y - p.y) > 3 * TILE) continue;
      const r = (b.size * TILE) / 2;
      out.push({
        kind: 'site', obj: b, x: b.x, y: b.y + r - 2, label: `${BUILDING_DEFS[b.type].name}: Material liefern`, promptH: b.size * TILE + 14, prio: -2,
        reach: r + 22,
        hit: (mx, my) => Math.floor(mx / TILE) >= b.tx && Math.floor(mx / TILE) < b.tx + b.size && Math.floor(my / TILE) >= b.ty && Math.floor(my / TILE) < b.ty + b.size,
        act: (g) => this.playerDeliver(g, b),
      });
    }
  };

  /** Abriss mit 50 % Rückerstattung; Baustellen geben 75 % des gelieferten Materials zurück. */
  demolish(game, b) {
    if (b.type === 'center') {
      game.ui.toast('Die Ewige Flamme kann nicht abgerissen werden.', 'warn', 'demo');
      return;
    }
    const def = BUILDING_DEFS[b.type];
    if (b.site) {
      for (const [k, n] of Object.entries(b.site.got)) game.stock[k] += Math.floor(n * 0.75);
      game.ui.toast(`Baustelle (${def.name}) abgerissen – 75 % des Materials zurück ins Lager.`, 'info');
    } else {
      for (const k of RES_KEYS) game.stock[k] += Math.floor((def.cost[k] || 0) / 2);
      game.ui.toast(`${def.name} abgerissen (50 % erstattet).`, 'info');
    }
    game.effects.burst(b.x, b.y, { n: 18, color: ['#8e8a80', '#6b4a2a', '#b9b4a8'], speed: 60, life: 0.7 });
    game.audio.play('demolish');
    this.remove(b);
  }

  /** Bau-Werkzeug wählen (gleicher Typ erneut = abwählen). */
  select(type) {
    this.selected = type && this.selected !== type ? type : null;
    this.ghost = null;
  }

  /** Bauvorschau unter dem Mauszeiger aktualisieren und Klicks verarbeiten (pro Frame). */
  updateBuildMode(game) {
    if (!this.selected) return;
    const { input, camera, player } = game;
    let wx, wy;
    if (input.mouse.inside) {
      const w = camera.screenToWorld(input.mouse.x, input.mouse.y);
      wx = w.x;
      wy = w.y;
    } else {
      wx = player.x + player.aimX * TILE * 2;
      wy = player.y + player.aimY * TILE * 2;
    }
    if (this.selected === 'demolish') {
      const tx = Math.floor(wx / TILE), ty = Math.floor(wy / TILE);
      const b = this.world.inBounds(tx, ty) ? this.world.buildingAt[this.world.idx(tx, ty)] : null;
      this.ghost = { tx, ty, target: b };
      if (input.mouse.clicked && b) this.demolish(game, b);
      return;
    }
    const size = BUILDING_DEFS[this.selected].size;
    const tx = Math.round(wx / TILE - size / 2), ty = Math.round(wy / TILE - size / 2);
    const line = this.selected === 'wall';
    // Mauern: Linie vom Startpunkt (Maustaste gedrückt) bis zum Mauszeiger, beim Loslassen setzen
    if (line && input.mouse.clicked) this.dragStart = [tx, ty];
    if (line && this.dragStart && !input.mouse.down) {
      this.placeTiles(game, this.ghost ? this.ghost.tiles : []);
      this.dragStart = null;
    }
    const from = line && this.dragStart ? this.dragStart : [tx, ty];
    const tiles = this.lineTiles(from[0], from[1], tx, ty).map(([x, y, rot]) => {
      const chk = this.canPlace(this.selected, x, y);
      return { tx: x, ty: y, rot, ok: chk.ok, reason: chk.reason };
    });
    const cost = tiles.reduce((acc, t) => {
      if (t.ok) for (const [k, n] of Object.entries(this.costAt(this.selected, t.tx, t.ty))) acc[k] = (acc[k] || 0) + n;
      return acc;
    }, {});
    const bad = tiles.find((t) => !t.ok);
    this.ghost = { tx, ty, tiles, ok: tiles.some((t) => t.ok), afford: this.canAfford(game, cost), reason: bad && tiles.length === 1 ? bad.reason : '' };
    if (!line && (input.mouse.clicked || input.wasPressed('Enter'))) this.placeTiles(game, tiles);
    if (line && input.wasPressed('Enter')) this.placeTiles(game, tiles);
  }

  /**
   * Kacheln einer Linie (Bresenham, 8er-Nachbarschaft) mit Ausrichtung: feste Rotation oder – bei „Auto“ –
   * aus der Ziehrichtung (waagerecht, senkrecht, diagonal). Für andere Gebäude nur die eine Kachel.
   */
  lineTiles(x0, y0, x1, y1) {
    const sel = this.selected;
    if (sel !== 'wall') return [[x1, y1, sel === 'gate' && this.rotation !== 'auto' ? this.rotation : null]];
    const dx = x1 - x0, dy = y1 - y0, adx = Math.abs(dx), ady = Math.abs(dy);
    let rot = this.rotation;
    if (rot === 'auto') {
      if (!adx && !ady) return [[x1, y1, null]]; // Einzelstück: nach den Nachbarn ausrichten
      rot = adx >= ady * 2 ? 0 : ady >= adx * 2 ? 1 : dx * dy > 0 ? 2 : 3;
    }
    const out = [];
    if (rot === 0) {
      const sx = Math.sign(dx) || 1;
      for (let i = 0; i <= adx; i++) out.push([x0 + sx * i, y0, 0]);
    } else if (rot === 1) {
      const sy = Math.sign(dy) || 1;
      for (let i = 0; i <= ady; i++) out.push([x0, y0 + sy * i, 1]);
    } else {
      // exakte 45°-Diagonale: ↘ läuft (+1,+1), ↗ läuft (+1,−1) bzw. jeweils rückwärts
      const k = Math.max(adx, ady);
      const sx = rot === 2 ? Math.sign(dx) || Math.sign(dy) || 1 : Math.sign(dx) || -Math.sign(dy) || 1;
      const sy = rot === 2 ? sx : -sx;
      for (let i = 0; i <= k; i++) out.push([x0 + sx * i, y0 + sy * i, rot]);
    }
    return out;
  }

  /** Alle gültigen Kacheln einer Vorschau als Baustellen setzen. */
  placeTiles(game, tiles) {
    let placed = 0;
    for (const t of tiles) {
      if (!this.canPlace(this.selected, t.tx, t.ty).ok) continue;
      if (this.place(game, this.selected, t.tx, t.ty, t.rot)) placed++;
    }
    if (!placed && tiles.length) {
      const bad = tiles.find((t) => !t.ok);
      if (bad) game.ui.toast(bad.reason, 'warn', 'place');
      game.audio.play('error');
    }
    return placed;
  }

  // ---------------------------------------------------------------- Simulation
  update(dt, game) {
    const sunny = game.cycle.isSunny;
    for (const b of this.list) {
      if (b.flash > 0) b.flash -= dt;
      if (b.pulse > 0) b.pulse = Math.max(0, b.pulse - dt * 1.5);
      if (b.spawn > 0) b.spawn -= dt;
      if (b.site) continue; // Baustellen arbeiten nicht und werden nicht repariert
      // Siedler reparieren tagsüber beschädigte Gebäude – das kostet anteilig Baumaterial aus dem Lager
      if (sunny && b.hp < b.maxHp) this.repair(b, dt, game);
      if (b.type === 'tower' || b.type === 'tower2') this.updateTower(b, dt, game);
      if (b.type === 'firebowl' && b.lit && !game.cycle.isSunny) this.updateFirebowl(b, dt, game);
      if (b.type === 'gate') this.updateGate(b, dt, game);
      if (b.type === 'well') {
        b.timer += dt;
        if (b.timer >= WELL_INTERVAL) {
          b.timer -= WELL_INTERVAL;
          game.stock.water += 1;
          if (game.camera.visible(b.x, b.y, 1, 1, 0)) game.effects.text(b.x, b.y - 18, `+1 ${RES.water.name}`, RES.water.color);
        }
      }
    }
  }

  /**
   * Reparatur am Tag: je Prozent wiederhergestellter LP REPAIR_COST Prozent der Baukosten (Flamme kostenlos).
   * Fehlt Material im Lager, ruht die Reparatur.
   */
  repair(b, dt, game) {
    const heal = Math.min(b.maxHp - b.hp, b.maxHp * REPAIR_RATE * (b.type === 'center' ? 0.5 : 1) * dt);
    if (b.type !== 'center') {
      const def = BUILDING_DEFS[b.type], cost = def.cost, frac = (heal / b.maxHp) * REPAIR_COST * (def.repairMul || 1);
      b.repairDebt = b.repairDebt || {};
      for (const [k, n] of Object.entries(cost)) {
        b.repairDebt[k] = (b.repairDebt[k] || 0) + n * frac;
        if (b.repairDebt[k] >= 1) {
          if (game.stock[k] < 1) {
            b.repairDebt[k] -= n * frac;
            return; // kein Material: keine Reparatur
          }
          game.stock[k] -= 1;
          b.repairDebt[k] -= 1;
        }
      }
    }
    b.hp += heal;
  }

  /** Tor öffnet sich, wenn eigene Leute in der Nähe sind (rein optisch – passierbar ist es für sie immer). */
  updateGate(b, dt, game) {
    const near = (u) => Math.abs(u.x - b.x) < 18 && Math.abs(u.y - b.y) < 18;
    let want = !game.player.dead && near(game.player);
    if (!want) for (const s of game.settlers.list) if (!s.hidden && near(s)) { want = true; break; }
    const prev = b.open;
    b.open = Math.max(0, Math.min(1, b.open + (want ? dt : -dt) * 5));
    if (prev === 0 && b.open > 0 && game.camera.visible(b.x, b.y, 1, 1, 0)) game.audio.play('gate', 0.35);
  }

  /** Feuerschale: Gegner in der Nähe nehmen Brennschaden. */
  updateFirebowl(b, dt, game) {
    const r = FIREBOWL_RADIUS;
    for (const e of game.enemies.list) {
      if (e.dead || Math.abs(e.x - b.x) > r || Math.abs(e.y - b.y) > r || Math.hypot(e.x - b.x, e.y - b.y) > r) continue;
      e.hp -= FIREBOWL_DPS * dt;
      if (Math.random() < dt * 5) game.effects.burst(e.x, e.y - 8, { n: 1, color: ['#ffb040', '#e8742a'], speed: 10, life: 0.5, up: 20, gravity: -20 });
      if (e.hp <= 0) game.enemies.kill(e, game, false);
    }
  }

  /** Abenddämmerung: Feuerschalen verbrennen je 1 Kohle; ohne Kohle bleiben sie dunkel. */
  lightFirebowls(game) {
    let dark = 0;
    for (const b of this.list) {
      if (b.type !== 'firebowl' || b.site) continue;
      b.lit = game.stock.coal >= 1;
      if (b.lit) game.stock.coal -= 1;
      else dark++;
    }
    if (dark) game.ui.toast(`${dark} Feuerschale(n) bleiben ohne Kohle dunkel.`, 'warn', 'bowl');
    this.version++;
  }

  /** Ballistenturm: nächsten Gegner in Reichweite anvisieren und Bolzen feuern. */
  updateTower(b, dt, game) {
    b.cooldown -= dt;
    if (b.recoil > 0) b.recoil = Math.max(0, b.recoil - dt * 20);
    if (b.cooldown > 0) return;
    const two = b.type === 'tower2';
    let best = null, bd = two ? TOWER.range * 8 / 6 : TOWER.range;
    for (const e of game.enemies.list) {
      if (e.dead) continue;
      const d = dist(b.x, b.y, e.x, e.y);
      if (d < bd) {
        bd = d;
        best = e;
      }
    }
    if (!best) {
      b.cooldown = 0.2;
      return;
    }
    // Jeder Schuss kostet einen Bolzen aus dem Lager
    if (game.stock.bolts < 1) {
      b.noAmmo = true;
      b.cooldown = 0.5;
      if (game.time - (game.lastAmmoWarn || -99) > 30) {
        game.lastAmmoWarn = game.time;
        game.ui.toast('Den Türmen gehen die Bolzen aus! Stelle an der Flamme neue her (E).', 'danger', 'ammo');
      }
      return;
    }
    b.noAmmo = false;
    game.stock.bolts -= 1;
    b.aim = Math.atan2(best.y - 6 - (b.y - 22), best.x - b.x);
    game.combat.fireBolt(b.x, b.y - 22, best, TOWER.damage, TOWER.boltSpeed);
    // Wachturm II: zweiter Bolzen (auf einen anderen Gegner, falls vorhanden)
    if (two && game.stock.bolts >= 1) {
      game.stock.bolts -= 1;
      const other = game.enemies.list.find((e) => !e.dead && e !== best && dist(b.x, b.y, e.x, e.y) < bd + 40) || best;
      game.combat.fireBolt(b.x + 3, b.y - 24, other, TOWER.damage, TOWER.boltSpeed);
    }
    b.cooldown = TOWER.cooldown;
    b.recoil = 3;
    if (game.camera.visible(b.x, b.y, 1, 1, 64)) game.audio.play('bolt', 0.4);
  }

  // ---------------------------------------------------------------- Rendering
  /** Zeichenaufträge (nach y sortierbar) für sichtbare Gebäude sammeln. */
  collectDrawables(out, ctx, cam, time) {
    for (const b of this.list) {
      const x = b.tx * TILE, y = b.ty * TILE, s = b.size * TILE;
      if (!cam.visible(x, y - 40, s, s + 40)) continue;
      // Farmen und Fallen liegen flach am Boden und werden zuerst gezeichnet
      const flat = b.type === 'farm' || b.type === 'trap';
      const h = flat ? 0 : this.spriteHeight(b);
      out.push({ y: flat ? y : y + s - 2, draw: () => this.drawBuilding(ctx, b, time), occ: flat ? null : [x - 2, y + s - h, s + 4, h] });
    }
  }

  /** Sichtbare Höhe des Gebäude-Sprites über der Unterkante (für Verdeckung). */
  spriteHeight(b) {
    switch (b.type) {
      case 'center': return Sprites.center.height - 6 + 16;
      case 'hut': return Sprites.hut.height - 2;
      case 'well': return Sprites.well.height - 2;
      case 'wall': return b.rot >= 2 ? Sprites.wallD[0].height : Sprites.wallV.height - 2;
      case 'tower': return Sprites.tower.height - 2;
      case 'gate': return 24;
      case 'workbench': return Sprites.workbench.height;
      case 'storehouse': return Sprites.storehouse.height - 2;
      case 'forge': return Sprites.forge.height - 2;
      case 'tower2': return Sprites.tower2.height - 2;
      case 'firebowl': return Sprites.firebowl.height;
      case 'trap': return 4;
      default: return b.size * TILE;
    }
  }

  drawBuilding(ctx, b, time) {
    const x = b.tx * TILE, y = b.ty * TILE, s = b.size * TILE;
    const bottom = y + s;
    if (b.site) {
      this.drawSite(ctx, b, time);
      return;
    }
    // Aufbau-Animation: leicht von unten einfedern
    if (b.spawn > 0) {
      ctx.save();
      const k = Math.max(0, 1 - b.spawn / 0.6);
      ctx.translate(x + s / 2, bottom);
      ctx.scale(1, 0.4 + 0.6 * k);
      ctx.translate(-(x + s / 2), -bottom);
    }
    switch (b.type) {
      case 'center': {
        const spr = Sprites.center;
        ctx.drawImage(spr, Math.round(x + s / 2 - spr.width / 2), bottom - spr.height + 6);
        if (b.hp > 0) drawFlame(ctx, x + s / 2, bottom - 32, 7 * (1 + (b.pulse || 0) * 0.7), time);
        else {
          // Erloschen: nur noch Rauch
          ctx.fillStyle = 'rgba(90,84,80,0.6)';
          for (let i = 0; i < 4; i++) ctx.fillRect(Math.round(x + s / 2 - 2 + Math.sin(time * 2 + i) * 2), Math.round(bottom - 34 - i * 4 - ((time * 8) % 4)), 4, 3);
        }
        break;
      }
      case 'hut':
        ctx.drawImage(Sprites.hut, x, bottom - Sprites.hut.height + 2);
        break;
      case 'farm':
        ctx.drawImage(Sprites.farm, x, y);
        drawCrops(ctx, x, y, b.growth);
        break;
      case 'well':
        ctx.drawImage(Sprites.well, x, bottom - Sprites.well.height + 2);
        break;
      case 'wall':
        drawWall(ctx, x, bottom, b.rot || 0, b.ghostArms || this.wallArms(b));
        break;
      case 'tower':
        ctx.drawImage(Sprites.tower, x - 2, bottom - Sprites.tower.height + 2);
        drawBallista(ctx, x + 8, bottom - 30, b.aim, b.recoil);
        if (b.noAmmo && Math.sin(time * 6) > 0) {
          // keine Munition: rotes Zeichen über dem Turm
          ctx.fillStyle = '#1d1712';
          ctx.fillRect(x + 5, bottom - 50, 6, 8);
          ctx.fillStyle = '#e04030';
          ctx.fillRect(x + 7, bottom - 49, 2, 4);
          ctx.fillRect(x + 7, bottom - 44, 2, 1);
        }
        break;
      case 'gate':
        drawGate(ctx, x, bottom, b.rot, b.open);
        break;
      case 'workbench':
        ctx.drawImage(Sprites.workbench, x - 1, bottom - Sprites.workbench.height + 1);
        break;
      case 'storehouse':
        ctx.drawImage(Sprites.storehouse, x, bottom - Sprites.storehouse.height + 2);
        break;
      case 'forge':
        ctx.drawImage(Sprites.forge, x, bottom - Sprites.forge.height + 2);
        if (Math.sin(time * 3 + b.id) > 0.3) {
          ctx.fillStyle = '#ffb040';
          ctx.fillRect(x + 7, bottom - 9, 3, 2);
        }
        break;
      case 'tower2':
        ctx.drawImage(Sprites.tower2, x - 3, bottom - Sprites.tower2.height + 2);
        drawBallista(ctx, x + 8, bottom - 40, b.aim, b.recoil);
        if (b.noAmmo && Math.sin(time * 6) > 0) {
          ctx.fillStyle = '#1d1712';
          ctx.fillRect(x + 5, bottom - 60, 6, 8);
          ctx.fillStyle = '#e04030';
          ctx.fillRect(x + 7, bottom - 59, 2, 4);
          ctx.fillRect(x + 7, bottom - 54, 2, 1);
        }
        break;
      case 'firebowl':
        ctx.drawImage(Sprites.firebowl, x + 2, bottom - Sprites.firebowl.height + 1);
        if (b.lit !== false) drawFlame(ctx, x + 8, bottom - Sprites.firebowl.height + 3, 3, time + b.id);
        break;
      case 'trap':
        ctx.drawImage(b.uses > 0 || b.uses === undefined ? Sprites.trap : Sprites.trapSprung, x + 1, bottom - Sprites.trap.height - 1);
        break;
    }
    if (b.spawn > 0) ctx.restore();
    if (b.flash > 0) {
      // Trefferblitz
      ctx.fillStyle = 'rgba(255,80,60,0.35)';
      ctx.fillRect(x, y - 6, s, s + 6);
    }
    if (b.hp < b.maxHp) this.drawHpBar(ctx, x, y - (b.type === 'tower' ? 26 : b.type === 'center' ? 34 : 12), s, b.hp / b.maxHp);
  }

  /** Baustelle: Grundriss, halb durchsichtiges Gebäude (wächst mit dem Material), Holzgerüst, Fortschritt. */
  drawSite(ctx, b, time) {
    const x = b.tx * TILE, y = b.ty * TILE, s = b.size * TILE, bottom = y + s;
    const k = this.siteProgress(b);
    ctx.fillStyle = 'rgba(70,52,34,0.55)';
    ctx.fillRect(x + 1, y + 1, s - 2, s - 2);
    // Geist des fertigen Gebäudes, von unten her „aufgebaut“
    const h = this.spriteHeight(b) + 4;
    const shown = Math.max(2, Math.round(h * (0.15 + 0.85 * k)));
    ctx.save();
    ctx.beginPath();
    ctx.rect(x - 4, bottom - shown, s + 8, shown + 4);
    ctx.clip();
    ctx.globalAlpha = 0.55;
    const fake = { ...b, site: null, spawn: 0, hp: 1, maxHp: 1, flash: 0, growth: 0, open: 0 };
    this.drawBuilding(ctx, fake, time);
    ctx.restore();
    ctx.globalAlpha = 1;
    // Gerüst: Pfosten an den Ecken, Querbretter
    const top = bottom - Math.max(10, Math.round(h * 0.9));
    ctx.fillStyle = '#7a5233';
    for (const px of [x + 1, x + s - 3]) ctx.fillRect(px, top, 2, bottom - top);
    if (s > TILE) ctx.fillRect(x + s / 2 - 1, top + 4, 2, bottom - top - 4);
    ctx.fillStyle = '#a07c52';
    for (let py = bottom - 6; py > top; py -= 7) ctx.fillRect(x, py, s, 1);
    ctx.fillStyle = '#5b3f2a';
    ctx.fillRect(x + 2, top + 2, s - 4, 1);
    // Fortschritt
    const by = top - 5;
    ctx.fillStyle = 'rgba(0,0,0,0.75)';
    ctx.fillRect(x, by, s, 3);
    ctx.fillStyle = '#d9b25a';
    ctx.fillRect(x + 1, by + 1, Math.round((s - 2) * k), 1);
    if (b.flash > 0) {
      ctx.fillStyle = 'rgba(255,80,60,0.35)';
      ctx.fillRect(x, top, s, bottom - top);
    }
  }

  /** Fehlende Materialien über Baustellen (Bildschirmkoordinaten, nur in der Nähe bzw. unter dem Mauszeiger). */
  drawSiteLabels(ctx, game) {
    const cam = game.camera, p = game.player, dpr = window.devicePixelRatio || 1;
    let hover = null;
    if (game.input.mouse.inside) {
      const w = cam.screenToWorld(game.input.mouse.x, game.input.mouse.y);
      const tx = Math.floor(w.x / TILE), ty = Math.floor(w.y / TILE);
      hover = this.world.inBounds(tx, ty) ? this.world.buildingAt[this.world.idx(tx, ty)] : null;
    }
    ctx.save();
    ctx.font = `bold ${Math.round(11 * dpr)}px Georgia, serif`;
    ctx.textBaseline = 'middle';
    for (const b of this.list) {
      if (!b.site || (b !== hover && Math.hypot(b.x - p.x, b.y - p.y) > 4.5 * TILE)) continue;
      if (!cam.visible(b.x - 20, b.y - 60, 40, 60)) continue;
      const miss = this.siteMissing(b);
      if (!miss.length) continue;
      const top = b.y + (b.size * TILE) / 2 - this.spriteHeight(b) - 20;
      const sc = cam.worldToScreen(b.x, top);
      const icon = 13 * dpr, gap = 4 * dpr;
      const parts = miss.map(([k, n]) => [k, String(n), ctx.measureText(String(n)).width]);
      const width = parts.reduce((a, [, , tw]) => a + icon + tw + gap * 2, 0);
      let px = sc.x - width / 2;
      ctx.fillStyle = 'rgba(20,14,10,0.85)';
      ctx.fillRect(px - 4 * dpr, sc.y - 10 * dpr, width + 8 * dpr, 20 * dpr);
      ctx.strokeStyle = 'rgba(217,178,90,0.8)';
      ctx.lineWidth = dpr;
      ctx.strokeRect(px - 4 * dpr + 0.5, sc.y - 10 * dpr + 0.5, width + 8 * dpr, 20 * dpr);
      for (const [k, txt, tw] of parts) {
        ctx.drawImage(Sprites.icons[k], Math.round(px), Math.round(sc.y - icon / 2), icon, icon);
        px += icon + gap;
        ctx.fillStyle = '#f3e6c4';
        ctx.fillText(txt, px, sc.y + dpr);
        px += tw + gap;
      }
    }
    ctx.restore();
  }

  drawHpBar(ctx, x, y, w, k) {
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.fillRect(x, y, w, 3);
    ctx.fillStyle = k > 0.5 ? '#6fbf5a' : k > 0.25 ? '#e0a030' : '#d0402a';
    ctx.fillRect(x + 1, y + 1, Math.max(0, Math.round((w - 2) * k)), 1);
  }

  /** Bauvorschau (halbtransparent, grün/rot) bzw. Abriss-Markierung. */
  drawGhost(ctx, time) {
    const g = this.ghost;
    if (!g || !this.selected) return;
    if (this.selected === 'demolish') {
      if (g.target && g.target.type !== 'center') {
        const b = g.target;
        ctx.fillStyle = `rgba(208,64,42,${0.35 + Math.sin(time * 8) * 0.1})`;
        ctx.fillRect(b.tx * TILE, b.ty * TILE, b.size * TILE, b.size * TILE);
      } else {
        ctx.strokeStyle = 'rgba(208,64,42,0.8)';
        ctx.lineWidth = 1;
        ctx.strokeRect(g.tx * TILE + 0.5, g.ty * TILE + 0.5, TILE - 1, TILE - 1);
      }
      return;
    }
    const def = BUILDING_DEFS[this.selected];
    const set = new Set(g.tiles.map((t) => t.ty * this.world.w + t.tx));
    for (const t of g.tiles) {
      const occ = this.world.inBounds(t.tx, t.ty) ? this.world.buildingAt[this.world.idx(t.tx, t.ty)] : null;
      let rot = t.rot ?? (this.selected === 'gate' ? (occ && occ.type === 'wall' ? occ.rot : this.gateRotation(t.tx, t.ty)) : this.wallRotation(t.tx, t.ty));
      // Arme der Vorschau: zu bestehenden Mauern und zu den Nachbarn in der gezogenen Linie
      const inLine = (dx, dy) => set.has((t.ty + dy) * this.world.w + t.tx + dx);
      const near = this.wallArms({ tx: t.tx, ty: t.ty });
      const arms = { w: near.w || inLine(-1, 0), e: near.e || inLine(1, 0), n: near.n || inLine(0, -1), s: near.s || inLine(0, 1) };
      const fake = { tx: t.tx, ty: t.ty, x: (t.tx + def.size / 2) * TILE, y: (t.ty + def.size / 2) * TILE, type: this.selected, size: def.size, hp: 1, maxHp: 1, growth: 0, aim: -Math.PI / 2, recoil: 0, open: 0, rot, ghostArms: arms };
      ctx.globalAlpha = 0.6;
      this.drawBuilding(ctx, fake, time);
      ctx.globalAlpha = 1;
      ctx.fillStyle = t.ok ? (g.afford ? 'rgba(111,191,90,0.35)' : 'rgba(217,178,90,0.35)') : 'rgba(208,64,42,0.4)';
      ctx.fillRect(t.tx * TILE, t.ty * TILE, def.size * TILE, def.size * TILE);
    }
    if (this.selected === 'tower') {
      // Reichweite anzeigen
      ctx.strokeStyle = 'rgba(255,230,160,0.5)';
      ctx.beginPath();
      ctx.arc((g.tx + 0.5) * TILE, (g.ty + 0.5) * TILE, 6 * TILE, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
}
