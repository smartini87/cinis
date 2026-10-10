// settlers.js – Siedler: Bedürfnisse (Hunger/Durst), Jobvergabe (Farm/Sammeln), Aufgaben-Zustandsautomat,
// Wegfolgen und Zeichnen. Siedler arbeiten vollautomatisch; der Spieler setzt nur den Arbeitsschwerpunkt.

import { TILE, RES, RES_KEYS, SETTLER, FARM_GROW_TIME, FARM_YIELD, SETTLER_ARRIVAL_COST } from './config.js';
import { NODE_DEFS, T } from './world.js';
import { CENTER_BEDS, BUILDING_DEFS } from './buildings.js';
import { drawHumanoid } from './sprites.js';
import { dist, hash2 } from './util.js';

const NAMES = ['Marcus', 'Livia', 'Gaius', 'Iulia', 'Titus', 'Octavia', 'Lucius', 'Cornelia', 'Quintus', 'Aurelia', 'Decimus', 'Flavia',
  'Sextus', 'Claudia', 'Publius', 'Valeria', 'Servius', 'Tullia', 'Appius', 'Fabia', 'Gnaeus', 'Antonia', 'Manius', 'Hortensia',
  'Aulus', 'Sabina', 'Spurius', 'Domitia', 'Tiberius', 'Lucretia'];
const TUNICS = ['#b8a074', '#8a6a4a', '#7a8a5a', '#6a7a8a', '#9a7a5a', '#a08a6a', '#7a5a6a'];
const HAIR = ['#2a1d14', '#4a3020', '#6b4a2a', '#1d1712', '#8a6a3a', '#5a5048'];

