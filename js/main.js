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
import { saveGame, loadGame, deleteSave, discardOldSaves } from './save.js';
import { buildSprites, drawNode } from './sprites.js';
import { SpatialHash, separateUnits, resolve } from './physics.js';
import { Interact } from './interact.js';
import { Loot } from './loot.js';
import { Wildlife } from './wildlife.js';
import { Progress } from './progress.js';
import { drawEdgeArrow } from './ui.js';

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
    this.unitHash = new SpatialHash(32);
    this.flowT = 0;
    buildSprites();
    this.audio = new SoundEngine();
    this.effects = new Effects();
    this.combat = new Combat();
    this.enemies = new Enemies();
    this.lighting = new Lighting();
    this.interact = new Interact();
    this.loot = new Loot();
    this.wildlife = new Wildlife();
    this.noises = [];     // Kampflärm { x, y, r, t } – schreckt Tiere auf
    this.interact.addProvider(this.loot.provider);
    this.interact.addProvider((g, out) => {
      // Jagdbare Tiere in Reichweite: Glow + „Jagen“
      const p = g.player;
      for (const a of g.wildlife.list) {
        if (a.dead || a.def.cls !== 'game' || Math.abs(a.x - p.x) > 30 || Math.abs(a.y - p.y) > 30) continue;
        out.push({ kind: 'animal', obj: a, x: a.x, y: a.y, label: `${a.def.name} jagen`, promptH: (a.def.h || 8) + 6, prio: -2, reach: 28,
          hit: (mx, my) => Math.abs(mx - a.x) < 8 && Math.abs(my - a.y + 4) < 8,
          act: (gg) => { gg.player.faceTowards(a.x, a.y); gg.player.startAttack(gg); } });
      }
    });
    this.hitStop = 0;     // Trefferpause in Simulationsschritten
    this.flashT = 0;      // weißer Bildschirmblitz (Respawn)
    this.ui = new UI(this);
    window.addEventListener('resize', () => this.resize());
    this.resize();
    // ?seed=123 erzwingt eine bestimmte Welt (reproduzierbare Tests), ?play überspringt das Menü
    const qs = new URLSearchParams(location.search);
    this.fixedSeed = qs.has('seed') ? Number(qs.get('seed')) >>> 0 : null;
    this.skipTutorial = qs.has('skiptut');
    this.newGame(this.randomSeed());
    const oldSave = discardOldSaves();
    if (qs.has('play')) this.setState('playing');
    else this.toMainMenu();
    if (oldSave) this.ui.toast('Ein Spielstand aus einer älteren Version war nicht kompatibel und wurde verworfen.', 'warn');
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

  /** Neues Spiel; opts.skipTutorial schaltet alles frei (ohne geführten Einstieg). */
  startNewGame(opts = {}) {
    deleteSave();
    this.skipTutorial = !!opts.skipTutorial;
    this.newGame(this.randomSeed());
    this.setState('playing');
    if (this.skipTutorial) this.ui.toast('Halte die Ewige Flamme am Leben – so viele Nächte wie möglich.', 'info');
    saveGame(this);
  }

  continueGame() {
    if (loadGame(this)) {
      this.setState('playing');
      this.ui.applyUnlocks();
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
    this.progress = new Progress(this);
    if (this.skipTutorial) this.progress.unlockAll();
    this.effects.clear();
    this.loot.clear();
    this.wildlife.clear();
    this.noises.length = 0;
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
    if (inp.wasPressed('ShiftLeft', 'ShiftRight')) this.player.requestDash = true;
    if (inp.wasPressed('KeyH')) {
      this.showHelp();
      return;
    }
    // Abbrechen zuerst auswerten, damit Esc + neue Auswahl im selben Frame korrekt sind
    if ((inp.wasPressed('Escape') || inp.mouse.rightClicked) && this.buildings.selected) this.buildings.select(null);
    BUILDABLE.forEach((type, i) => {
      if (inp.wasPressed('Digit' + (i + 1), 'Numpad' + (i + 1)) && this.progress.has('b:' + type)) this.buildings.select(type);
    });
    if (inp.wasPressed('KeyX') && this.progress.has('demolish')) this.buildings.select('demolish');
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

  /** Ruft fn für alles Treffbare auf (ohne Array-Aufbau). */
  forEachHittable(fn) {
    for (const e of this.enemies.list) if (!e.dead) fn(e);
    for (const a of this.wildlife.list) if (!a.dead && a.def.cls !== 'deco') fn(a);
  }

  /** Alles, was der Spieler treffen kann: Gegner und nicht-dekorative Tiere. */
  hittables() {
    const out = this._hit || (this._hit = []);
    out.length = 0;
    for (const e of this.enemies.list) out.push(e);
    for (const a of this.wildlife.list) if (!a.dead && a.def.cls !== 'deco') out.push(a);
    return out;
  }

  /** Treffer durch den Spieler an eine Einheit weiterleiten. */
  hitUnit(e, dmg, kx, ky) {
    if (e.animal) this.wildlife.hit(e, dmg, this, kx, ky);
    else this.enemies.hit(e, dmg, this, kx, ky);
  }

  /** Kampflärm: schreckt Tiere im Umkreis r auf. */
  noise(x, y, r) {
    if (this.noises.length < 24) this.noises.push({ x, y, r, t: 0.4 });
  }

  /**
   * Lichtstärke 0..1 an einem Punkt (Flamme, Hütten, Türme; später Feuerschalen und Fackeln).
   * Nachts relevant: Wölfe meiden Licht.
   */
  lightAt(x, y) {
    let best = 0;
    for (const s of this.lightSources()) {
      const dx = x - s.x, dy = y - s.y;
      if (dx > s.r || dx < -s.r || dy > s.r || dy < -s.r) continue;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < s.r) best = Math.max(best, s.k * (1 - d / s.r) * 1.6);
    }
    return Math.min(1, best);
  }

  /** Feste Lichtquellen (für lightAt und Wildlife); zwischengespeichert bis zur nächsten Belegungsänderung. */
  lightSources() {
    const c = this.buildings.center, key = this.buildings.version * 2 + (c && c.hp > 0 ? 1 : 0);
    if (this._lights && this._lightsKey === key) return this._lights;
    const out = [];
    for (const b of this.buildings.list) {
      if (b.type === 'center' && b.hp > 0) out.push({ x: b.x, y: b.y - 8, r: 150, k: 1 });
      else if (b.type === 'hut') out.push({ x: b.x, y: b.y, r: 44, k: 0.75 });
      else if (b.type === 'tower') out.push({ x: b.x, y: b.y - 14, r: 58, k: 0.8 });
    }
    this._lights = out;
    this._lightsKey = key;
    return out;
  }

  update(dt) {
    if (this.flashT > 0) this.flashT -= dt;
    // Trefferpause: die Welt hält für wenige Schritte inne (Wucht des Schlags)
    if (this.hitStop > 0) {
      this.hitStop--;
      return;
    }
    this.time += dt;
    // Im geführten Einstieg steht die Uhr, bis die erste Nacht eingeführt wird
    if (this.progress.clockRunning) this.cycle.update(dt, this);
    this.progress.update();
    // Flussfeld sofort bei Gebäudeänderungen; Baum/Fels-Änderungen nur, solange Gegner unterwegs sind,
    // und höchstens alle 4 s (gefällte Bäume ändern die Wege kaum)
    this.flowT -= dt;
    const foes = this.enemies.list.length > 0;
    if (this.buildings.changed || (this.world.nodesChanged && foes && this.flowT <= 0)) {
      if (this.buildings.changed) this.ejectUnits();
      this.world.computeFlowField();
      this.buildings.changed = false;
      this.flowT = 4;
    }
    // Nachwachsen 4× pro Sekunde reicht
    this.nodeT = (this.nodeT || 0) + dt;
    if (this.nodeT >= 0.25) {
      this.world.updateNodes(this.nodeT);
      this.nodeT = 0;
    }
    this.player.update(dt, this);
    this.buildings.update(dt, this);
    this.settlers.update(dt, this);
    this.enemies.update(dt, this);
    this.wildlife.update(dt, this);
    for (let i = this.noises.length - 1; i >= 0; i--) if ((this.noises[i].t -= dt) <= 0) this.noises.splice(i, 1);
    this.combat.update(dt, this);
    this.separateAll();
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

  /** Nach einer Belegungsänderung: Einheiten aus neu gebauten Gebäuden an den Rand schieben. */
  ejectUnits() {
    const w = this.world, p = this.player;
    if (!p.dead) resolve(w, p, p.r, 'friendly');
    for (const s of this.settlers.list) if (!s.hidden) resolve(w, s, s.r, 'friendly');
    for (const e of this.enemies.list) if (!e.dead) resolve(w, e, e.r, 'enemy');
  }

  /** Alle Einheiten auseinanderschieben (Spieler schwer, Gegner nach Größe). */
  separateAll() {
    // Einträge werden wiederverwendet (keine Allokation pro Schritt)
    const units = this._units || (this._units = []), pool = this._unitPool || (this._unitPool = []);
    units.length = 0;
    const add = (e, mask, mass) => {
      const u = pool[units.length] || (pool[units.length] = {});
      u.e = e;
      u.mask = mask;
      u.mass = mass;
      units.push(u);
    };
    const p = this.player;
    if (!p.dead) add(p, 'friendly', 3);
    for (const s of this.settlers.list) if (!s.hidden) add(s, 'friendly', 1);
    for (const e of this.enemies.list) if (!e.dead) add(e, 'enemy', e.r * e.r * 0.1);
    for (const a of this.wildlife.list) if (!a.dead && a.def.cls !== 'deco') add(a, 'animal', a.r * a.r * 0.08);
    separateUnits(this.world, units, this.unitHash);
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
        if (n && !n.removed) list.push({ y: n.y + 4, draw: () => drawNode(ctx, n, this.interact.glowFor(n, this.time)), occ: n.type === 'tree' && n.amount > 0 ? [n.x - 10, n.y - 22, 20, 22] : null });
      }
    }
    this.buildings.collectDrawables(list, ctx, camera, this.time);
    this.settlers.collectDrawables(list, ctx, camera, this.time);
    this.enemies.collectDrawables(list, ctx, camera, this.time);
    this.wildlife.collectDrawables(list, ctx, camera, this.time, (o, t) => this.interact.glowFor(o, t));
    const p = this.player;
    if (!p.dead) list.push({ y: p.y, draw: () => p.draw(ctx, null, this.time), unit: [p.x - 5, p.y - 19, 10, 19], sil: () => p.draw(ctx, '#fff3c4', this.time) });
    this.loot.collectDrawables(list, ctx, camera, this.time, (o, t) => this.interact.glowFor(o, t));
    list.sort((a, b) => a.y - b.y);
    this.effects.drawCorpses(ctx);
    if (!p.dead) p.drawGhosts(ctx, this.time);
    for (const d of list) d.draw();
    this.drawOccluded(ctx, list);
    if (!p.dead) p.drawTrail(ctx, this.time);
    this.wildlife.drawAir(ctx, camera, this.time);
    this.combat.draw(ctx);
    this.effects.drawParticles(ctx);

    // Beleuchtung, danach Bedienelemente in der Welt (bleiben nachts gut sichtbar)
    this.lighting.draw(ctx, this);
    camera.apply(ctx);
    this.wildlife.drawGlow(ctx, camera, this.time);
    if (!this.buildings.selected) this.drawTargetMarker(ctx);
    this.drawQuestMarker(ctx);
    this.player.drawGatherBar(ctx);
    this.buildings.drawGhost(ctx, this.time);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.effects.drawTexts(ctx, camera);
    this.drawDeathOverlay(ctx);
    if (this.state !== 'menu') {
      this.interact.drawPrompt(ctx, this);
      this.drawPoiArrows(ctx);
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

  /**
   * Figuren, die hinter einem Gebäude oder Baum stehen, scheinen als dezente Silhouette durch –
   * so verschwindet niemand hinter Hütten oder Türmen.
   */
  drawOccluded(ctx, list) {
    const occs = [];
    for (let i = 0; i < list.length; i++) if (list[i].occ) occs.push(i);
    if (!occs.length) return;
    ctx.globalAlpha = 0.38;
    for (let i = 0; i < list.length; i++) {
      const u = list[i];
      if (!u.unit) continue;
      const [ux, uy, uw, uh] = u.unit;
      for (const j of occs) {
        if (j <= i) continue; // nur später (davor) gezeichnete Objekte verdecken
        const [ox, oy, ow, oh] = list[j].occ;
        if (ux < ox + ow && ux + uw > ox && uy < oy + oh && uy + uh > oy) {
          u.sil();
          break;
        }
      }
    }
    ctx.globalAlpha = 1;
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

  /** Tod: Bild blendet ab, Countdown bis zur Rückkehr; Respawn: kurzer Lichtblitz. */
  drawDeathOverlay(ctx) {
    const p = this.player, W = this.canvas.width, H = this.canvas.height;
    if (p.dead && this.state !== 'menu') {
      const k = Math.min(1, p.deathT / 1.6) * Math.min(1, p.respawnT / 0.6);
      const grd = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.15, W / 2, H / 2, Math.max(W, H) * 0.7);
      grd.addColorStop(0, `rgba(8,4,4,${0.25 * k})`);
      grd.addColorStop(1, `rgba(8,4,4,${0.85 * k})`);
      ctx.fillStyle = grd;
      ctx.fillRect(0, 0, W, H);
      if (p.deathT > 0.8) {
        const dpr = window.devicePixelRatio || 1;
        const n = Math.ceil(p.respawnT);
        ctx.save();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.globalAlpha = Math.min(1, (p.deathT - 0.8) * 2);
        ctx.font = `italic ${Math.round(18 * dpr)}px Georgia, serif`;
        ctx.fillStyle = '#f3e6c4';
        ctx.fillText('Die Flamme ruft dich zurück …', W / 2, H / 2 - 30 * dpr);
        if (n <= 3 && n > 0) {
          const f = p.respawnT - Math.floor(p.respawnT);
          ctx.font = `bold ${Math.round((44 + f * 16) * dpr)}px Georgia, serif`;
          ctx.fillStyle = '#ffd36a';
          ctx.fillText(String(n), W / 2, H / 2 + 22 * dpr);
        }
        ctx.restore();
      }
    }
    if (this.flashT > 0) {
      ctx.fillStyle = `rgba(255,240,200,${(this.flashT / 0.35) * 0.55})`;
      ctx.fillRect(0, 0, W, H);
    }
  }

  /** Randpfeile zu wichtigen Orten außerhalb der Sicht (die Flamme, das Questziel; später Lager und POIs). */
  drawPoiArrows(ctx) {
    const c = this.buildings.center;
    const qt = this.progress.target();
    if (qt && qt !== c && !(c && qt.x === c.x && qt.y === c.y)) drawEdgeArrow(ctx, this.camera, qt.x, qt.y - 8, { color: 'rgba(255,230,140,0.95)', outline: 'rgba(60,30,10,0.8)', size: 1.2, icon: '!', pulse: true });
    if (c && c.hp > 0) drawEdgeArrow(ctx, this.camera, c.x, c.y - 8, { color: 'rgba(255,200,90,0.95)', outline: 'rgba(60,30,10,0.8)', size: 1.3, icon: '♨', pulse: true });
  }

  /** Goldener, wippender Pfeil über dem aktuellen Questziel. */
  drawQuestMarker(ctx) {
    const t = this.progress.target();
    if (!t || this.player.dead) return;
    const bob = Math.round(Math.sin(this.time * 4) * 2);
    const x = Math.round(t.x), y = Math.round(t.y - t.h - 6 + bob);
    ctx.fillStyle = 'rgba(40,20,5,0.8)';
    for (let i = 0; i < 5; i++) ctx.fillRect(x - 4 + i - 1, y + i - 1, (4 - i) * 2 + 3, 1);
    ctx.fillStyle = '#ffd36a';
    for (let i = 0; i < 4; i++) ctx.fillRect(x - 3 + i, y + i, (3 - i) * 2 + 1, 1);
    ctx.fillRect(x - 1, y - 4, 3, 4);
  }

  /** Pulsierende Eckklammern um eine Wasserstelle (Knoten leuchten selbst). */
  drawTargetMarker(ctx) {
    const t = this.player.target;
    if (!t || this.player.dead || t.kind !== 'water') return;
    const tx = t.tx, ty = t.ty;
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
