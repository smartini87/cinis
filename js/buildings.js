// buildings.js – Gebäudedefinitionen, Bausystem (Vorschau, Platzierung, Abriss), Belegungsraster,
// Produktion (Brunnen) und Zeichnen. Das Zentrum (Ewige Flamme) ist das Lager der Siedlung.

import { TILE, RES, RES_KEYS, TOWER, REPAIR_RATE } from './config.js';
import { dist } from './util.js';
import { T } from './world.js';
import { Sprites, drawFlame, drawCrops, drawBallista } from './sprites.js';

export const BUILDING_DEFS = {
  center: { name: 'Ewige Flamme', size: 3, hp: 1200, cost: {}, desc: 'Herz der Siedlung und Lager. Fällt sie, ist alles verloren.' },
  hut: { name: 'Hütte', size: 2, hp: 180, cost: { wood: 20, stone: 5 }, key: '1', beds: 2, desc: '+2 Siedlerplätze. Siedler schlafen hier geschützt.' },
  farm: { name: 'Farm', size: 2, hp: 120, cost: { wood: 14, water: 6 }, key: '2', desc: 'Ein Siedler baut hier tagsüber Nahrung an.' },
  well: { name: 'Brunnen', size: 1, hp: 150, cost: { stone: 12, wood: 4 }, key: '3', desc: 'Fördert stetig Wasser ins Lager.' },
  wall: { name: 'Mauer', size: 1, hp: 320, cost: { stone: 4 }, key: '4', desc: 'Hält Gegner auf. Eigene Leute passieren das Tor.' },
  tower: { name: 'Turm', size: 1, hp: 260, cost: { wood: 20, stone: 18 }, key: '5', desc: 'Ballista: beschießt Gegner in 6 Feldern Umkreis.' },
};
export const BUILDABLE = ['hut', 'farm', 'well', 'wall', 'tower'];

export const WELL_INTERVAL = 9;    // Sekunden pro Wasser
export const CENTER_BEDS = 3;      // Schlafplätze/Siedlerplätze der Flamme
const TERRITORY_CENTER = 12;       // Bauradius um die Flamme (Kacheln)
const TERRITORY_BUILDING = 6;      // Bauradius um jedes andere Gebäude

let nextId = 1;

export class Buildings {
  constructor(world) {
    this.world = world;
    this.list = [];
    this.center = null;
    this.selected = null;     // gewählter Bautyp oder 'demolish'
    this.ghost = null;        // { tx, ty, ok, reason }
    this.lastDragTile = -1;   // für Mauer-Ziehen
    this.changed = true;      // Belegung geändert (Wegfindung neu berechnen)
  }

  /** Gebäude anlegen und Kacheln belegen (ohne Kostenprüfung). */
  add(type, tx, ty) {
    const def = BUILDING_DEFS[type];
    const b = {
      id: nextId++, type, tx, ty, size: def.size,
      hp: def.hp, maxHp: def.hp,
      x: (tx + def.size / 2) * TILE, y: (ty + def.size / 2) * TILE,
      flash: 0, timer: 0, growth: 0, worker: null, aim: -Math.PI / 2, cooldown: 0, recoil: 0,
      sleepers: [],
    };
    this.setTiles(b, b);
    this.list.push(b);
    if (type === 'center') this.center = b;
    this.changed = true;
    return b;
  }

  setTiles(b, value) {
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
  }

  count(type) {
    return this.list.reduce((n, b) => n + (b.type === type ? 1 : 0), 0);
  }
  ofType(type) {
    return this.list.filter((b) => b.type === type);
  }

  /** Abstand eines Punkts zum Rand des Gebäuderechtecks (0 = innerhalb). */
  distTo(b, x, y) {
    const x0 = b.tx * TILE, y0 = b.ty * TILE, x1 = x0 + b.size * TILE, y1 = y0 + b.size * TILE;
    const dx = Math.max(x0 - x, 0, x - x1), dy = Math.max(y0 - y, 0, y - y1);
    return Math.hypot(dx, dy);
  }