/** Ressource → Knotentyp für Sammelaufträge */
const RES_NODE = { wood: 'tree', stone: 'rock', food: 'bush' };

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
  constructor(x, y, seedIdx) {
    this.id = nextId++;
    this.name = NAMES[seedIdx % NAMES.length];
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

  spawn(x, y) {
    const s = new Settler(x, y, this.nameIdx++);
    this.list.push(s);
    return s;
  }

  capacity(game) {
    return CENTER_BEDS + game.buildings.count('hut') * BUILDING_DEFS.hut.beds;
  }

  /** Neue Siedler anwerben, falls Platz und Nahrung vorhanden. Liefert Anzahl. */
  tryArrival(game, max = 1) {
    let n = 0;
    while (n < max && this.list.length < this.capacity(game) && game.stock.food >= SETTLER_ARRIVAL_COST) {
      game.stock.food -= SETTLER_ARRIVAL_COST;
      const c = game.buildings.center;
      const s = this.spawn(c.x + (Math.random() - 0.5) * 20, c.y + 26);
      game.ui.toast(`${s.name} schließt sich der Siedlung an (−${SETTLER_ARRIVAL_COST} ${RES.food.name}).`, 'good');
      game.effects.burst(s.x, s.y - 8, { n: 10, color: ['#ffd36a', '#fff3c4'], speed: 30, life: 0.8, up: 30 });
      n++;
    }
    return n;
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
    game.ui.toast(`${s.name} ist ${how}.`, 'danger');
    game.audio?.play('death');
    game.stats.lost = (game.stats.lost || 0) + 1;
  }

  /** Farmen ohne Arbeiter den nächstgelegenen freien Siedlern zuweisen. */
  assignJobs(game) {
    for (const s of this.list) {
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
      for (const s of this.list) {
        if (s.job) continue;
        const d = dist(s.x, s.y, f.x, f.y);
        if (d < bd) {
          bd = d;
          best = s;
        }
      }
      // Mindestens ein Sammler bleibt erhalten, solange es mehr als einen Siedler gibt
      const gatherers = this.list.filter((s) => !s.job).length;
      if (best && (gatherers > 1 || this.list.length === 1)) {
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
    const pop = this.list.length;
    const want = { wood: 60, stone: 60, food: 12 + pop * 4, water: 12 + pop * 4 };
    // Mit Farmen/Brunnen übernehmen diese Gebäude die Versorgung größtenteils
    if (game.buildings.count('farm') > 0) want.food *= 0.5;
    if (game.buildings.count('well') > 0) want.water *= 0.5;
    let best = 'wood', bs = Infinity;
    for (const k of RES_KEYS) {
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
      return this.goTo(s, game, { type: 'eat' }, buildings.center.tx + 1, buildings.center.ty + 1);
    }
    // 2) Getragenes abliefern
    if (s.carry) return this.goTo(s, game, { type: 'deliver' }, buildings.center.tx + 1, buildings.center.ty + 1);
    // 3) Farmarbeit
    if (s.job === 'farm' && s.farm) return this.goTo(s, game, { type: 'farm', farm: s.farm }, s.farm.tx, s.farm.ty + 1);
    // 4) Sammeln
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
        this.claim(s, node);
        return this.goTo(s, game, { type: 'gather', node }, node.tx, node.ty);
      }
    }
    // 5) Nichts zu tun: in der Nähe der Flamme umherschlendern
    const c = buildings.center;
    return this.goTo(s, game, { type: 'idle', t: 2 + Math.random() * 3 }, c.tx + 1 + Math.round((Math.random() - 0.5) * 8), c.ty + 1 + Math.round((Math.random() - 0.5) * 8));
  }

  /** Nächsten ergiebigen Knoten (optional eines Typs) finden, der nicht überlaufen ist. */
  findNode(s, game, type) {
    const c = game.buildings.center;
    let best = null, bd = Infinity;
    for (const n of game.world.nodes) {
      if (n.removed || n.amount <= 0) continue;
      if (type && n.type !== type) continue;
      if ((this.claims.get(n.id) || 0) >= 2) continue;
      // Siedler entfernen sich nicht zu weit von der Flamme
      if (dist(n.x, n.y, c.x, c.y) > 26 * TILE) continue;
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
    s.task = task;
    s.path = path;
    s.pathI = 0;
    s.stuck = 0;
    return true;
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
    const sp = SETTLER.speed * (s.carry ? 0.85 : 1);
    const step = Math.min(d, sp * dt);
    const ox = s.x, oy = s.y;
    game.world.moveEntity(s, (dx / d) * step, (dy / d) * step, s.r, game.world.solidFriendly);
    s.moving = true;
    s.walk += dt * 10;
    if (Math.abs(dx) > 0.5) s.flip = dx < 0;
    // Feststecken erkennen und Aufgabe neu wählen
    if (Math.hypot(s.x - ox, s.y - oy) < step * 0.3) {
      s.stuck += dt;
      if (s.stuck > 1.5) {
        s.task = null;
        s.path = null;
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
    return false;
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
    return this.goTo(s, game, { type: 'shelter', home }, home.tx + (home.size >> 1), home.ty + home.size - 1);
  }

  /** Siedler verlässt seine Unterkunft. */
  wake(s, b) {
    s.hidden = false;
    s.home = null;
    s.task = null;
    s.path = null;
    if (b) {
      const i = b.sleepers.indexOf(s);
      if (i >= 0) b.sleepers.splice(i, 1);
      s.x = b.x + (Math.random() - 0.5) * b.size * TILE * 0.6;
      s.y = (b.ty + b.size) * TILE + 4;
    }
  }

  updateSettler(s, dt, game) {
    if (s.hidden) {
      // Morgens (und wenn keine Gegner nahe sind) wieder herauskommen
      s.checkT = (s.checkT || 0) - dt;
      if (s.checkT <= 0) {
        s.checkT = 0.5 + Math.random() * 0.5;
        if (!this.shouldShelter(s, game) && !this.enemyNear(s.x, s.y, game, 8 * TILE)) this.wake(s, s.home);
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
        if (s.timer >= SETTLER.workTime * 0.8) {
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
    game.stock[s.carry.res] += s.carry.n;
    if (game.camera.visible(s.x, s.y, 1, 1, 0)) game.effects.text(s.x, s.y - 20, `+${s.carry.n} ${RES[s.carry.res].name}`, RES[s.carry.res].color);
    game.stats.gathered += s.carry.n;
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
    if (s.timer < SETTLER.workTime) return;
    s.timer = 0;
    const res = NODE_DEFS[n.type].res;
    const got = game.world.harvest(n, 1);
    if (got > 0) {
      s.carry = { res, n: (s.carry && s.carry.res === res ? s.carry.n : 0) + got };
      if (game.camera.visible(n.x, n.y, 1, 1, 0)) {
        game.effects.burst(n.x, n.y - 4, { n: 3, color: n.type === 'tree' ? ['#8d6240', '#c49a6a'] : n.type === 'rock' ? ['#d8d4ca', '#8e8a80'] : ['#7a3266', '#3f7234'], speed: 35, life: 0.4, up: 25 });
        if (n.type === 'tree') game.audio?.play('chop', 0.3);
        else if (n.type === 'rock') game.audio?.play('mine', 0.3);
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
    f.growth += dt / FARM_GROW_TIME;
    s.timer += dt;
    // Gelegentlich auf dem Feld weiterbewegen (Arbeit sichtbar machen)
    if (s.timer > 4) {
      s.timer = 0;
      s.x = (f.tx + 0.3 + Math.random() * 1.4) * TILE;
      s.y = (f.ty + 0.6 + Math.random() * 1.3) * TILE;
      s.flip = Math.random() < 0.5;
    }
    if (f.growth >= 1) {
      f.growth = 0;
      s.carry = { res: 'food', n: FARM_YIELD };
      s.task = null;
      if (game.camera.visible(f.x, f.y, 1, 1, 0)) game.effects.text(f.x, f.y - 10, 'Ernte!', RES.food.color);
    }
  }

  // ---------------------------------------------------------------- Rendering
  collectDrawables(out, ctx, cam, time) {
    for (const s of this.list) {
      if (s.hidden || !cam.visible(s.x - 8, s.y - 24, 16, 26)) continue;
      out.push({ y: s.y, draw: () => this.drawSettler(ctx, s, time) });
    }
  }

  drawSettler(ctx, s, time) {
    const working = s.task && (s.task.type === 'gather' || s.task.type === 'farm' || s.task.type === 'water') && !s.moving;
    drawHumanoid(ctx, s.x, s.y, {
      flip: s.flip, walk: s.moving ? s.walk : working ? Math.sin(time * 8) * 0.6 : 0,
      tunic: s.tunic, skin: '#c99a6e', hair: s.hair, hurt: s.hurt > 0, carry: s.carry ? s.carry.res : null,
    });
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
