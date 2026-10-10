// settlers.js – Siedler: Bedürfnisse (Hunger/Durst), Jobvergabe (Farm/Sammeln), Aufgaben-Zustandsautomat,
// Wegfolgen und Zeichnen. Siedler arbeiten vollautomatisch; der Spieler setzt nur den Arbeitsschwerpunkt.

import { TILE, RES, GATHER_KEYS, SETTLER, FARM_GROW_TIME, FARM_YIELD } from './config.js';
import { NODE_DEFS, T } from './world.js';
import { CENTER_BEDS, BUILDING_DEFS, TERRITORY_CENTER } from './buildings.js';
import { drawHumanoid, OUTLINE } from './sprites.js';
import { drawWanderer } from './pois.js';
import { dist, hash2 } from './util.js';

const NAMES = ['Marcus', 'Livia', 'Gaius', 'Iulia', 'Titus', 'Octavia', 'Lucius', 'Cornelia', 'Quintus', 'Aurelia', 'Decimus', 'Flavia',
  'Sextus', 'Claudia', 'Publius', 'Valeria', 'Servius', 'Tullia', 'Appius', 'Fabia', 'Gnaeus', 'Antonia', 'Manius', 'Hortensia',
  'Aulus', 'Sabina', 'Spurius', 'Domitia', 'Tiberius', 'Lucretia'];
const TUNICS = ['#b8a074', '#8a6a4a', '#7a8a5a', '#6a7a8a', '#9a7a5a', '#a08a6a', '#7a5a6a'];
const HAIR = ['#2a1d14', '#4a3020', '#6b4a2a', '#1d1712', '#8a6a3a', '#5a5048'];

/** Ressource → Knotentyp für Sammelaufträge */
const RES_NODE = { wood: 'tree', stone: 'rock', food: 'bush' };

/** Eigenschaften gefundener Siedler (kleiner Bonus) */
export const TRAITS = {
  farmer: { label: 'Bauer', desc: 'Farmen wachsen 35 % schneller' },
  lumberjack: { label: 'Holzfäller', desc: 'fällt Bäume 35 % schneller' },
  mason: { label: 'Steinmetz', desc: 'bricht Stein 35 % schneller' },
  builder: { label: 'Baumeister', desc: 'liefert Baumaterial schneller an' },
  runner: { label: 'Läufer', desc: 'läuft 20 % schneller' },
  tough: { label: 'Zäh', desc: '50 % mehr Lebenspunkte' },
  hunter: { label: 'Jäger', desc: 'sammelt Nahrung 35 % schneller' },
  none: { label: 'Arbeiter', desc: 'ohne besondere Gabe' },
};
export const TRAIT_KEYS = Object.keys(TRAITS);

/** Arbeitsschwerpunkte (UI) */
export const FOCI = [
  { id: 'auto', name: 'Auto' },
  { id: 'wood', name: RES.wood.name },
  { id: 'stone', name: RES.stone.name },
  { id: 'food', name: RES.food.name },
  { id: 'water', name: RES.water.name },
];

let nextId = 1;

export class Settler {
  constructor(x, y, seedIdx, trait = 'none') {
    this.id = nextId++;
    this.name = NAMES[seedIdx % NAMES.length];
    this.trait = trait;
    this.mode = null;        // null = gehört zur Siedlung, 'waiting' = wartet im Lager, 'follow' = folgt dem Spieler
    this.x = x;
    this.y = y;
    this.r = 3;
    this.hp = SETTLER.hp;
    this.maxHp = SETTLER.hp;
    this.hunger = 100;       // 100 = satt
    this.thirst = 100;
    this.job = null;         // 'farm' oder null (Sammler)
    this.farm = null;
    this.task = null;        // aktuelle Aufgabe
    this.path = null;
    this.pathI = 0;
    this.carry = null;       // { res, n }
    this.timer = 0;
    this.flip = false;
    this.walk = 0;
    this.moving = false;
    this.stuck = 0;
    this.hurt = 0;
    this.tunic = TUNICS[(hash2(this.id, 3) * TUNICS.length) | 0];
    this.hair = HAIR[(hash2(this.id, 7) * HAIR.length) | 0];
    if (trait === 'tough') this.hp = this.maxHp = SETTLER.hp * 1.5;
  }

  get speed() {
    return SETTLER.speed * (this.trait === 'runner' ? 1.2 : 1);
  }

  /** Arbeitsdauer je Einheit an einem Knotentyp (Traits beschleunigen). */
  workTime(type) {
    const fast = (this.trait === 'lumberjack' && type === 'tree') || (this.trait === 'mason' && type === 'rock') || (this.trait === 'hunter' && type === 'bush');
    return SETTLER.workTime / (fast ? 1.35 : 1);
  }

  get tx() {
    return Math.floor(this.x / TILE);
  }
  get ty() {
    return Math.floor(this.y / TILE);
  }
}

