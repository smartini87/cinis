// intro.js – Intro-Sequenz beim ersten Spielstart (überspringbar mit jeder Taste oder einem Tipp):
// 1) Schwarzbild mit vier Sätzen im Schreibmaschinen-Stil und Wind,
// 2) Kamerafahrt über die Aschelandschaft zur Flamme (Parallax-Nebel, dichter Ascheregen),
// 3) Ankunft: Funken sammeln sich, Lichtblitz, die Figur steht auf, Zoom auf den Hüter – dann geht es los.

import { TILE } from './config.js';
import { STAND_UP } from './player.js';

const LINES = [
  'Rom ist gefallen. Die Stadt der sieben Hügel liegt unter Asche.',
  'Nachts erhebt sich die Asche – und sie hungert nach Licht.',
  'Nur eine Flamme brennt noch: die Ewige Flamme im Herzen der Ruinen.',
  'Sie hat dich als ihren Hüter gerufen. Halte sie am Leben.',
];
const TYPE_SPEED = 34;   // Zeichen pro Sekunde
const HOLD = 1.1;        // Pause nach jedem Satz
const FLIGHT = 6.5;      // Dauer der Kamerafahrt
const ARRIVE = 2.4;      // Ankunft bis zur Freigabe

const easeInOut = (k) => (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2);

export class Intro {
  constructor(game) {
    this.game = game;
    this.active = false;
    this.el = null;
  }

  /** Intro starten; onDone wird nach dem Ende (oder Überspringen) aufgerufen. */
  start(onDone) {
    const g = this.game;
    this.onDone = onDone;
    this.active = true;
    this.phase = 'text';
    this.t = 0;
    this.line = 0;
    this.gustT = 0;
    this.prevBias = g.camera.zoomBias;
    g.player.introHidden = true;
    g.setState('intro');
    g.ui.setHudVisible(false);
    g.ui.hideOverlay();
    // Schwarzes Text-Overlay
    const el = (this.el = document.createElement('div'));
    el.className = 'intro';
    el.innerHTML = '<div class="intro-lines"></div><div class="intro-skip">Beliebige Taste: überspringen</div>';
    g.ui.root.appendChild(el);
    this.linesEl = el.querySelector('.intro-lines');
    this.lineEls = LINES.map(() => {
      const p = document.createElement('p');
      this.linesEl.appendChild(p);
      return p;
    });
    // Kamerapfad: vom Rand der Aschefelder über die Ruinen zur Flamme
    const c = g.buildings.center, p = g.player.respawnPoint(g);
    this.path = [
      { x: c.x - 30 * TILE, y: c.y - 22 * TILE },
      { x: c.x + 14 * TILE, y: c.y - 16 * TILE },
      { x: p.x, y: p.y - 8 },
    ];
    g.camera.zoomBias = -1;
    g.camera.updateZoom();
    g.camera.snap(this.path[0].x, this.path[0].y);
    g.audio.play('gust', 0.8);
  }

  /** Überspringen: sofort in den Ankunftszustand und Steuerung freigeben. */
  skip() {
    if (!this.active) return;
    const g = this.game, p = g.player;
    p.introHidden = false;
    p.standT = 0;
    this.finish();
  }

  update(dt) {
    if (!this.active) return;
    const g = this.game;
    this.t += dt;
    g.time += dt;
    g.audio.setAmbience(0.9);
    this.gustT -= dt;
    if (this.gustT <= 0) {
      this.gustT = 3 + Math.random() * 3;
      g.audio.play('gust', 0.6);
    }
    if (this.phase === 'text') this.updateText();
    else if (this.phase === 'flight') this.updateFlight();
    else this.updateArrival(dt);
    // Dichter Ascheregen über der ganzen Szene
    const cam = g.camera;
    if (Math.random() < dt * 30) {
      g.effects.burst(cam.left + Math.random() * cam.viewW, cam.top - 4, { n: 1, color: ['#8a8580', '#b9b4a8', '#5a5450', '#e8742a'], speed: 10, life: 7, up: -12, gravity: 5, drag: 0.1 });
    }
  }

  /** Sätze nacheinander tippen; danach wird das Schwarz ausgeblendet. */
  updateText() {
    let t = this.t, done = true;
    for (let i = 0; i < LINES.length; i++) {
      const len = LINES[i].length, dur = len / TYPE_SPEED;
      const n = Math.max(0, Math.min(len, Math.floor(t * TYPE_SPEED)));
      const txt = LINES[i].slice(0, n);
      if (this.lineEls[i].textContent !== txt) this.lineEls[i].textContent = txt;
      this.lineEls[i].classList.toggle('typing', n > 0 && n < len);
      t -= dur + HOLD;
      if (t < 0) {
        done = false;
        break;
      }
    }
    if (done) {
      this.phase = 'flight';
      this.t = 0;
      this.el.classList.add('fade');
    }
  }

