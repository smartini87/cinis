// particles.js – visuelle Effekte: Partikel (Splitter, Funken, Asche) und schwebende Texte.

const MAX_PARTICLES = 900;

export class Effects {
  constructor() {
    this.particles = [];
    this.texts = [];
    this.corpses = [];   // zerfallende Figuren { draw(ctx, k), life, max }
  }

  clear() {
    this.particles.length = 0;
    this.texts.length = 0;
    this.corpses.length = 0;
  }

  /**
   * Funken, die aus einem Ring auf einen Punkt zufliegen und dort nach o.life Sekunden ankommen
   * (Rückkehr an der Flamme, Ankunft im Intro).
   */
  converge(x, y, o = {}) {
    const n = o.n ?? 30, life = o.life ?? 0.8, rad = o.radius ?? 40;
    const colors = Array.isArray(o.color) ? o.color : [o.color ?? '#ffd36a'];
    for (let i = 0; i < n && this.particles.length < MAX_PARTICLES; i++) {
      const a = Math.random() * Math.PI * 2, r = rad * (0.6 + Math.random() * 0.6);
      const l = life * (0.75 + Math.random() * 0.25);
      this.particles.push({
        x: x + Math.cos(a) * r, y: y + Math.sin(a) * r * 0.7,
        vx: (-Math.cos(a) * r) / l, vy: (-Math.sin(a) * r * 0.7) / l,
        life: l, max: l * 2, size: Math.random() < 0.3 ? 2 : 1, g: 0, drag: 0,
        color: colors[(Math.random() * colors.length) | 0],
      });
    }
  }

  /** Zerfallende Figur: draw(ctx, k) mit k = 0..1 (Fortschritt), wird ausgeblendet. */
  corpse(draw, life = 0.6) {
    this.corpses.push({ draw, life, max: life });
  }

  /**
   * Partikelstoß erzeugen.
   * o: { n, color(s), speed, life, size, gravity, up (Anfangsauftrieb), spread }
   */
  burst(x, y, o = {}) {
    const n = o.n ?? 6;
    const colors = Array.isArray(o.color) ? o.color : [o.color ?? '#fff'];
    for (let i = 0; i < n && this.particles.length < MAX_PARTICLES; i++) {
      const a = o.angle !== undefined ? o.angle + (Math.random() - 0.5) * (o.spread ?? Math.PI * 2) : Math.random() * Math.PI * 2;
      const sp = (o.speed ?? 40) * (0.4 + Math.random() * 0.8);
      this.particles.push({
        x, y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - (o.up ?? 20),
        life: (o.life ?? 0.6) * (0.6 + Math.random() * 0.6),
        max: o.life ?? 0.6,
        size: o.size ?? 1,
        g: o.gravity ?? 120,
        color: colors[(Math.random() * colors.length) | 0],
        drag: o.drag ?? 1.5,
      });
    }
  }

  /** Schwebender Text (z. B. „+1"), steigt auf und verblasst. */
  text(x, y, str, color = '#fff') {
    this.texts.push({ x, y, str, color, life: 1.1 });
  }

  update(dt) {
    const ps = this.particles;
    for (let i = ps.length - 1; i >= 0; i--) {
      const p = ps[i];
      p.life -= dt;
      if (p.life <= 0) {
        ps[i] = ps[ps.length - 1];
        ps.pop();
        continue;
      }
      p.vy += p.g * dt;
      const k = Math.max(0, 1 - p.drag * dt);
      p.vx *= k;
      p.vy *= k;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
    for (let i = this.corpses.length - 1; i >= 0; i--) {
      const c = this.corpses[i];
      c.life -= dt;
      if (c.life <= 0) this.corpses.splice(i, 1);
    }
    for (let i = this.texts.length - 1; i >= 0; i--) {
      const t = this.texts[i];
      t.life -= dt;
      t.y -= 14 * dt;
      if (t.life <= 0) this.texts.splice(i, 1);
    }
  }

  /** Zerfallende Figuren in Weltkoordinaten zeichnen (sinken ein und verblassen). */
  drawCorpses(ctx) {
    for (const c of this.corpses) {
      const k = 1 - c.life / c.max;
      ctx.globalAlpha = Math.min(1, (1 - k) * 1.6);
      c.draw(ctx, k);
    }
    ctx.globalAlpha = 1;
  }

  /** Partikel in Weltkoordinaten zeichnen. */
  drawParticles(ctx) {
    for (const p of this.particles) {
      ctx.globalAlpha = Math.min(1, p.life / (p.max * 0.5));
      ctx.fillStyle = p.color;
      ctx.fillRect(Math.round(p.x), Math.round(p.y), p.size, p.size);
    }
    ctx.globalAlpha = 1;
  }

  /** Texte in Bildschirmkoordinaten zeichnen (scharfe Schrift unabhängig vom Zoom). */
  drawTexts(ctx, cam) {
    const fs = Math.max(11, Math.round(cam.zoom * 4.5));
    ctx.font = `bold ${fs}px Georgia, serif`;
    ctx.textAlign = 'center';
    for (const t of this.texts) {
      const s = cam.worldToScreen(t.x, t.y);
      ctx.globalAlpha = Math.min(1, t.life * 2);
      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      ctx.fillText(t.str, s.x + 1, s.y + 1);
      ctx.fillStyle = t.color;
      ctx.fillText(t.str, s.x, s.y);
    }
    ctx.globalAlpha = 1;
    ctx.textAlign = 'left';
  }
}
