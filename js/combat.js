// combat.js – Kampfregeln: Geschosse der Türme und Schadensfunktionen für Gebäude, Siedler und Spieler.

import { drawBolt } from './sprites.js';
import { BUILDING_DEFS } from './buildings.js';
import { dist } from './util.js';

export class Combat {
  constructor() {
    this.projectiles = [];
    this.shots = [];   // Glutwürfe der Aschenwerfer { x, y, target, dmg, building, life }
  }

  /** Glutwurf eines Fernkämpfers auf eine Einheit oder ein Gebäude. */
  fireShot(x, y, target, dmg, building) {
    this.shots.push({ x, y, target, dmg, building, life: 3, speed: 130 });
  }

  /** Zielsuchenden Bolzen abfeuern. */
  fireBolt(x, y, target, dmg, speed) {
    this.projectiles.push({ x, y, target, dmg, speed, life: 1.6, angle: Math.atan2(target.y - 6 - y, target.x - x) });
  }

  update(dt, game) {
    const ps = this.projectiles;
    for (let i = ps.length - 1; i >= 0; i--) {
      const p = ps[i];
      p.life -= dt;
      const t = p.target;
      if (t && !t.dead) p.angle = Math.atan2(t.y - 6 - p.y, t.x - p.x);
      p.x += Math.cos(p.angle) * p.speed * dt;
      p.y += Math.sin(p.angle) * p.speed * dt;
      if (t && !t.dead && dist(p.x, p.y, t.x, t.y - 6) < t.r + 4) {
        game.enemies.hit(t, p.dmg, game, Math.cos(p.angle) * 3, Math.sin(p.angle) * 3);
        game.effects.burst(p.x, p.y, { n: 4, color: ['#d8d4ca', '#8a8580'], speed: 30, life: 0.3 });
        ps.splice(i, 1);
        continue;
      }
      if (p.life <= 0) ps.splice(i, 1);
    }
    const ss = this.shots;
    for (let i = ss.length - 1; i >= 0; i--) {
      const s = ss[i], t = s.target;
      s.life -= dt;
      if (!t || t.dead || s.life <= 0) {
        ss.splice(i, 1);
        continue;
      }
      const ty = s.building ? t.y : t.y - 6;
      const dx = t.x - s.x, dy = ty - s.y, d = Math.hypot(dx, dy);
      const step = s.speed * dt;
      const hit = s.building ? game.buildings.distTo(t, s.x, s.y) < 3 : d < 5;
      if (hit) {
        if (s.building) damageBuilding(game, t, s.dmg);
        else damageUnit(game, t, s.dmg, (dx / (d || 1)) * 2, (dy / (d || 1)) * 2);
        game.effects.burst(s.x, s.y, { n: 5, color: ['#ffb040', '#e8742a', '#5a5450'], speed: 30, life: 0.35 });
        ss.splice(i, 1);
        continue;
      }
      s.x += (dx / d) * Math.min(step, d);
      s.y += (dy / d) * Math.min(step, d);
      if (Math.random() < dt * 30) game.effects.burst(s.x, s.y, { n: 1, color: ['#e8742a', '#5a5450'], speed: 4, life: 0.3, up: 4, gravity: -5 });
    }
  }

  draw(ctx) {
    for (const p of this.projectiles) drawBolt(ctx, p.x, p.y, p.angle);
    for (const s of this.shots) {
      ctx.fillStyle = '#ffd36a';
      ctx.fillRect(Math.round(s.x) - 1, Math.round(s.y) - 1, 2, 2);
      ctx.fillStyle = 'rgba(232,116,42,0.6)';
      ctx.fillRect(Math.round(s.x) - 2, Math.round(s.y), 1, 1);
    }
  }

  clear() {
    this.projectiles.length = 0;
    this.shots.length = 0;
  }
}

/** Schaden an einem Gebäude; zerstört es bei 0 LP. */
export function damageBuilding(game, b, dmg) {
  if (b.dead) return;
  b.hp -= dmg;
  b.flash = 0.12;
  b.lastHit = game.time;
  if (b.type === 'center') {
    game.camera.addShake(2, 0.15);
    if (game.time - (game.lastCenterWarn || -99) > 6) {
      game.lastCenterWarn = game.time;
      game.ui.toast('Die Ewige Flamme wird angegriffen!', 'danger');
      game.audio.play('alarm');
    }
  }
  if (b.hp > 0) return;
  b.hp = 0;
  game.effects.burst(b.x, b.y, { n: 30, color: ['#8e8a80', '#6b4a2a', '#3b3634', '#e8742a'], speed: 70, life: 0.9 });
  game.camera.addShake(4, 0.35);
  game.audio.play('collapse');
  if (b.type === 'center') {
    game.onCenterDestroyed();
    return;
  }
  // Schlafende Siedler fliehen aus dem einstürzenden Gebäude
  for (const s of [...b.sleepers]) game.settlers.wake(s, b);
  b.sleepers.length = 0;
  game.ui.toast(`${BUILDING_DEFS[b.type].name} wurde zerstört!`, 'danger');
  game.buildings.remove(b);
}

/** Schaden an einer Einheit (Siedler oder Spieler). */
export function damageUnit(game, u, dmg, kx = 0, ky = 0) {
  if (u.dead || u.hidden || u.invuln > 0) return;
  if (u === game.player) dmg *= u.armorMul;
  u.hp -= dmg;
  u.hurt = 0.15;
  u.lastHit = game.time;
  game.world.moveEntity(u, kx, ky, u.r, 'friendly');
  game.effects.burst(u.x, u.y - 8, { n: 5, color: ['#a8322c', '#7a1c18'], speed: 35, life: 0.4 });
  if (u === game.player) {
    game.camera.addShake(3, 0.2);
    game.audio.play('hurt');
    if (u.hp <= 0) u.die(game);
  }
}
