// main.js – Einstiegspunkt: Spielzustand, fester Zeitschritt (Game Loop), Spielereignisse
// (Dämmerung/Nacht/Morgen, Sieg/Niederlage) und Render-Reihenfolge.

import { TILE, STEP, START_STOCK, START_SETTLERS, WIN_NIGHTS, RUBBLE_PER_DAY } from './config.js';
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
import { SoundEngine } from './audio.js';
import { saveGame, loadGame, deleteSave } from './save.js';
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
    this.state = 'menu';  // menu | tutorial | playing | paused | over
    this.speed = 1;       // Spieltempo (1×, 2×, 3×)
    this.saveT = 0;
    buildSprites();
    this.audio = new SoundEngine();
    this.effects = new Effects();
    this.combat = new Combat();
    this.enemies = new Enemies();
    this.lighting = new Lighting();
    this.ui = new UI(this);
    window.addEventListener('resize', () => this.resize());
    this.resize();
    // ?seed=123 erzwingt eine bestimmte Welt (reproduzierbare Tests), ?play überspringt das Menü
    const qs = new URLSearchParams(location.search);
    this.fixedSeed = qs.has('seed') ? Number(qs.get('seed')) >>> 0 : null;
    this.newGame(this.randomSeed());
    if (qs.has('play')) this.setState('playing');
    else this.toMainMenu();
    // Beim Verlassen/Verstecken der Seite speichern
    const persist = () => {
      if (this.state === 'playing' || this.state === 'paused') saveGame(this);
    };
    window.addEventListener('pagehide', persist);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        persist();
        if (this.state === 'playing') this.pause();
      }
    });
    requestAnimationFrame((t) => this.frame(t));
  }

  randomSeed() {
    return this.fixedSeed ?? ((Math.random() * 1e9) | 0);
  }

  // ---------------------------------------------------------------- Zustände
  setState(st) {
    this.state = st;
    this.ui.setHudVisible(st !== 'menu');
    if (st === 'playing') this.ui.hideOverlay();
    this.last = performance.now();
    this.acc = 0;
  }

  toMainMenu() {
    if (this.state === 'playing' || this.state === 'paused') saveGame(this);
    this.buildings.select(null);
    // Hintergrund: eine frische Welt, über die die Kamera langsam schwenkt
    this.newGame(this.randomSeed());
    this.setState('menu');
    this.ui.showMainMenu();
  }

  startNewGame() {
    deleteSave();
    this.newGame(this.randomSeed());
    let done = false;
    try {
      done = localStorage.getItem('cinis.tutorialDone') === '1';
    } catch {
      done = false;
    }
    const begin = () => {
      try {
        localStorage.setItem('cinis.tutorialDone', '1');
      } catch {
        /* Speicher nicht verfügbar: Tutorial erscheint beim nächsten Mal erneut */
      }
      this.setState('playing');
      this.ui.toast('Sammle Holz und Stein und baue eine Hütte. Die erste Nacht kommt bald.', 'info');
      saveGame(this);
    };
    if (done) begin();
    else {
      this.setState('tutorial');
      this.ui.showTutorial(begin);
    }
  }

  continueGame() {
    if (loadGame(this)) {
      this.setState('playing');
      this.ui.toast(`Willkommen zurück – Tag ${this.cycle.day}.`, 'good');
    } else {
      this.ui.toast('Spielstand konnte nicht geladen werden.', 'danger');
      this.startNewGame();
    }
  }

  pause() {
    if (this.state !== 'playing') return;
    this.buildings.select(null);
    this.setState('paused');
    this.ui.showPause();
  }

  resume() {
    if (this.state === 'paused') this.setState('playing');
  }

  showHelp() {
    if (this.state !== 'playing') return;
    this.setState('paused');
    this.ui.showHelp(() => this.resume());
  }

  cycleSpeed() {
    this.speed = this.speed >= 3 ? 1 : this.speed + 1;
    this.audio.play('click');
  }

  toggleSound() {
    this.audio.toggle();
    if (!this.audio.muted) this.audio.play('click');
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.floor(window.innerWidth * dpr);
    this.canvas.height = Math.floor(window.innerHeight * dpr);
    this.canvas.style.width = window.innerWidth + 'px';
    this.canvas.style.height = window.innerHeight + 'px';
    this.camera.resize(this.canvas.width, this.canvas.height);
  }

  /** Neue Welt aufbauen. opts.empty: keine Start-Siedler (beim Laden). */
  newGame(seed, opts = {}) {
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
    for (let i = 0; i < (opts.empty ? 0 : START_SETTLERS); i++) {
      const c = this.buildings.center;
      this.settlers.spawn(c.x - 16 + i * 16, c.y + 28);
    }
    const cx = (this.world.cx + 0.5) * TILE, cy = (this.world.cy + 2.5) * TILE;
    this.player = new Player(cx, cy);
    this.camera.snap(cx, cy);
    this.over = null;
    this.time = 0;
    this.saveT = 0;
  }

  /** Haupt-Frame: Eingaben, feste Simulationsschritte, Rendering. */
  frame(ts) {
    const frameDt = Math.min(0.25, (ts - this.last) / 1000);
    this.last = ts;
    this.fps += (1 / Math.max(frameDt, 0.001) - this.fps) * 0.05;
    this.handleFrameInput();
    if (this.state === 'playing') {
      this.acc += frameDt * this.speed;
      const maxSteps = 8 * this.speed;
      let steps = 0;
      while (this.acc >= STEP && steps < maxSteps) {
        this.update(STEP);
        this.acc -= STEP;
        steps++;
        if (this.state !== 'playing') break;
      }
      if (steps >= maxSteps) this.acc = 0; // Spirale des Todes vermeiden
    } else if (this.state === 'menu') {
      // Langsamer Kameraschwenk im Hauptmenü
      this.time += frameDt;
      const c = this.buildings.center;
      this.camera.snap(c.x + Math.cos(this.time * 0.05) * 160, c.y + Math.sin(this.time * 0.07) * 110);
      this.effects.update(frameDt);
    }
    this.input.endFrame(); // Flanken werden ausschließlich in handleFrameInput ausgewertet
    this.render();
    requestAnimationFrame((t) => this.frame(t));
  }

  /** Eingaben mit Flanken (Tastendruck/Klick) – genau einmal pro Frame ausgewertet. */
  handleFrameInput() {
    const inp = this.input;
    if (inp.wasPressed('KeyM')) this.toggleSound();
    if (this.state === 'paused' && inp.wasPressed('Escape', 'KeyP')) {
      this.resume();
      return;
    }
    if (this.state !== 'playing') return;
    if (inp.wasPressed('KeyP') || (inp.wasPressed('Escape') && !this.buildings.selected)) {
      this.pause();
      return;
    }
    if (inp.wasPressed('KeyF')) this.cycleSpeed();
    if (inp.wasPressed('KeyH')) {
      this.showHelp();
      return;
    }
    // Abbrechen zuerst auswerten, damit Esc + neue Auswahl im selben Frame korrekt sind
    if ((inp.wasPressed('Escape') || inp.mouse.rightClicked) && this.buildings.selected) this.buildings.select(null);
    BUILDABLE.forEach((type, i) => {
      if (inp.wasPressed('Digit' + (i + 1), 'Numpad' + (i + 1))) this.buildings.select(type);
    });
    if (inp.wasPressed('KeyX')) this.buildings.select('demolish');
    if (!this.player.dead) this.buildings.updateBuildMode(this);
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
    this.ambientEffects(dt);
    this.effects.update(dt);
    this.camera.follow(this.player.x, this.player.y - 8, dt);
    // Autospeichern alle 30 Spielsekunden
    this.saveT += dt;
    if (this.saveT >= 30) {
      this.saveT = 0;
      saveGame(this);
    }
  }

  /** Atmosphäre: Glut über der Flamme, treibende Ascheflocken, Staub beim Laufen. */
  ambientEffects(dt) {
    const fx = this.effects, cam = this.camera, c = this.buildings.center;
    if (c && c.hp > 0 && cam.visible(c.x, c.y, 1, 1, 64) && Math.random() < dt * 14) {
      fx.burst(c.x + (Math.random() - 0.5) * 8, c.y - 22, { n: 1, color: ['#ffd36a', '#f0a53a', '#e8742a'], speed: 12, life: 1.4, up: 28, gravity: -12, drag: 0.6 });
    }
    // Ascheflocken (nachts dichter)
    if (Math.random() < dt * (3 + this.cycle.darkness * 6)) {
      fx.burst(cam.left + Math.random() * cam.viewW, cam.top - 4, { n: 1, color: ['#8a8580', '#b9b4a8', '#5a5450'], speed: 8, life: 6, up: -10, gravity: 4, drag: 0.1 });
    }
    const p = this.player;
    if (p.moving && !p.dead) {
      p.dustT = (p.dustT || 0) - dt;
      if (p.dustT <= 0) {
        p.dustT = 0.22;
        fx.burst(p.x, p.y, { n: 2, color: ['rgba(160,140,110,0.7)'], speed: 10, life: 0.4, up: 6, gravity: 10 });
      }
    }
    this.audio.setAmbience(this.cycle.darkness);
  }

  // ---------------------------------------------------------------- Spielereignisse
  onDusk(day) {
    this.enemies.planNight(day, this);
    this.ui.toast(`Die Dämmerung naht. Nacht ${day}: ${this.enemies.describePlan()}`, 'warn');
    this.audio.play('horn');
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
    this.audio.play('bell');
    this.settlers.tryArrival(this, 1);
    this.world.crumbleRuins(RUBBLE_PER_DAY);
    if (saveGame(this)) this.ui.toast('Spielstand gesichert.', 'info', 'saved');
  }

  onCenterDestroyed() {
    this.endGame('defeat');
  }

  endGame(result) {
    if (this.over) return;
    this.over = result;
    this.buildings.select(null);
    deleteSave();
    this.setState('over');
    this.audio.play(result === 'victory' ? 'victory' : 'defeat');
    // Kurz verzögert, damit der Einsturz bzw. der Morgen noch sichtbar ist
    setTimeout(() => this.ui.showEnd(result), 1200);
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
    if (this.state !== 'menu') {
      this.enemies.drawIndicators(ctx, camera);
      this.ui.drawMinimap();
      this.drawJoystick(ctx);
    }
    this.ui.update(1 / 60);
    if (this.showFps) {
      ctx.fillStyle = '#fff';
      ctx.font = '14px monospace';
      ctx.fillText(`${this.fps.toFixed(0)} FPS`, 10, this.canvas.height - 10);
    }
  }

  /** Virtueller Joystick bei Touch-Bedienung. */
  drawJoystick(ctx) {
    const st = this.input.stick;
    if (!st.active) return;
    const dpr = window.devicePixelRatio || 1;
    ctx.strokeStyle = 'rgba(255,230,160,0.5)';
    ctx.lineWidth = 2 * dpr;
    ctx.beginPath();
    ctx.arc(st.ox, st.oy, 60 * dpr, 0, Math.PI * 2);
    ctx.stroke();
    const dx = st.x - st.ox, dy = st.y - st.oy, l = Math.hypot(dx, dy), k = l > 60 * dpr ? (60 * dpr) / l : 1;
    ctx.fillStyle = 'rgba(255,230,160,0.45)';
    ctx.beginPath();
    ctx.arc(st.ox + dx * k, st.oy + dy * k, 24 * dpr, 0, Math.PI * 2);
    ctx.fill();
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
