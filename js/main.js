// main.js – Einstiegspunkt: Spielzustand, fester Zeitschritt (Game Loop), Rendering-Reihenfolge.

import { TILE, STEP, START_STOCK, START_SETTLERS } from './config.js';
import { Input } from './input.js';
import { Camera } from './camera.js';
import { World } from './world.js';
import { Player } from './player.js';
import { Buildings, BUILDABLE } from './buildings.js';
import { Effects } from './particles.js';
import { Settlers } from './settlers.js';
import { UI } from './ui.js';
import { buildSprites, drawNode } from './sprites.js';

class Game {
  constructor() {
    this.canvas = document.getElementById('game');
    this.ctx = this.canvas.getContext('2d');
    this.input = new Input(this.canvas);
    this.camera = new Camera();
    this.time = 0;        // vergangene Spielzeit (für Animationen)
    this.acc = 0;         // Akkumulator des festen Zeitschritts
    this.last = performance.now();
    this.fps = 60;
    this.showFps = false;
    buildSprites();
    this.effects = new Effects();
    this.ui = new UI(this);
    window.addEventListener('resize', () => this.resize());
    this.resize();
    // ?seed=123 erzwingt eine bestimmte Welt (reproduzierbare Tests)
    const qs = new URLSearchParams(location.search).get('seed');
    this.newGame(qs ? Number(qs) >>> 0 : (Math.random() * 1e9) | 0);
    requestAnimationFrame((t) => this.frame(t));
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.floor(window.innerWidth * dpr);
    this.canvas.height = Math.floor(window.innerHeight * dpr);
    this.canvas.style.width = window.innerWidth + 'px';
    this.canvas.style.height = window.innerHeight + 'px';
    this.camera.resize(this.canvas.width, this.canvas.height);
  }

  newGame(seed) {
    this.world = new World(seed);
    this.world.renderTerrain();
    this.buildings = new Buildings(this.world);
    this.buildings.add('center', this.world.cx - 1, this.world.cy - 1);
    this.stock = { ...START_STOCK };
    this.stats = { built: 0, kills: 0, gathered: 0 };
    this.effects.clear();
    this.settlers = new Settlers();
    for (let i = 0; i < START_SETTLERS; i++) {
      const c = this.buildings.center;
      this.settlers.spawn(c.x - 16 + i * 16, c.y + 28);
    }
    this.arrivalT = 75;
    const cx = (this.world.cx + 0.5) * TILE, cy = (this.world.cy + 2.5) * TILE;
    this.player = new Player(cx, cy);
    this.camera.snap(cx, cy);
  }

  /** Haupt-Frame: Eingaben, feste Simulationsschritte, Rendering. */
  frame(ts) {
    const frameDt = Math.min(0.25, (ts - this.last) / 1000);
    this.last = ts;
    this.fps += (1 / Math.max(frameDt, 0.001) - this.fps) * 0.05;
    this.handleFrameInput();
    this.acc += frameDt;
    let steps = 0;
    while (this.acc >= STEP && steps < 8) {
      this.update(STEP);
      this.acc -= STEP;
      steps++;
    }
    if (steps >= 8) this.acc = 0; // Spirale des Todes vermeiden
    this.input.endFrame(); // Flanken werden ausschließlich in handleFrameInput ausgewertet
    this.render();
    requestAnimationFrame((t) => this.frame(t));
  }

  /** Eingaben mit Flanken (Tastendruck/Klick) – genau einmal pro Frame ausgewertet. */
  handleFrameInput() {
    const inp = this.input;
    // Abbrechen zuerst auswerten, damit Esc + neue Auswahl im selben Frame korrekt sind
    if ((inp.wasPressed('Escape') || inp.mouse.rightClicked) && this.buildings.selected) this.buildings.select(null);
    BUILDABLE.forEach((type, i) => {
      if (inp.wasPressed('Digit' + (i + 1), 'Numpad' + (i + 1))) this.buildings.select(type);
    });
    if (inp.wasPressed('KeyX')) this.buildings.select('demolish');
    this.buildings.updateBuildMode(this);
    if (inp.mouse.wheel) {
      this.camera.addZoom(-inp.mouse.wheel);
      inp.mouse.wheel = 0;
    }
    if (inp.wasPressed('F3')) this.showFps = !this.showFps;
  }

  /** Darf die linke Maustaste gerade als Spieleraktion gelten? */
  mouseActionAllowed() {
    return !this.buildings.selected;
  }

  update(dt) {
    this.time += dt;
    this.world.updateNodes(dt);
    this.player.update(dt, this);
    this.buildings.update(dt, this);
    this.settlers.update(dt, this);
    // Zuzug neuer Siedler in festen Abständen
    this.arrivalT -= dt;
    if (this.arrivalT <= 0) {
      this.arrivalT = 75;
      this.settlers.tryArrival(this, 1);
    }
    this.effects.update(dt);
    this.camera.follow(this.player.x, this.player.y - 8, dt);
  }

  render() {
    const { ctx, camera, world } = this;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#16202a';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    camera.apply(ctx);
    world.drawTerrain(ctx, camera, this.time);

    // Objekte nach y sortiert zeichnen (Tiefenwirkung)
    const list = [];
    const tx0 = Math.floor(camera.left / TILE) - 2, ty0 = Math.floor(camera.top / TILE) - 2;
    const tx1 = tx0 + Math.ceil(camera.viewW / TILE) + 4, ty1 = ty0 + Math.ceil(camera.viewH / TILE) + 4;
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        const n = world.nodeAtTile(tx, ty);
        if (n && !n.removed) list.push({ y: n.y + 4, draw: () => drawNode(ctx, n) });
      }
    }
    this.buildings.collectDrawables(list, ctx, camera, this.time);
    this.settlers.collectDrawables(list, ctx, camera, this.time);
    list.push({ y: this.player.y, draw: () => this.player.draw(ctx) });
    list.sort((a, b) => a.y - b.y);
    for (const d of list) d.draw();
    if (!this.buildings.selected) this.drawTargetMarker(ctx);
    this.buildings.drawGhost(ctx, this.time);
    this.effects.drawParticles(ctx);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.effects.drawTexts(ctx, camera);
    this.ui.update(1 / 60);
    if (this.showFps) {
      ctx.fillStyle = '#fff';
      ctx.font = '14px monospace';
      ctx.fillText(`${this.fps.toFixed(0)} FPS`, 10, this.canvas.height - 10);
    }
  }

  /** Pulsierende Eckklammern um das aktuelle Sammelziel. */
  drawTargetMarker(ctx) {
    const t = this.player.target;
    if (!t) return;
    const tx = t.kind === 'node' ? t.node.tx : t.tx, ty = t.kind === 'node' ? t.node.ty : t.ty;
    const x = tx * TILE, y = ty * TILE, o = Math.round(Math.sin(this.time * 6)) - 1;
    ctx.fillStyle = 'rgba(255,230,160,0.9)';
    for (const [cx, cy, sx, sy] of [[x, y, 1, 1], [x + TILE, y, -1, 1], [x, y + TILE, 1, -1], [x + TILE, y + TILE, -1, -1]]) {
      const px = cx + o * sx * -1, py = cy + o * sy * -1;
      ctx.fillRect(sx > 0 ? px : px - 4, sy > 0 ? py : py - 1, 4, 1);
      ctx.fillRect(sx > 0 ? px : px - 1, sy > 0 ? py : py - 4, 1, 4);
    }
  }
}

window.__game = new Game();