  // ---------------------------------------------------------------- Kosten
  /** Verfügbar = Lager + Spielerinventar. */
  canAfford(game, cost) {
    return RES_KEYS.every((k) => (cost[k] || 0) <= game.stock[k] + game.player.inv[k]);
  }

  pay(game, cost) {
    for (const k of RES_KEYS) {
      let need = cost[k] || 0;
      const fromStock = Math.min(need, game.stock[k]);
      game.stock[k] -= fromStock;
      need -= fromStock;
      game.player.inv[k] -= need;
    }
  }

  // ---------------------------------------------------------------- Platzierung
  inTerritory(tx, ty, size) {
    const mx = tx + size / 2, my = ty + size / 2;
    for (const b of this.list) {
      const r = b.type === 'center' ? TERRITORY_CENTER : TERRITORY_BUILDING;
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
        if (w.buildingAt[w.idx(x, y)]) return { ok: false, reason: 'Platz ist belegt' };
        const n = w.nodeAtTile(x, y);
        if (n && !n.removed && (n.amount > 0 || n.type === 'rock')) return { ok: false, reason: `${n.type === 'tree' ? 'Baum' : n.type === 'rock' ? 'Trümmer' : 'Strauch'} im Weg – erst abbauen` };
      }
    }
    if (!this.inTerritory(tx, ty, size)) return { ok: false, reason: 'Zu weit von der Siedlung entfernt' };
    return { ok: true, reason: '' };
  }

  place(game, type, tx, ty) {
    const def = BUILDING_DEFS[type];
    const chk = this.canPlace(type, tx, ty);
    if (!chk.ok) {
      game.ui.toast(chk.reason, 'warn', 'place');
      game.audio?.play('error');
      return null;
    }
    if (!this.canAfford(game, def.cost)) {
      game.ui.toast(`Nicht genug Ressourcen für ${def.name}.`, 'warn', 'afford');
      game.audio?.play('error');
      return null;
    }
    this.pay(game, def.cost);
    // Stümpfe/leere Sträucher unter dem Bauplatz verschwinden
    for (let y = ty; y < ty + def.size; y++) {
      for (let x = tx; x < tx + def.size; x++) {
        const n = this.world.nodeAtTile(x, y);
        if (n) this.world.removeNode(n);
      }
    }
    const b = this.add(type, tx, ty);
    b.spawn = 0.35;
    game.effects.burst(b.x, b.y + (def.size * TILE) / 2 - 2, { n: 14, color: ['#b9a98a', '#8e8a80', '#d8d4ca'], speed: 50, life: 0.6, up: 20 });
    game.audio?.play('build');
    game.stats.built++;
    return b;
  }

  /** Abriss mit 50 % Rückerstattung. */
  demolish(game, b) {
    if (b.type === 'center') {
      game.ui.toast('Die Ewige Flamme kann nicht abgerissen werden.', 'warn', 'demo');
      return;
    }
    const def = BUILDING_DEFS[b.type];
    for (const k of RES_KEYS) game.stock[k] += Math.floor((def.cost[k] || 0) / 2);
    game.effects.burst(b.x, b.y, { n: 18, color: ['#8e8a80', '#6b4a2a', '#b9b4a8'], speed: 60, life: 0.7 });
    game.ui.toast(`${def.name} abgerissen (50 % erstattet).`, 'info');
    game.audio?.play('demolish');
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
    const chk = this.canPlace(this.selected, tx, ty);
    const afford = this.canAfford(game, BUILDING_DEFS[this.selected].cost);
    this.ghost = { tx, ty, ok: chk.ok && afford, reason: chk.ok ? (afford ? '' : 'Nicht genug Ressourcen') : chk.reason };
    const tileKey = ty * this.world.w + tx;
    // Mauern lassen sich bei gedrückter Maustaste ziehen
    const drag = this.selected === 'wall' && input.mouse.down && tileKey !== this.lastDragTile && chk.ok;
    if (input.mouse.clicked || input.wasPressed('Enter') || drag) {
      this.lastDragTile = tileKey;
      this.place(game, this.selected, tx, ty);
    }
    if (!input.mouse.down) this.lastDragTile = -1;
  }

  // ---------------------------------------------------------------- Simulation
  update(dt, game) {
    const sunny = game.cycle.isSunny;
    for (const b of this.list) {
      if (b.flash > 0) b.flash -= dt;
      if (b.spawn > 0) b.spawn -= dt;
      // Siedler reparieren tagsüber beschädigte Gebäude (abstrahiert als Regeneration)
      if (sunny && b.hp < b.maxHp) b.hp = Math.min(b.maxHp, b.hp + b.maxHp * REPAIR_RATE * (b.type === 'center' ? 0.5 : 1) * dt);
      if (b.type === 'tower') this.updateTower(b, dt, game);
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

  /** Ballistenturm: nächsten Gegner in Reichweite anvisieren und Bolzen feuern. */
  updateTower(b, dt, game) {
    b.cooldown -= dt;
    if (b.recoil > 0) b.recoil = Math.max(0, b.recoil - dt * 20);
    if (b.cooldown > 0) return;
    let best = null, bd = TOWER.range;
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
    b.aim = Math.atan2(best.y - 6 - (b.y - 22), best.x - b.x);
    game.combat.fireBolt(b.x, b.y - 22, best, TOWER.damage, TOWER.boltSpeed);
    b.cooldown = TOWER.cooldown;
    b.recoil = 3;
    if (game.camera.visible(b.x, b.y, 1, 1, 64)) game.audio?.play('bolt', 0.4);
  }

  // ---------------------------------------------------------------- Rendering
  /** Zeichenaufträge (nach y sortierbar) für sichtbare Gebäude sammeln. */
  collectDrawables(out, ctx, cam, time) {
    for (const b of this.list) {
      const x = b.tx * TILE, y = b.ty * TILE, s = b.size * TILE;
      if (!cam.visible(x, y - 40, s, s + 40)) continue;
      // Farmen liegen flach am Boden und werden zuerst gezeichnet
      out.push({ y: b.type === 'farm' ? y : y + s - 2, draw: () => this.drawBuilding(ctx, b, time) });
    }
  }

  drawBuilding(ctx, b, time) {
    const x = b.tx * TILE, y = b.ty * TILE, s = b.size * TILE;
    const bottom = y + s;
    // Aufbau-Animation: leicht von unten einfedern
    if (b.spawn > 0) {
      ctx.save();
      const k = 1 - b.spawn / 0.35;
      ctx.translate(x + s / 2, bottom);
      ctx.scale(1, 0.4 + 0.6 * k);
      ctx.translate(-(x + s / 2), -bottom);
    }
    switch (b.type) {
      case 'center': {
        const spr = Sprites.center;
        ctx.drawImage(spr, Math.round(x + s / 2 - spr.width / 2), bottom - spr.height + 6);
        if (b.hp > 0) drawFlame(ctx, x + s / 2, bottom - 32, 7, time);
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
        ctx.drawImage(Sprites.wall, x, bottom - Sprites.wall.height + 1);
        break;
      case 'tower':
        ctx.drawImage(Sprites.tower, x - 2, bottom - Sprites.tower.height + 2);
        drawBallista(ctx, x + 8, bottom - 30, b.aim, b.recoil);
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
    const fake = { ...g, type: this.selected, size: def.size, hp: 1, maxHp: 1, growth: 0, aim: -Math.PI / 2, recoil: 0 };
    ctx.globalAlpha = 0.6;
    this.drawBuilding(ctx, fake, time);
    ctx.globalAlpha = 1;
    ctx.fillStyle = g.ok ? 'rgba(111,191,90,0.35)' : 'rgba(208,64,42,0.4)';
    ctx.fillRect(g.tx * TILE, g.ty * TILE, def.size * TILE, def.size * TILE);
    if (this.selected === 'tower') {
      // Reichweite anzeigen
      ctx.strokeStyle = 'rgba(255,230,160,0.5)';
      ctx.beginPath();
      ctx.arc((g.tx + 0.5) * TILE, (g.ty + 0.5) * TILE, 6 * TILE, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
}