export class Settlers {
  constructor() {
    this.list = [];
    this.focus = 'auto';
    this.jobTimer = 0;
    this.claims = new Map();     // Knoten-ID → Anzahl Siedler, die ihn bearbeiten
    this.nameIdx = 0;
    this.starveWarn = 0;
  }

  spawn(x, y, trait = 'none') {
    const s = new Settler(x, y, this.nameIdx++, trait);
    this.list.push(s);
    return s;
  }

  /** Siedler, die zur Siedlung gehören (ohne Wartende und Folgende). */
  get colony() {
    return this.list.filter((s) => !s.mode);
  }

  /** Wohnplätze: jede fertige Hütte bietet BUILDING_DEFS.hut.beds Plätze. */
  capacity(game) {
    return CENTER_BEDS + game.buildings.list.filter((b) => b.type === 'hut' && !b.site).length * BUILDING_DEFS.hut.beds;
  }

  /** Freie Plätze für neue Siedler (Folgende sind schon eingeplant). */
  freeBeds(game) {
    return this.capacity(game) - this.list.filter((s) => s.mode !== 'waiting').length;
  }

  /** Wartenden Siedler im Lager ansprechen: folgt dem Spieler, sofern ein Platz frei ist. */
  recruit(s, game) {
    if (this.freeBeds(game) <= 0) {
      game.ui.toast(game.buildings.count('hut') ? 'Alle Plätze sind belegt – du brauchst eine weitere Hütte (4 Plätze).' : 'Du brauchst eine Hütte für neue Siedler (4 Plätze).', 'warn', 'beds');
      game.audio.play('error');
      return;
    }
    s.mode = 'follow';
    s.task = null;
    s.path = null;
    s.repathT = 0;
    const t = TRAITS[s.trait] || TRAITS.none;
    game.ui.toast(`${s.name} (${t.label}: ${t.desc}) folgt dir zur Siedlung.`, 'good');
    game.effects.burst(s.x, s.y - 10, { n: 10, color: ['#ffd36a', '#fff3c4'], speed: 30, life: 0.7, up: 25 });
    game.audio.play('arrive');
    if (s.poi) game.pois.onRecruit(s.poi, s, game);
    s.poi = null;
  }

  /** Folgender Siedler erreicht die Siedlung und wird ein Teil von ihr. */
  join(s, game) {
    s.mode = null;
    s.task = null;
    s.path = null;
    game.stats.rescued = (game.stats.rescued || 0) + 1;
    game.ui.toast(`${s.name} ist in der Siedlung angekommen.`, 'good');
    game.effects.burst(s.x, s.y - 10, { n: 14, color: ['#ffd36a', '#fff3c4'], speed: 35, life: 0.8, up: 30 });
    game.audio.play('questDone');
  }

  /** Interaktions-Provider: wartende Siedler in Reichweite. */
  provider = (game, out) => {
    const p = game.player;
    for (const s of this.list) {
      if (s.mode !== 'waiting' || (s.wander && !s.wander.joinable) || Math.abs(s.x - p.x) > 34 || Math.abs(s.y - p.y) > 34) continue;
      out.push({
        kind: 'settler', obj: s, x: s.x, y: s.y, label: `${s.name} mitnehmen`, promptH: 26, prio: -6, reach: 30,
        hit: (mx, my) => Math.abs(mx - s.x) < 7 && my < s.y + 2 && my > s.y - 20,
        act: (g) => this.recruit(s, g),
      });
    }
  };

