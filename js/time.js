// time.js – Tag/Nacht-Zyklus (Phasen, Ereignisse) und dynamische Beleuchtung (Lichtkarte).

import { clamp } from './util.js';

export const DAY_LEN = 150;     // Sekunden Tageslicht (inkl. Abenddämmerung)
export const NIGHT_LEN = 75;    // Sekunden Nacht
export const CYCLE = DAY_LEN + NIGHT_LEN;
export const DAWN = 10;         // Morgendämmerung am Tagesanfang
export const DUSK = 20;         // Abenddämmerung am Tagesende
export const START_T = DAWN;    // Spielbeginn: heller Morgen

export class DayCycle {
  constructor() {
    this.t = START_T;   // Sekunden im aktuellen Zyklus
    this.day = 1;       // aktueller Tag (1-basiert); Nacht n folgt auf Tag n
    this.duskFired = false;
  }

  get isNight() {
    return this.t >= DAY_LEN;
  }
  /** Gegner verbrennen im Sonnenlicht (nicht in der Dämmerung). */
  get isSunny() {
    return this.t >= DAWN * 0.5 && this.t < DAY_LEN - DUSK;
  }
  get isEvening() {
    return this.t >= DAY_LEN - DUSK && this.t < DAY_LEN;
  }
  get timeToNight() {
    return DAY_LEN - this.t;
  }
  get timeToDawn() {
    return CYCLE - this.t;
  }
  /** Fortschritt im Zyklus 0..1 */
  get progress() {
    return this.t / CYCLE;
  }

  /** Dunkelheit 0 (Mittag) .. 1 (Nacht). */
  get darkness() {
    const t = this.t;
    if (t < DAWN) return 1 - t / DAWN;
    if (t < DAY_LEN - DUSK) return 0;
    if (t < DAY_LEN) return (t - (DAY_LEN - DUSK)) / DUSK;
    return 1;
  }

  /**
   * Zeit fortschreiben; ruft Ereignisse am Spiel auf:
   * onDusk(day), onNight(day), onDawn(newDay).
   */
  update(dt, game) {
    const prev = this.t;
    this.t += dt;
    if (!this.duskFired && this.t >= DAY_LEN - DUSK) {
      this.duskFired = true;
      game.onDusk(this.day);
    }
    if (prev < DAY_LEN && this.t >= DAY_LEN) game.onNight(this.day);
    if (this.t >= CYCLE) {
      this.t -= CYCLE;
      this.day++;
      this.duskFired = false;
      game.onDawn(this.day);
    }
  }
}

/** Lichtkarte: Dunkelheit mit ausgestanzten Lichtkegeln, in reduzierter Auflösung für Tempo. */
export class Lighting {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d');
    this.scale = 4; // Lichtkarte hat 1/4 der Bildschirmauflösung
  }

  draw(ctx, game) {
    const { cycle, camera } = game;
    const dark = cycle.darkness;
    const W = Math.ceil(camera.vw / this.scale), H = Math.ceil(camera.vh / this.scale);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    // Warmes Abend-/Morgenlicht
    const warm = Math.sin(clamp(dark, 0, 1) * Math.PI);
    if (warm > 0.02) {
      ctx.fillStyle = `rgba(255,120,40,${warm * 0.16})`;
      ctx.fillRect(0, 0, camera.vw, camera.vh);
    }
    if (dark <= 0.01) {
      ctx.restore();
      return;
    }
    if (this.canvas.width !== W || this.canvas.height !== H) {
      this.canvas.width = W;
      this.canvas.height = H;
    }
    const g = this.ctx;
    g.globalCompositeOperation = 'source-over';
    g.clearRect(0, 0, W, H);
    g.fillStyle = `rgba(6,8,26,${dark * 0.78})`;
    g.fillRect(0, 0, W, H);
    g.globalCompositeOperation = 'destination-out';
    const k = camera.zoom / this.scale;
    const light = (wx, wy, r, strength = 1) => {
      const sx = (wx - camera.left) * k, sy = (wy - camera.top) * k, sr = r * k;
      if (sx < -sr || sy < -sr || sx > W + sr || sy > H + sr) return;
      const grd = g.createRadialGradient(sx, sy, 0, sx, sy, sr);
      grd.addColorStop(0, `rgba(0,0,0,${strength})`);
      grd.addColorStop(0.55, `rgba(0,0,0,${strength * 0.6})`);
      grd.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grd;
      g.fillRect(sx - sr, sy - sr, sr * 2, sr * 2);
    };
    const flick = 1 + Math.sin(game.time * 13) * 0.03 + Math.sin(game.time * 7.3) * 0.03;
    for (const b of game.buildings.list) {
      if (b.type === 'center') light(b.x, b.y - 8, 150 * flick, 1);
      else if (b.type === 'hut') light(b.x, b.y, 44 * flick, 0.75);
      else if (b.type === 'tower') light(b.x, b.y - 14, 58 * flick, 0.8);
    }
    const p = game.player;
    if (!p.dead) light(p.x, p.y - 8, 64, 0.85);
    for (const pr of game.combat.projectiles) light(pr.x, pr.y, 14, 0.6);
    // Glühende Augen der Gegner bleiben sichtbar
    for (const e of game.enemies.list) light(e.x, e.y - 8, 10, 0.35);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.canvas, 0, 0, camera.vw, camera.vh);
    ctx.imageSmoothingEnabled = false;
    // Feuerschein der Flamme
    const c = game.buildings.center;
    if (c) {
      const s = camera.worldToScreen(c.x, c.y - 10);
      const r = 110 * camera.zoom * flick;
      const grd = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, r);
      grd.addColorStop(0, `rgba(255,140,50,${0.22 * dark})`);
      grd.addColorStop(1, 'rgba(255,140,50,0)');
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = grd;
      ctx.fillRect(s.x - r, s.y - r, r * 2, r * 2);
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.restore();
  }
}
