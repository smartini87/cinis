// flame.js – die Ewige Flamme als Fortschrittssystem: Stufen 1–8 (Upgrade kostet Ressourcen, schaltet Gebäude
// und Rezepte frei, vergrößert Licht, Bauradius, Siedlerzahl und Schutzaura) und Glut (vigor 0–100).
// Jede Nacht verbrennt die Flamme Brennstoff aus dem Lager; fehlt er, schrumpft sie. Bei 0 erlischt sie.

import { RES } from './config.js';

/**
 * Stufen: cost = Upgrade-Kosten, light = Lichtradius (Welteinheiten), territory = Bauradius (Kacheln),
 * pop = höchste Siedlerzahl, aura = Brennschaden/s an Gegnern nahe der Flamme, fuel = Brennstoff pro Nacht.
 */
export const FLAME_LEVELS = [
  null,
  { cost: null, light: 150, territory: 12, pop: 8, aura: 0, fuel: { wood: 6 } },
  { cost: { wood: 40, stone: 25 }, light: 165, territory: 13, pop: 12, aura: 3, fuel: { wood: 10 } },
  { cost: { wood: 50, stone: 40, iron: 4 }, light: 180, territory: 14, pop: 16, aura: 5, fuel: { wood: 10, coal: 3 } },
  { cost: { wood: 60, stone: 50, iron: 8, coal: 6 }, light: 195, territory: 15, pop: 20, aura: 7, fuel: { wood: 12, coal: 5 } },
  { cost: { stone: 70, iron: 12, coal: 12, resin: 4 }, light: 210, territory: 16, pop: 24, aura: 9, fuel: { coal: 8, resin: 2 } },
  { cost: { stone: 80, iron: 16, coal: 16, resin: 6, cloth: 6 }, light: 225, territory: 17, pop: 28, aura: 11, fuel: { coal: 10, resin: 3 } },
  { cost: { stone: 100, iron: 22, coal: 20, resin: 8, oil: 3 }, light: 240, territory: 18, pop: 32, aura: 14, fuel: { coal: 12, resin: 3, oil: 1 } },
  { cost: { stone: 120, iron: 30, coal: 25, resin: 10, oil: 6 }, light: 260, territory: 19, pop: 40, aura: 18, fuel: { coal: 14, resin: 4, oil: 2 } },
];
export const MAX_LEVEL = FLAME_LEVELS.length - 1;

/** Glut je nachgelegter Einheit (E an der Flamme) */
const FUEL_VALUE = { wood: 2, coal: 5, resin: 6, oil: 12 };

export class Flame {
  constructor() {
    this.level = 1;
    this.vigor = 100;
  }

  get def() {
    return FLAME_LEVELS[this.level];
  }
  get next() {
    return FLAME_LEVELS[this.level + 1] || null;
  }
  /** Anteil der Glut (0..1) */
  get k() {
    return Math.max(0, Math.min(1, this.vigor / 100));
  }
  /** Lichtradius (schrumpft mit der Glut) */
  get light() {
    return this.def.light * (0.5 + 0.5 * this.k);
  }
  /** Bauradius in Kacheln (schrumpft mit der Glut, nie unter 8) */
  get territory() {
    return Math.max(8, Math.round(this.def.territory * (0.6 + 0.4 * this.k)));
  }
  get popCap() {
    return this.def.pop;
  }
  get aura() {
    return this.def.aura * this.k;
  }
  fuelNeed(k) {
    return this.def.fuel[k] || 0;
  }

  /** Reicht das Lager für n Nächte Brennstoff? */
  fuelCovered(stock, nights = 1) {
    return Object.entries(this.def.fuel).every(([k, n]) => (stock[k] || 0) >= n * nights);
  }

  /** Abenddämmerung: Brennstoff für die Nacht verbrennen; fehlt etwas, verliert die Flamme Glut. */
  burnForNight(game) {
    let need = 0, got = 0;
    const used = [];
    for (const [k, n] of Object.entries(this.def.fuel)) {
      const take = Math.min(n, Math.floor(game.stock[k] || 0));
      game.stock[k] -= take;
      need += n;
      got += take;
      if (take) used.push(`${take} ${RES[k].name}`);
    }
    const missing = need ? 1 - got / need : 0;
    if (missing <= 0) {
      this.vigor = Math.min(100, this.vigor + 15);
      game.ui.toast(`Die Flamme nährt sich für die Nacht: ${used.join(', ')}.`, 'info', 'fuel');
    } else {
      this.vigor = Math.max(0, this.vigor - 40 * missing);
      game.ui.toast(`Brennstoff fehlt! Die Flamme schrumpft – Glut ${Math.round(this.vigor)} %.`, 'danger');
      game.audio.play('alarm', 0.6);
    }
    game.buildings.territoryCenter = this.territory;
    if (this.vigor <= 0) game.onFlameOut();
  }

  /** Brennstoff von Hand nachlegen (aus Lager, dann Gepäck), bis die Glut voll ist. Liefert die Glut-Zunahme. */
  feed(game) {
    const before = this.vigor;
    for (const [k, v] of Object.entries(FUEL_VALUE)) {
      while (this.vigor < 100) {
        if ((game.stock[k] || 0) >= 1) game.stock[k] -= 1;
        else if (game.player.inv.count(k) > 0) game.player.inv.remove(k, 1);
        else break;
        this.vigor = Math.min(100, this.vigor + v);
      }
    }
    game.buildings.territoryCenter = this.territory;
    return this.vigor - before;
  }

  canUpgrade(game) {
    return !!this.next && game.buildings.canAfford(game, this.next.cost);
  }

  /** Auf die nächste Stufe entfachen. */
  upgrade(game) {
    if (!this.canUpgrade(game)) return false;
    game.buildings.pay(game, this.next.cost);
    this.level++;
    this.vigor = 100;
    game.buildings.territoryCenter = this.territory;
    const c = game.buildings.center;
    if (c) {
      c.pulse = 1.5;
      game.effects.burst(c.x, c.y - 24, { n: 60, color: ['#ffd36a', '#fff3c4', '#f0a53a', '#e8742a'], speed: 80, life: 1.2, up: 50 });
    }
    game.camera.addShake(3, 0.4);
    game.flashT = 0.3;
    game.audio.play('levelUp');
    game.ui.toast(`<b>Die Ewige Flamme lodert auf – Stufe ${this.level}!</b> Größeres Licht, mehr Platz für Siedler, neue Baupläne.`, 'unlock');
    game.onFlameLevel(this.level);
    return true;
  }

  /** Schutzaura: Gegner im inneren Lichtkreis verbrennen langsam. */
  update(dt, game) {
    const c = game.buildings.center;
    if (!c || c.hp <= 0 || this.aura <= 0) return;
    const r = this.light * 0.4;
    for (const e of game.enemies.list) {
      if (e.dead || Math.abs(e.x - c.x) > r || Math.abs(e.y - c.y) > r) continue;
      if (Math.hypot(e.x - c.x, e.y - c.y) > r) continue;
      e.hp -= this.aura * dt;
      if (Math.random() < dt * 4) game.effects.burst(e.x, e.y - 8, { n: 1, color: ['#ffb040', '#e8742a'], speed: 10, life: 0.5, up: 20, gravity: -20 });
      if (e.hp <= 0) game.enemies.kill(e, game, false);
    }
  }

  serialize() {
    return { level: this.level, vigor: this.vigor };
  }

  restore(d) {
    if (!d) return;
    this.level = d.level || 1;
    this.vigor = d.vigor ?? 100;
  }
}