  /** Wartende warten am Lagerfeuer; Folgende laufen dem Spieler nach bis in die Siedlung. */
  updateVisitor(s, dt, game) {
    if (s.hurt > 0) s.hurt -= dt;
    if (s.mode === 'waiting' && s.wander) {
      // Wanderer: zieht langsam die Straße entlang; bleibt stehen, wenn der Spieler nahe ist und er sich anschließen will
      const p = game.player, cam = game.camera;
      if (Math.hypot(s.x - cam.x, s.y - cam.y) > 46 * TILE) {
        s.gone = true;
        return;
      }
      if (s.wander.joinable && !p.dead && Math.hypot(p.x - s.x, p.y - s.y) < 3 * TILE) {
        s.moving = false;
        s.flip = p.x < s.x;
        return;
      }
      const hit = game.world.moveEntity(s, s.wander.dx * 18 * dt, s.wander.dy * 18 * dt, s.r, 'friendly');
      if (hit) s.gone = !game.camera.visible(s.x, s.y, 1, 1, 40);
      s.moving = true;
      s.walk += dt * 6;
      if (s.wander.dx) s.flip = s.wander.dx < 0;
      return;
    }
    if (s.mode === 'waiting') {
      s.moving = false;
      s.timer += dt;
      if (s.timer > 3 + (s.id % 4)) {
        s.timer = 0;
        s.flip = !s.flip; // schaut sich um
      }
      return;
    }
    const c = game.buildings.center, p = game.player;
    if (c && Math.hypot(s.x - c.x, s.y - c.y) < (TERRITORY_CENTER - 2) * TILE) {
      this.join(s, game);
      return;
    }
    if (p.dead) {
      s.moving = false;
      return;
    }
    const d = Math.hypot(p.x - s.x, p.y - s.y);
    if (d < 22) {
      s.moving = false;
      s.path = null;
      return;
    }
    s.repathT = (s.repathT || 0) - dt;
    if (!s.path || s.repathT <= 0) {
      s.repathT = 0.6;
      const path = game.world.findPath(s.tx, s.ty, p.tx, p.ty, 3000);
      s.path = path;
      s.pathI = 0;
      if (!path) {
        // kein Weg (z. B. Spieler hinter einer Mauer): direkt hinterher
        const k = Math.min(1, (s.speed * 1.2 * dt) / d);
        game.world.moveEntity(s, (p.x - s.x) * k, (p.y - s.y) * k, s.r, 'friendly');
        s.moving = true;
        s.walk += dt * 10;
        return;
      }
    }
    s.followBoost = d > 60 ? 1.35 : 1.15;
    this.followPath(s, dt, game);
  }

