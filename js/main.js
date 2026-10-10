// main.js – Einstiegspunkt: Spielzustand, fester Zeitschritt (Game Loop), Rendering-Reihenfolge.

import { TILE, STEP } from './config.js';
import { Input } from './input.js';
import { Camera } from './camera.js';
import { World } from './world.js';
import { Player } from './player.js';
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
    window.addEventListener('resize', () => this.resize());
    this.resize();
    this.newGame((Math.random() * 1e9) | 0);
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
      if (steps === 1) this.input.endFrame(); // Flanken nur im ersten Schritt auswerten
    }
    if (steps >= 8) this.acc = 0; // Spirale des Todes vermeiden
    this.render();
    requestAnimationFrame((t) => this.frame(t));
  }

  /** Eingaben, die unabhängig von der Simulation pro Frame gelten (Zoom, Debug). */
  handleFrameInput() {
    const inp = this.input;
    if (inp.mouse.wheel) {
      this.camera.addZoom(-inp.mouse.wheel);
      inp.mouse.wheel = 0;
    }
    if (inp.wasPressed('F3')) this.showFps = !this.showFps;
  }

  update(dt) {
    this.time += dt;
    this.player.update(dt, this);
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
    list.push({ y: this.player.y, draw: () => this.player.draw(ctx) });
    list.sort((a, b) => a.y - b.y);
    for (const d of list) d.draw();

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (this.showFps) {
      ctx.fillStyle = '#fff';
      ctx.font = '14px monospace';
      ctx.fillText(`${this.fps.toFixed(0)} FPS`, 10, this.canvas.height - 10);
    }
  }
}

window.__game = new Game();