  /** Kamerafahrt entlang einer quadratischen Bézierkurve. */
  updateFlight() {
    const g = this.game, k = easeInOut(Math.min(1, this.t / FLIGHT));
    const [a, b, c] = this.path, u = 1 - k;
    g.camera.snap(u * u * a.x + 2 * u * k * b.x + k * k * c.x, u * u * a.y + 2 * u * k * b.y + k * k * c.y);
    if (this.t >= FLIGHT) {
      this.phase = 'arrive';
      this.t = 0;
      this.flashed = false;
      const p = g.player;
      g.effects.converge(p.x, p.y - 8, { n: 60, radius: 52, life: 0.9, color: ['#ffd36a', '#fff3c4', '#f0a53a', '#e8742a'] });
      g.audio.play('respawnCharge', 0.7);
    }
  }

  /** Ankunft: Lichtblitz, Aufstehen, Zoom auf die Figur. */
  updateArrival(dt) {
    const g = this.game, p = g.player;
    if (!this.flashed && this.t >= 0.9) {
      this.flashed = true;
      p.introHidden = false;
      p.standT = STAND_UP + 0.3;
      g.flashT = 0.35;
      const c = g.buildings.center;
      if (c) c.pulse = 1;
      g.camera.addShake(2, 0.25);
      g.effects.burst(p.x, p.y - 8, { n: 26, color: ['#ffd36a', '#fff3c4'], speed: 55, life: 0.8, up: 30 });
      g.audio.play('respawn');
      g.camera.zoomBias = this.prevBias + 1;
      g.camera.updateZoom();
    }
    if (this.flashed && p.standT > 0) p.standT -= dt;
    g.camera.snap(p.x, p.y - 8);
    if (this.t >= ARRIVE) this.finish();
  }

  finish() {
    const g = this.game;
    this.active = false;
    if (this.el) this.el.remove();
    this.el = null;
    g.camera.zoomBias = this.prevBias;
    g.camera.updateZoom();
    g.camera.snap(g.player.x, g.player.y - 8);
    const done = this.onDone;
    this.onDone = null;
    if (done) done();
  }

  /** Parallax-Nebel- und Aschebänder über der Welt (Bildschirmkoordinaten) während der Kamerafahrt. */
  drawParallax(ctx) {
    if (!this.active || this.phase === 'text') return;
    const g = this.game, cam = g.camera, W = cam.vw, H = cam.vh;
    const fade = this.phase === 'flight' ? Math.min(1, this.t / 1.5) * (1 - Math.max(0, (this.t - FLIGHT + 1.5) / 1.5) * 0.7) : Math.max(0, 0.3 - this.t * 0.3);
    if (fade <= 0) return;
    ctx.save();
    for (const [speed, alpha, color, h] of [[0.25, 0.22, '70,62,58', 0.5], [0.6, 0.16, '110,98,90', 0.35], [1.2, 0.12, '160,140,120', 0.22]]) {
      const off = (-cam.x * speed * cam.zoom) % W;
      for (let i = -1; i <= 2; i++) {
        const x = off + i * W, y = H * (1 - h) + Math.sin((cam.x * speed) / 140 + i) * H * 0.05;
        const grd = ctx.createLinearGradient(0, y, 0, y + H * h);
        grd.addColorStop(0, `rgba(${color},0)`);
        grd.addColorStop(0.5, `rgba(${color},${alpha * fade})`);
        grd.addColorStop(1, `rgba(${color},${alpha * 0.4 * fade})`);
        ctx.fillStyle = grd;
        ctx.beginPath();
        ctx.ellipse(x + W / 2, y + H * h * 0.6, W * 0.75, H * h * 0.6, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    // Vignette für den Kinolook
    const v = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.max(W, H) * 0.75);
    v.addColorStop(0, 'rgba(0,0,0,0)');
    v.addColorStop(1, `rgba(0,0,0,${0.6 * fade})`);
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, W, H);
    // Kinobalken
    const bar = Math.round(H * 0.08 * Math.min(1, fade * 2));
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, bar);
    ctx.fillRect(0, H - bar, W, bar);
    ctx.restore();
  }
}