  // ---------------------------------------------------------------- Simulation
  update(dt, game) {
    this.jobTimer -= dt;
    if (this.jobTimer <= 0) {
      this.jobTimer = 1.5;
      this.assignJobs(game);
    }
    this.starveWarn -= dt;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const s = this.list[i];
      if (s.mode) {
        if (s.hp <= 0) this.kill(s, game, 'gefallen');
        else this.updateVisitor(s, dt, game);
        if (s.gone) this.list.splice(this.list.indexOf(s), 1);
        continue;
      }
      this.updateNeeds(s, dt, game);
      if (s.hp <= 0) {
        this.kill(s, game, s.hunger <= 0 ? 'verhungert' : s.thirst <= 0 ? 'verdurstet' : 'gefallen');
        continue;
      }
      this.updateSettler(s, dt, game);
    }
  }

  updateNeeds(s, dt, game) {
    const k = s.hidden ? 0.5 : 1; // im Schlaf langsamerer Verbrauch
    s.hunger = Math.max(0, s.hunger - SETTLER.hungerRate * dt * k);
    s.thirst = Math.max(0, s.thirst - SETTLER.thirstRate * dt * k);
    if (s.hurt > 0) s.hurt -= dt;
    if (s.hunger <= 0 || s.thirst <= 0) {
      s.hp -= SETTLER.starveDamage * dt;
      if (this.starveWarn <= 0) {
        this.starveWarn = 8;
        const what = s.hunger <= 0 ? RES.food.name : RES.water.name;
        game.ui.toast(`Deine Siedler leiden – es fehlt ${what}!`, 'danger', 'starve');
      }
    } else {
      s.hp = Math.min(s.maxHp, s.hp + 0.4 * dt);
    }
  }

  kill(s, game, how) {
    this.release(s);
    const i = this.list.indexOf(s);
    if (i >= 0) this.list.splice(i, 1);
    if (s.farm) s.farm.worker = null;
    if (s.home) {
      const j = s.home.sleepers.indexOf(s);
      if (j >= 0) s.home.sleepers.splice(j, 1);
    }
    game.effects.burst(s.x, s.y - 6, { n: 16, color: ['#8a1c1c', '#5a5048', '#3b3634'], speed: 50, life: 0.8 });
    const look = this.look(s), x = s.x, y = s.y;
    game.effects.corpse((ctx, k) => drawHumanoid(ctx, x, y + k * 2, { ...look, pose: k < 0.3 ? 'kneel' : 'lie' }), 0.9);
    if (s.wander) return; // fremde Wanderer zählen nicht als Verlust
    if (s.mode) {
      if (s.poi) game.pois.onRecruit(s.poi, s, game);
      game.ui.toast(`${s.name} wurde in der Wildnis getötet.`, 'danger');
      return;
    }
    game.ui.toast(`${s.name} ist ${how}.`, 'danger');
    game.audio.play('death');
    game.stats.lost = (game.stats.lost || 0) + 1;
  }

  /** Farmen ohne Arbeiter den nächstgelegenen freien Siedlern zuweisen. */
  assignJobs(game) {
    const colony = this.colony;
    for (const s of colony) {
      if (s.job === 'farm' && (!s.farm || s.farm.dead)) {
        s.job = null;
        s.farm = null;
        if (s.task && s.task.type === 'farm') s.task = null;
      }
    }
    for (const f of game.buildings.ofType('farm')) {
      if (f.worker && !f.worker.dead && this.list.includes(f.worker)) continue;
      f.worker = null;
      let best = null, bd = Infinity;
      for (const s of colony) {
        if (s.job) continue;
        const d = dist(s.x, s.y, f.x, f.y);
        if (d < bd) {
          bd = d;
          best = s;
        }
      }
      // Mindestens ein Sammler bleibt erhalten, solange es mehr als einen Siedler gibt
      const gatherers = colony.filter((s) => !s.job).length;
      if (best && (gatherers > 1 || colony.length === 1)) {
        best.job = 'farm';
        best.farm = f;
        f.worker = best;
        if (!best.carry) best.task = null;
      }
    }
  }

  claim(s, node) {
    this.release(s);
    s.claimed = node.id;
    this.claims.set(node.id, (this.claims.get(node.id) || 0) + 1);
  }

  release(s) {
    if (s.claimed === undefined) return;
    const c = (this.claims.get(s.claimed) || 1) - 1;
    if (c <= 0) this.claims.delete(s.claimed);
    else this.claims.set(s.claimed, c);
    s.claimed = undefined;
  }

  /** Welche Ressource sollen Sammler gerade holen? */
  wantedResource(game) {
    if (this.focus !== 'auto') return this.focus;
    const pop = this.colony.length;
    const want = { wood: 60, stone: 60, food: 12 + pop * 4, water: 12 + pop * 4 };
    // Mit Farmen/Brunnen übernehmen diese Gebäude die Versorgung größtenteils
    if (game.buildings.count('farm') > 0) want.food *= 0.5;
    if (game.buildings.count('well') > 0) want.water *= 0.5;
    let best = 'wood', bs = Infinity;
    for (const k of GATHER_KEYS) {
      const sc = game.stock[k] / want[k];
      if (sc < bs) {
        bs = sc;
        best = k;
      }
    }
    return best;
  }

  /** Nächste Aufgabe für einen untätigen Siedler wählen. */
  chooseTask(s, game) {
    const { buildings, stock } = game;
    // 0) Nachts oder bei Gefahr: Schutz suchen
    if (this.shouldShelter(s, game)) return this.goShelter(s, game);
    // 1) Bedürfnisse
    if ((s.hunger < SETTLER.needAt && stock.food > 0) || (s.thirst < SETTLER.needAt && stock.water > 0)) {
      return this.goToBuilding(s, game, { type: 'eat' }, buildings.center);
    }
    // 2) Getragenes abliefern
    if (s.carry) return this.goToBuilding(s, game, { type: 'deliver' }, buildings.center);
    // 3) Farmarbeit (am Feldrand, nie auf dem Feld)
    if (s.job === 'farm' && s.farm) return this.goToBuilding(s, game, { type: 'farm', farm: s.farm }, s.farm);
    // 4) Bauen: Material aus dem Lager zur Baustelle tragen
    if (this.planBuild(s, game)) return true;
    // 5) Sammeln
    const res = this.wantedResource(game);
    if (res === 'water') {
      const found = game.world.findPathToWater(s.tx, s.ty);
      if (found) {
        s.task = { type: 'water', tx: found.tx, ty: found.ty };
        s.path = found.path;
        s.pathI = 0;
        return true;
      }
    } else {
      const node = this.findNode(s, game, RES_NODE[res]) || this.findNode(s, game, null);
      if (node) {
        const ap = game.world.accessTile(node.tx, node.ty, s.x, s.y);
        if (ap && this.goTo(s, game, { type: 'gather', node }, ap[0], ap[1])) {
          this.claim(s, node);
          return true;
        }
        node.unreachableT = game.time; // eine Weile nicht mehr versuchen
      }
    }
    // 5) Nichts zu tun: in der Nähe der Flamme umherschlendern
    const c = buildings.center;
    return this.goTo(s, game, { type: 'idle', t: 2 + Math.random() * 3 }, c.tx + 1 + Math.round((Math.random() - 0.5) * 8), c.ty + 1 + Math.round((Math.random() - 0.5) * 8));
  }

  /**
   * Baustelle mit Bedarf suchen, für den das Lager genug hat; höchstens die Hälfte der Siedler baut gleichzeitig
   * (Baumeister zuerst). Erst zum Lager (holen), dann zur Baustelle (abliefern).
   */
  planBuild(s, game) {
    const sites = game.buildings.sites;
    if (!sites.length) return false;
    const colony = this.colony;
    const builders = colony.filter((o) => o.task && (o.task.type === 'fetch' || o.task.type === 'build')).length;
    const limit = Math.max(1, Math.floor(colony.length / 2)) + (s.trait === 'builder' ? 1 : 0);
    if (builders >= limit) return false;
    let best = null, bd = Infinity;
    const w = game.world, B = game.buildings;
    const home = B.accessPoint(B.center, s.x, s.y);
    const homeRegion = home ? w.regionNear(home[0], home[1]) : -1;
    for (const b of sites) {
      const miss = B.siteMissing(b, true).find(([k]) => Math.floor(game.stock[k] || 0) > 0);
      if (!miss) continue;
      // Nur Baustellen, die vom Lager aus erreichbar sind
      const ap = B.accessPoint(b, B.center.x, B.center.y);
      if (!ap || w.regionNear(ap[0], ap[1]) !== homeRegion) continue;
      const d = Math.hypot(b.x - s.x, b.y - s.y);
      if (d < bd) {
        bd = d;
        best = [b, miss[0]];
      }
    }
    if (!best) return false;
    return this.goToBuilding(s, game, { type: 'fetch', site: best[0], res: best[1] }, game.buildings.center);
  }

  /** Am Lager: Material für die Baustelle aufnehmen (wird an der Baustelle als unterwegs vermerkt). */
  doFetch(s, t, game) {
    const b = t.site, st = b.site;
    if (!st || b.dead) {
      s.task = null;
      return;
    }
    const cap = SETTLER.carry * (s.trait === 'builder' ? 1.6 : 1);
    const missing = (st.need[t.res] || 0) - (st.got[t.res] || 0) - (st.incoming[t.res] || 0);
    const n = Math.min(Math.floor(cap), missing, Math.floor(game.stock[t.res] || 0));
    if (n <= 0) {
      s.task = null;
      return;
    }
    game.stock[t.res] -= n;
    st.incoming[t.res] = (st.incoming[t.res] || 0) + n;
    s.carry = { res: t.res, n, site: b };
    if (!this.goToBuilding(s, game, { type: 'build', site: b }, b)) this.abortBuild(s, game);
  }

  /** An der Baustelle abliefern; Reste (oder bei zerstörter Baustelle alles) gehen zurück ins Lager. */
  doBuild(s, t, game) {
    const b = t.site, c = s.carry;
    if (!c) {
      s.task = null;
      return;
    }
    if (b.site) b.site.incoming[c.res] = Math.max(0, (b.site.incoming[c.res] || 0) - c.n);
    const took = b.dead || !b.site ? 0 : game.buildings.deliverTo(game, b, c.res, c.n);
    if (took < c.n) game.stock[c.res] += c.n - took;
    s.carry = null;
    s.task = null;
    if (s.flip !== b.x < s.x) s.flip = b.x < s.x;
  }

  /** Bauauftrag abbrechen (kein Weg): Material zurück ins Lager. */
  abortBuild(s, game) {
    const c = s.carry;
    if (c && c.site) {
      if (c.site.site) c.site.site.incoming[c.res] = Math.max(0, (c.site.site.incoming[c.res] || 0) - c.n);
      game.stock[c.res] += c.n;
      s.carry = null;
    }
    s.task = null;
  }

  /** Nächsten ergiebigen Knoten (optional eines Typs) finden, der nicht überlaufen ist. */
  findNode(s, game, type) {
    const c = game.buildings.center;
    let best = null, bd = Infinity;
    for (const n of game.world.nodes) {
      if (n.removed || n.amount <= 0) continue;
      if (type && n.type !== type) continue;
      if ((this.claims.get(n.id) || 0) >= 2) continue;
      if (n.unreachableT !== undefined && game.time - n.unreachableT < 20) continue;
      // Siedler entfernen sich nicht zu weit von der Flamme (Stein ist knapper → größerer Radius)
      if (dist(n.x, n.y, c.x, c.y) > (n.type === 'rock' ? 40 : 26) * TILE) continue;
      const d = dist(n.x, n.y, s.x, s.y);
      if (d < bd) {
        bd = d;
        best = n;
      }
    }
    return best;
  }

  /** Weg zu einer Kachel planen und Aufgabe setzen. */
  goTo(s, game, task, tx, ty) {
    const path = game.world.findPath(s.tx, s.ty, tx, ty);
    if (!path) {
      s.task = { type: 'idle', t: 1 };
      s.path = null;
      return false;
    }
    task.goal = [tx, ty];
    s.task = task;
    s.path = path;
    s.pathI = 0;
    s.stuck = 0;
    s.repaths = 0;
    return true;
  }

  /** Zum Zugangspunkt eines Gebäudes gehen (Siedler betreten Gebäude nie). */
  goToBuilding(s, game, task, b) {
    const ap = game.buildings.accessPoint(b, s.x, s.y);
    if (!ap) {
      s.task = { type: 'idle', t: 1 };
      s.path = null;
      return false;
    }
    return this.goTo(s, game, task, ap[0], ap[1]);
  }

  /** Dem geplanten Pfad folgen. Liefert true, wenn das Ziel erreicht ist. */
  followPath(s, dt, game) {
    if (!s.path || s.pathI >= s.path.length) {
      s.moving = false;
      return true;
    }
    const [tx, ty] = s.path[s.pathI];
    const wx = (tx + 0.5) * TILE, wy = (ty + 0.5) * TILE;
    const dx = wx - s.x, dy = wy - s.y, d = Math.hypot(dx, dy);
    if (d < 2.5) {
      s.pathI++;
      return s.pathI >= s.path.length;
    }
    const sp = s.speed * (s.carry ? 0.85 : 1) * (s.followBoost || 1);
    const step = Math.min(d, sp * dt);
    const ox = s.x, oy = s.y;
    game.world.moveEntity(s, (dx / d) * step, (dy / d) * step, s.r, 'friendly');
    s.moving = true;
    s.vy = dy / d; // für die Blickrichtung beim Zeichnen
    s.walk += dt * 10;
    if (Math.abs(dx) > 0.5) s.flip = dx < 0;
    // Feststecken erkennen: erst neuen Weg planen, dann Aufgabe aufgeben
    if (Math.hypot(s.x - ox, s.y - oy) < step * 0.3) {
      s.stuck += dt;
      if (s.stuck > 1) {
        s.stuck = 0;
        const goal = s.task && s.task.goal;
        const path = goal && s.repaths < 2 ? game.world.findPath(s.tx, s.ty, goal[0], goal[1]) : null;
        if (path) {
          s.repaths++;
          s.path = path;
          s.pathI = 0;
        } else {
          if (s.task && s.task.type === 'gather') this.release(s);
          s.task = null;
          s.path = null;
        }
      }
    } else s.stuck = 0;
    return false;
  }

  /** Nacht (bzw. kurz davor) oder Gegner in der Nähe? */
  shouldShelter(s, game) {
    const c = game.cycle;
    if (c.isNight || (c.isEvening && c.timeToNight < 12)) return true;
    return this.enemyNear(s.x, s.y, game, 5 * TILE);
  }

  enemyNear(x, y, game, r) {
    for (const e of game.enemies.list) if (!e.dead && Math.abs(e.x - x) < r && Math.abs(e.y - y) < r && dist(e.x, e.y, x, y) < r) return true;
    return game.wildlife.hostileNear(x, y, r);
  }

  /** Nächste Hütte mit freiem Bett, sonst die Ewige Flamme. */
  findShelter(s, game) {
    let best = game.buildings.center, bd = Infinity;
    for (const h of game.buildings.ofType('hut')) {
      const incoming = this.list.filter((o) => o !== s && o.task && o.task.type === 'shelter' && o.task.home === h).length;
      if (h.sleepers.length + incoming >= BUILDING_DEFS.hut.beds) continue;
      const d = dist(s.x, s.y, h.x, h.y);
      if (d < bd) {
        bd = d;
        best = h;
      }
    }
    // Die Flamme ist näher? Dann lieber dorthin (kurzer Weg ist sicherer)
    const c = game.buildings.center;
    if (best !== c && dist(s.x, s.y, c.x, c.y) < bd * 0.6) best = c;
    return best;
  }

  goShelter(s, game) {
    this.release(s);
    const home = this.findShelter(s, game);
    if (!home) return false;
    return this.goToBuilding(s, game, { type: 'shelter', home }, home);
  }

  /** Siedler verlässt seine Unterkunft (tritt am Zugangspunkt heraus). */
  wake(s, b, buildings) {
    s.hidden = false;
    s.home = null;
    s.task = null;
    s.path = null;
    if (b) {
      const i = b.sleepers.indexOf(s);
      if (i >= 0) b.sleepers.splice(i, 1);
      const ap = buildings && !b.dead ? buildings.accessPoint(b, s.x, s.y) : null;
      if (ap) {
        s.x = (ap[0] + 0.5) * TILE + (Math.random() - 0.5) * 6;
        s.y = (ap[1] + 0.5) * TILE + (Math.random() - 0.5) * 6;
      }
    }
  }

  updateSettler(s, dt, game) {
    if (s.hidden) {
      // Morgens (und wenn keine Gegner nahe sind) wieder herauskommen
      s.checkT = (s.checkT || 0) - dt;
      if (s.checkT <= 0) {
        s.checkT = 0.5 + Math.random() * 0.5;
        if (!this.shouldShelter(s, game) && !this.enemyNear(s.x, s.y, game, 8 * TILE)) this.wake(s, s.home, game.buildings);
      }
      return;
    }
    // Gefahr/Nacht unterbricht jede Arbeit
    s.checkT = (s.checkT || 0) - dt;
    if (s.checkT <= 0) {
      s.checkT = 0.3;
      if ((!s.task || s.task.type !== 'shelter') && this.shouldShelter(s, game)) {
        this.goShelter(s, game);
        return;
      }
    }
    if (!s.task) {
      this.chooseTask(s, game);
      return;
    }
    const t = s.task;
    const arrived = this.followPath(s, dt, game);
    if (!arrived) return;
    s.moving = false;
    switch (t.type) {
      case 'idle':
        t.t -= dt;
        if (t.t <= 0) s.task = null;
        break;
      case 'eat':
        this.doEat(s, game);
        s.task = null;
        break;
      case 'deliver':
        this.doDeliver(s, game);
        s.task = null;
        break;
      case 'fetch':
        this.doFetch(s, t, game);
        break;
      case 'build':
        this.doBuild(s, t, game);
        break;
      case 'gather':
        this.doGather(s, t, dt, game);
        break;
      case 'shelter': {
        const h = t.home;
        if (h.dead) {
          s.task = null;
          break;
        }
        if (s.carry && h.type === 'center') this.doDeliver(s, game);
        s.hidden = true;
        s.home = h;
        s.task = null;
        s.path = null;
        h.sleepers.push(s);
        break;
      }
      case 'water':
        s.timer += dt;
        if (s.timer >= s.workTime('water') * 0.8) {
          s.timer = 0;
          s.carry = { res: 'water', n: (s.carry ? s.carry.n : 0) + 1 };
          s.flip = game.world.tileAt(s.tx - 1, s.ty) === T.WATER;
          if (s.carry.n >= SETTLER.carry) s.task = null;
        }
        break;
      case 'farm':
        this.doFarm(s, t, dt, game);
        break;
    }
  }

  doEat(s, game) {
    const { stock } = game;
    while (s.hunger < 100 - SETTLER.gain * 0.5 && stock.food >= 1) {
      stock.food -= 1;
      s.hunger = Math.min(100, s.hunger + SETTLER.gain);
    }
    while (s.thirst < 100 - SETTLER.gain * 0.5 && stock.water >= 1) {
      stock.water -= 1;
      s.thirst = Math.min(100, s.thirst + SETTLER.gain);
    }
    if (s.carry) this.doDeliver(s, game);
  }

  doDeliver(s, game) {
    if (!s.carry) return;
    if (s.carry.site && s.carry.site.site) s.carry.site.site.incoming[s.carry.res] = Math.max(0, (s.carry.site.site.incoming[s.carry.res] || 0) - s.carry.n);
    game.stock[s.carry.res] += s.carry.n;
    if (game.camera.visible(s.x, s.y, 1, 1, 0)) game.effects.text(s.x, s.y - 20, `+${s.carry.n} ${RES[s.carry.res].name}`, RES[s.carry.res].color);
    if (!s.carry.site) game.stats.gathered += s.carry.n;
    s.carry = null;
  }

  doGather(s, t, dt, game) {
    const n = t.node;
    if (n.removed || n.amount <= 0) {
      this.release(s);
      s.task = null;
      return;
    }
    s.flip = n.x < s.x;
    s.timer += dt;
    if (s.timer < s.workTime(n.type)) return;
    s.timer = 0;
    const res = NODE_DEFS[n.type].res;
    const got = game.world.harvest(n, 1);
    if (got > 0) {
      s.carry = { res, n: (s.carry && s.carry.res === res ? s.carry.n : 0) + got };
      if (game.camera.visible(n.x, n.y, 1, 1, 0)) {
        game.effects.burst(n.x, n.y - 4, { n: 3, color: n.type === 'tree' ? ['#8d6240', '#c49a6a'] : n.type === 'rock' ? ['#d8d4ca', '#8e8a80'] : ['#7a3266', '#3f7234'], speed: 35, life: 0.4, up: 25 });
        if (n.type === 'tree') game.audio.play('chop', 0.3);
        else if (n.type === 'rock') game.audio.play('mine', 0.3);
      }
    }
    if (!s.carry || s.carry.n >= SETTLER.carry || n.amount <= 0 || n.removed) {
      this.release(s);
      s.task = null;
    }
  }

  doFarm(s, t, dt, game) {
    const f = t.farm;
    if (!f || f.dead) {
      s.task = null;
      return;
    }
    f.growth += (dt / FARM_GROW_TIME) * (s.trait === 'farmer' ? 1.35 : 1);
    s.timer += dt;
    s.flip = f.x < s.x; // zum Feld gewandt arbeiten
    // Gelegentlich an eine andere Stelle des Feldrands wechseln (Arbeit sichtbar machen)
    if (s.timer > 5) {
      s.timer = 0;
      const ap = game.buildings.accessPoint(f, f.x + (Math.random() - 0.5) * 80, f.y + (Math.random() - 0.5) * 80);
      if (ap) {
        const path = game.world.findPath(s.tx, s.ty, ap[0], ap[1], 400);
        if (path && path.length) {
          t.goal = ap;
          s.path = path;
          s.pathI = 0;
          return;
        }
      }
    }
    if (f.growth >= 1) {
      f.growth = 0;
      s.carry = { res: 'food', n: FARM_YIELD };
      s.task = null;
      if (game.camera.visible(f.x, f.y, 1, 1, 0)) game.effects.text(f.x, f.y - 10, 'Ernte!', RES.food.color);
    }
  }

  // ---------------------------------------------------------------- Rendering
  /** Sprechblase mit Zeichen über dem Kopf (wartende Siedler, Wanderer). */
  drawBubble(ctx, s, ch) {
    const x = Math.round(s.x), y = Math.round(s.y) - 27;
    ctx.fillStyle = '#1d1712';
    ctx.fillRect(x - 3, y - 1, 7, 8);
    ctx.fillStyle = '#fff3c4';
    ctx.fillRect(x - 2, y, 5, 6);
    ctx.fillStyle = '#c0392b';
    if (ch === '!') {
      ctx.fillRect(x, y + 1, 1, 3);
      ctx.fillRect(x, y + 5 - 0, 1, 1);
    } else {
      ctx.fillRect(x - 1, y + 1, 3, 1);
      ctx.fillRect(x + 1, y + 2, 1, 1);
      ctx.fillRect(x, y + 3, 1, 1);
      ctx.fillRect(x, y + 5, 1, 1);
    }
  }

  collectDrawables(out, ctx, cam, time, glowFor = null) {
    for (const s of this.list) {
      if (s.hidden || !cam.visible(s.x - 8, s.y - 24, 16, 26)) continue;
      out.push({ y: s.y, draw: () => this.drawSettler(ctx, s, time, null, glowFor ? glowFor(s, time) : 0), unit: [s.x - 5, s.y - 19, 10, 19], sil: () => this.drawSettler(ctx, s, time, '#d8e6f0') });
    }
  }

  /** Werkzeug und Armwinkel bei der Arbeit (Hacken, Picken, Schöpfen, Feldarbeit) oder null. */
  workPose(s, time) {
    const t = s.task;
    if (!t || s.moving) return null;
    let item;
    if (t.type === 'gather') item = { tree: 'axe', rock: 'pick', bush: null }[t.node.type];
    else if (t.type === 'farm') item = 'hoe';
    else if (t.type === 'water') item = 'bucket';
    else return null;
    // Schlagzyklus: langsam ausholen, schnell zuschlagen
    const ph = (time * 1.4 + s.id * 0.37) % 1;
    const sw = ph < 0.7 ? -0.5 + (ph / 0.7) * 2.1 : 1.6 - ((ph - 0.7) / 0.3) * 2.3;
    const base = s.flip ? Math.PI : 0, side = s.flip ? 1 : -1;
    return { item, arm: item ? base + side * sw : base + side * (0.1 + Math.sin(ph * Math.PI * 2) * 0.4), lean: ph > 0.7 ? 1 : 0 };
  }

  look(s) {
    return { flip: s.flip, tunic: s.tunic, skin: '#c99a6e', hair: s.hair };
  }

  drawSettler(ctx, s, time, sil = null, glow = 0) {
    if (s.wander) {
      drawWanderer(ctx, s, time, sil);
      if (!sil && s.wander.joinable && Math.sin(time * 4) > -0.3) this.drawBubble(ctx, s, '!');
      return;
    }
    const work = this.workPose(s, time);
    drawHumanoid(ctx, s.x, s.y, {
      ...this.look(s), walk: s.moving ? s.walk : 0, breath: time + s.id, silhouette: sil, outline: glow > 0 ? '#ffd36a' : OUTLINE.settler,
      hurt: s.hurt > 0, carry: s.carry ? s.carry.res : null,
      item: work && work.item, arm: work ? work.arm : null, lean: work ? work.lean : 0, dir: s.moving && s.vy > 0.7 ? 'down' : 'side',
    });
    if (sil) return;
    if (s.mode === 'waiting' && Math.sin(time * 4) > -0.3) this.drawBubble(ctx, s, '?');
    // Bedürfnis-Symbole bei Mangel
    const low = s.hunger < SETTLER.needAt * 0.6 ? '#c27ab3' : s.thirst < SETTLER.needAt * 0.6 ? '#7fc0ea' : null;
    if (low && Math.sin(time * 6) > 0) {
      ctx.fillStyle = '#000';
      ctx.fillRect(Math.round(s.x) - 2, Math.round(s.y) - 27, 5, 5);
      ctx.fillStyle = low;
      ctx.fillRect(Math.round(s.x) - 1, Math.round(s.y) - 26, 3, 3);
    }
    if (s.hp < s.maxHp) {
      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      ctx.fillRect(Math.round(s.x) - 5, Math.round(s.y) - 21, 10, 2);
      ctx.fillStyle = '#6fbf5a';
      ctx.fillRect(Math.round(s.x) - 5, Math.round(s.y) - 21, Math.round((10 * s.hp) / s.maxHp), 2);
    }
  }
}
