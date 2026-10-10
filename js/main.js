// main.js – Einstiegspunkt: Spielzustand, fester Zeitschritt (Game Loop), Spielereignisse
// (Dämmerung/Nacht/Morgen, Sieg/Niederlage) und Render-Reihenfolge.

import { TILE, STEP, START_STOCK, START_SETTLERS, WIN_NIGHTS } from './config.js';
import { Input } from './input.js';
import { Camera } from './camera.js';
import { World } from './world.js';
import { Player } from './player.js';
import { Buildings, BUILDABLE } from './buildings.js';
import { Effects } from './particles.js';
import { Settlers } from './settlers.js';
import { Enemies } from './enemies.js';
import { Combat } from './combat.js';
import { DayCycle, Lighting } from './time.js';
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
    this.over = null;     // null | 'defeat' | 'victory'
    buildSprites();
    this.effects = new Effects();
    this.combat = new Combat();
    this.enemies = new Enemies();
    this.lighting = new Lighting();
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
    this.seed = seed;
    this.world = new World(seed);
    this.world.renderTerrain();
    this.buildings = new Buildings(this.world);
    this.buildings.add('center', this.world.cx - 1, this.world.cy - 1);
    this.stock = { ...START_STOCK };
    this.stats = { built: 0, kills: 0, gathered: 0, lost: 0 };
    this.effects.clear();
    this.combat.clear();
    this.enemies.clear();
    this.cycle = new DayCycle();
    this.settlers = new Settlers();
    for (let i = 0; i < START_SETTLERS; i++) {
      const c = this.buildings.center;
      this.settlers.spawn(c.x - 16 + i * 16, c.y + 28);
    }
    const cx = (this.world.cx + 0.5) * TILE, cy = (this.world.cy + 2.5) * TILE;
    this.player = new Player(cx, cy);
    this.camera.snap(cx, cy);
    this.over = null;
  }

  /** Haupt-Frame: Eingaben, feste Simulationsschritte, Rendering. */
  frame(ts) {
    const frameDt = Math.min(0.25, (ts - this.last) / 1000);
    this.last = ts;
    this.fps += (1 / Math.max(frameDt, 0.001) - this.fps) * 0.05;
    this.handleFrameInput();
    if (!this.over) {
      this.acc += frameDt;
      let steps = 0;
      while (this.acc >= STEP && steps < 8) {
        this.update(STEP);
        this.acc -= STEP;
        steps++;
      }
      if (steps >= 8) this.acc = 0; // Spirale des Todes vermeiden
    }
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
    if (!this.over && !this.player.dead) this.buildings.updateBuildMode(this);
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
    this.cycle.update(dt, this);
    if (this.buildings.changed) {
      this.world.computeFlowField();
      this.buildings.changed = false;
    }
    this.world.updateNodes(dt);
    this.player.update(dt, this);
    this.buildings.update(dt, this);
    this.settlers.update(dt, this);
    this.enemies.update(dt, this);
    this.combat.update(dt, this);
    this.effects.update(dt);
    this.camera.follow(this.player.x, this.player.y - 8, dt);
  }

  // ---------------------------------------------------------------- Spielereignisse
  onDusk(day) {
    this.enemies.planNight(day, this);
    this.ui.toast(`Die Dämmerung naht. Nacht ${day}: ${this.enemies.describePlan()}`, 'warn');
    this.audio?.play('horn');
  }

  onNight(day) {
    this.enemies.startNight();
    this.ui.toast(`Nacht ${day} bricht herein – verteidigt die Flamme!`, 'danger');
  }

  onDawn(day) {
    if (day > WIN_NIGHTS) {
      this.endGame('victory');
      return;
    }
    this.ui.toast(`Tag ${day} von ${WIN_NIGHTS}. Die Asche weicht dem Licht.`, 'good');
    this.audio?.play('bell');
    this.settlers.tryArrival(this, 2);
  }

  onCenterDestroyed() {
    this.endGame('defeat');
  }

  endGame(result) {
    if (this.over) return;
    this.over = result;
    this.buildings.select(null);
    if (result === 'victory') this.ui.toast(`Sieg! ${WIN_NIGHTS} Nächte überstanden – die Flamme brennt weiter.`, 'good');
    else this.ui.toast('Die Ewige Flamme ist erloschen. Rom ist verloren.', 'danger');
  }

  // ---------------------------------------------------------------- Rendering
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
    this.enemies.collectDrawables(list, ctx, camera, this.time);
    list.push({ y: this.player.y, draw: () => this.player.draw(ctx) });
    list.sort((a, b) => a.y - b.y);
    for (const d of list) d.draw();
    this.combat.draw(ctx);
    this.effects.drawParticles(ctx);

    // Beleuchtung, danach Bedienelemente in der Welt (bleiben nachts gut sichtbar)
    this.lighting.draw(ctx, this);
    camera.apply(ctx);
    if (!this.buildings.selected) this.drawTargetMarker(ctx);
    this.buildings.drawGhost(ctx, this.time);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.effects.drawTexts(ctx, camera);
    this.enemies.drawIndicators(ctx, camera);
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
    if (!t || this.player.dead) return;
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
