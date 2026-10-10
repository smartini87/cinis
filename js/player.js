// player.js – der Spieler: Bewegung (Beschleunigung), Angriff mit Ausholen/Schlag/Erholen, Sammeln mit
// Fortschritt, Inventar, Abliefern an der Flamme sowie Tod und Rückkehr an der Flamme.

import {
  TILE, RES, RES_KEYS, PLAYER_CAPACITY, DEPOSIT_RANGE, GATHER_TIME,
  PLAYER_HP, PLAYER_DAMAGE, PLAYER_ATTACK_RANGE, PLAYER_ATTACK_TIME, PLAYER_RESPAWN, PLAYER_ACCEL, PLAYER_DECEL,
  DASH, ENERGY,
} from './config.js';
import { NODE_DEFS } from './world.js';
import { drawHumanoid, OUTLINE } from './sprites.js';
import { dist, lerp } from './util.js';

/** Partikelfarben beim Abbauen */
const CHIP_COLORS = {
  tree: ['#8d6240', '#c49a6a', '#3d6e33'],
  rock: ['#d8d4ca', '#8e8a80', '#b9b4a8'],
  bush: ['#7a3266', '#3f7234', '#a8579a'],
  water: ['#7fc0ea', '#cfeaf8', '#3f86c0'],
};
/** Werkzeug in der Hand beim Sammeln */
const GATHER_ITEM = { tree: 'axe', rock: 'pick', bush: null, water: 'bucket' };

/** Angriffs-Zeitleiste in Sekunden */
const ATK = { windup: 0.09, strike: 0.1, recover: 0.15 };
/** Armstellung (relativ zur Blickrichtung) in den Phasen: Ruhe → ausgeholt → durchgezogen */
const ARM_REST = -0.5, ARM_RAISED = 1.9, ARM_FOLLOW = -1.3;
export const STAND_UP = 0.7;   // Dauer der Aufsteh-Animation
export const RESPAWN_INVULN = 1.5;

const ease = (k) => 1 - (1 - k) * (1 - k);

export class Player {
  constructor(x, y) {
    this.x = x;
    this.y = y;
    this.r = 4;           // Kollisionsradius
    this.speed = 72;      // Welteinheiten pro Sekunde
    this.vx = 0;          // aktuelle Geschwindigkeit (mit Beschleunigung/Abbremsung)
    this.vy = 0;
    this.flip = false;
    this.walk = 0;        // Laufanimationsphase
    this.moving = false;
    this.aimX = 1;        // Blickrichtung (normiert)
    this.aimY = 0;
    this.inv = { wood: 0, stone: 0, food: 0, water: 0, hide: 0 };
    this.capacity = PLAYER_CAPACITY;
    this.actionT = 0;     // Abklingzeit bis zur nächsten Aktion
    this.atk = null;      // laufender Angriff { t, base, side, hit }
    this.trail = [];      // Klingenspitzen des Schlags (Bogen-Trail)
    this.gatherT = 0;     // Fortschritt der aktuellen Sammelaktion
    this.gatherDur = 1;
    this.gatherKey = null;
    this.target = null;   // aktuelles Interaktionsziel
    this.hp = PLAYER_HP;
    this.maxHp = PLAYER_HP;
    this.hurt = 0;
    this.lastHit = -99;
    this.invuln = 0;      // Unverwundbarkeit (Respawn, Dash)
    this.invulnBlink = false;
    this.energy = ENERGY.max;
    this.energyMods = { max: 0, regen: 1 };   // Ausrüstung (z. B. Stiefel) verbessert Energie
    this.regenDelay = 0;
    this.dashT = 0;       // laufender Dash (Restdauer)
    this.dashCd = 0;
    this.dashX = 1;
    this.dashY = 0;
    this.requestDash = false;
    this.shiftT = 0;      // wie lange Shift gehalten wird (Sprint)
    this.sprinting = false;
    this.emptyFlash = 0;  // Energieleiste blinkt (zu wenig für einen Dash)
    this.ghosts = [];     // Nachbilder des Dashs
    this.standT = 0;      // Aufstehen nach Respawn/Intro
    this.dead = false;
    this.deathT = 0;
    this.respawnT = 0;
    this.converged = false;
  }

  get tx() {
    return Math.floor(this.x / TILE);
  }
  get ty() {
    return Math.floor(this.y / TILE);
  }
  get carried() {
    return RES_KEYS.reduce((s, k) => s + this.inv[k], 0);
  }
  get maxEnergy() {
    return ENERGY.max + this.energyMods.max;
  }

  update(dt, game) {
    const { input, world } = game;
    if (this.hurt > 0) this.hurt -= dt;
    if (this.dead) {
      this.deathT += dt;
      this.respawnT -= dt;
      // Kurz vor der Rückkehr sammeln sich Funken an der Flamme
      if (!this.converged && this.respawnT <= 0.9) {
        this.converged = true;
        const p = this.respawnPoint(game);
        game.effects.converge(p.x, p.y - 8, { n: 46, radius: 46, life: 0.85, color: ['#ffd36a', '#fff3c4', '#f0a53a', '#e8742a'] });
        game.audio.play('respawnCharge', 0.6);
      }
      if (this.respawnT <= 0) this.respawn(game);
      return;
    }
    if (this.invuln > 0) this.invuln -= dt;
    // Langsame Heilung, wenn eine Weile kein Treffer kam
    if (game.time - this.lastHit > 5) this.hp = Math.min(this.maxHp, this.hp + 3 * dt);

    // Bewegung (während des Aufstehens keine Steuerung, beim Schlag gebremst)
    let ax = input.axis();
    if (this.standT > 0) {
      this.standT -= dt;
      ax = { x: 0, y: 0 };
    }
    const steering = ax.x !== 0 || ax.y !== 0;
    this.updateEnergy(dt, game, ax, steering);
    if (this.dashT > 0) {
      this.updateDash(dt, game);
      this.target = game.interact.update(game);
      return;
    }
    const slow = this.atk ? 0.55 : this.gatherT > 0 ? 0.8 : this.sprinting ? ENERGY.sprintMul : 1;
    this.accelerate(ax.x * this.speed * slow, ax.y * this.speed * slow, steering ? PLAYER_ACCEL : PLAYER_DECEL, dt);
    const sp = Math.hypot(this.vx, this.vy);
    this.moving = sp > 8;
    if (sp > 0.01) {
      const ox = this.x, oy = this.y;
      if (world.moveEntity(this, this.vx * dt, this.vy * dt, this.r, 'friendly')) {
        // An der Wand bleibt nur der tatsächlich gefahrene (gleitende) Anteil der Geschwindigkeit erhalten
        this.vx = (this.x - ox) / dt;
        this.vy = (this.y - oy) / dt;
      }
      if (steering) game.progress.notify('move', Math.hypot(this.x - ox, this.y - oy));
    }
    if (steering && !this.atk) {
      const l = Math.hypot(ax.x, ax.y);
      this.aimX = ax.x / l;
      this.aimY = ax.y / l;
      if (ax.x !== 0) this.flip = ax.x < 0;
    }
    if (this.moving) this.walk += dt * 12 * Math.min(1, sp / this.speed);
    else this.walk = 0;

    // Interaktionsziel mit 20 Hz neu bestimmen (genügt und spart Rechenzeit)
    this.targetT = (this.targetT || 0) - dt;
    if (this.targetT <= 0 || (this.target && (this.target.obj?.dead || this.target.obj?.removed))) {
      this.targetT = 0.05;
      this.target = game.interact.update(game);
    }
    this.actionT -= dt;
    if (this.atk) this.updateAttack(dt, game);
    const mouseAct = input.mouse.down && game.mouseActionAllowed();
    const held = (input.isDown('Space', 'KeyE') || mouseAct) && this.standT <= 0;
    if (held && !this.atk && this.actionT <= 0) this.act(game, mouseAct);
    else if (!held) this.resetGather();
    if (held && !this.atk && this.actionT > 0 && this.gatherKey) this.continueGather(dt, game);

    // Automatisch an der Ewigen Flamme abliefern
    const center = game.buildings.center;
    if (center && this.carried > 0 && game.buildings.distTo(center, this.x, this.y) < DEPOSIT_RANGE) this.deposit(game);
  }

  // ---------------------------------------------------------------- Energie, Dash, Sprint
  updateEnergy(dt, game, ax, steering) {
    const input = game.input;
    if (this.emptyFlash > 0) this.emptyFlash -= dt;
    this.dashCd -= dt;
    this.regenDelay -= dt;
    if (this.regenDelay <= 0) this.energy = Math.min(this.maxEnergy, this.energy + ENERGY.regen * this.energyMods.regen * dt);
    if (this.requestDash) {
      this.requestDash = false;
      this.tryDash(game, ax, steering);
    }
    // Shift halten = Sprint (nach dem Dash bzw. ab 0,25 s)
    if (input.isDown('ShiftLeft', 'ShiftRight') || input.sprintHeld) this.shiftT += dt;
    else this.shiftT = 0;
    this.sprinting = this.shiftT > ENERGY.sprintAfter && steering && this.dashT <= 0 && this.energy > 0 && !this.atk;
    if (this.sprinting) {
      this.energy = Math.max(0, this.energy - ENERGY.sprintCost * dt);
      this.regenDelay = ENERGY.delay;
      if (this.energy <= 0) this.emptyFlash = 0.8;
    }
  }

  tryDash(game, ax, steering) {
    if (this.dead || this.standT > 0 || this.dashT > 0 || this.dashCd > 0) return;
    if (this.energy < DASH.cost) {
      this.emptyFlash = 0.8;
      game.audio.play('error', 0.4);
      return;
    }
    let dx = steering ? ax.x : this.aimX, dy = steering ? ax.y : this.aimY;
    const l = Math.hypot(dx, dy) || 1;
    dx /= l;
    dy /= l;
    this.dashX = dx;
    this.dashY = dy;
    this.dashT = DASH.time;
    this.dashCd = DASH.time + DASH.cooldown;
    this.energy -= DASH.cost;
    this.regenDelay = ENERGY.delay;
    if (this.invuln < DASH.iframes) {
      this.invuln = DASH.iframes;
      this.invulnBlink = false;
    }
    this.atk = null;
    this.resetGather();
    this.ghostT = 0;
    if (Math.abs(dx) > 0.1) this.flip = dx < 0;
    this.aimX = dx;
    this.aimY = dy;
    game.camera.addShake(1, 0.1);
    game.effects.burst(this.x, this.y, { n: 8, color: ['rgba(170,150,120,0.8)', 'rgba(120,105,85,0.8)'], speed: 30, life: 0.4, up: 8, gravity: 20 });
    game.audio.play('dash', 0.6);
  }

  /** Dash: fester Schub in Substeps (Kollision greift, Tore lassen durch), Nachbilder und Staub. */
  updateDash(dt, game) {
    this.dashT -= dt;
    const sp = DASH.speed;
    game.world.moveEntity(this, this.dashX * sp * dt, this.dashY * sp * dt, this.r, 'friendly');
    this.vx = this.dashX * this.speed;
    this.vy = this.dashY * this.speed;
    this.moving = true;
    this.walk += dt * 20;
    this.ghostT -= dt;
    if (this.ghostT <= 0) {
      this.ghostT = 0.04;
      this.ghosts.push({ x: this.x, y: this.y, flip: this.flip, t: game.time, walk: this.walk });
      if (this.ghosts.length > 6) this.ghosts.shift();
      game.effects.burst(this.x, this.y, { n: 1, color: ['rgba(170,150,120,0.7)'], speed: 12, life: 0.35, up: 6, gravity: 10 });
    }
  }

  /** Geschwindigkeit mit begrenzter Beschleunigung an den Sollwert annähern. */
  accelerate(tx, ty, rate, dt) {
    const dx = tx - this.vx, dy = ty - this.vy, d = Math.hypot(dx, dy), max = rate * dt;
    if (d <= max) {
      this.vx = tx;
      this.vy = ty;
    } else {
      this.vx += (dx / d) * max;
      this.vy += (dy / d) * max;
    }
  }

  distToTile(tx, ty) {
    const x0 = tx * TILE, y0 = ty * TILE;
    const dx = Math.max(x0 - this.x, 0, this.x - (x0 + TILE)), dy = Math.max(y0 - this.y, 0, this.y - (y0 + TILE));
    return Math.hypot(dx, dy);
  }

  /** Alles Treffbare in Schlagreichweite (passive Tiere nur, wenn all = true). */
  foesInReach(game, all = false) {
    const out = [], R = PLAYER_ATTACK_RANGE + 10;
    game.forEachHittable((e) => {
      if (Math.abs(e.x - this.x) > R || Math.abs(e.y - this.y) > R) return;
      if ((all || !e.passive || e.aggroT > 0) && dist(this.x, this.y, e.x, e.y) <= PLAYER_ATTACK_RANGE + e.r) out.push(e);
    });
    return out;
  }

  /** Aktion: Kampf hat Vorrang, sonst Interaktion bzw. Sammeln am aktuellen Ziel. */
  act(game, viaMouse) {
    const { input, camera } = game;
    if (viaMouse && input.mouse.inside) {
      const w = camera.screenToWorld(input.mouse.x, input.mouse.y);
      this.faceTowards(w.x, w.y);
    }
    const foes = this.foesInReach(game);
    if (foes.length) {
      if (!(viaMouse && input.mouse.inside)) {
        foes.sort((a, b) => dist(this.x, this.y, a.x, a.y) - dist(this.x, this.y, b.x, b.y));
        this.faceTowards(foes[0].x, foes[0].y);
      }
      this.startAttack(game);
      return;
    }
    const t = this.target;
    if (!t) {
      this.resetGather();
      return;
    }
    this.faceTowards(t.x, t.y);
    if (t.act) {
      this.resetGather();
      t.act(game);
      this.actionT = 0.35;
      return;
    }
    if (this.carried >= this.capacity) {
      game.ui.toast('Voll beladen! Bring die Ressourcen zur Ewigen Flamme.', 'warn', 'full');
      this.actionT = 0.5;
      return;
    }
    // Sammeln beginnen: Fortschritt läuft, solange die Taste gehalten wird
    const kind = t.kind === 'node' ? t.node.type : 'water';
    const key = t.kind === 'node' ? 'n' + t.node.id : `w${t.tx},${t.ty}`;
    if (this.gatherKey !== key) {
      this.gatherKey = key;
      this.gatherT = 0;
      this.gatherKind = kind;
      this.gatherTarget = t;
      this.gatherDur = GATHER_TIME[kind];
    }
    this.actionT = 0.01;
  }

  resetGather() {
    this.gatherKey = null;
    this.gatherT = 0;
  }

  continueGather(dt, game) {
    const t = this.target;
    const key = t && (t.kind === 'node' ? 'n' + t.node.id : t.kind === 'water' ? `w${t.tx},${t.ty}` : null);
    if (key !== this.gatherKey || this.foesInReach(game).length) {
      this.resetGather();
      return;
    }
    this.gatherTarget = t;
    this.actionT = 0.01;
    this.gatherT += dt;
    if (this.gatherT >= this.gatherDur) {
      this.gatherT = 0;
      this.harvest(game, t);
    }
  }

  /** Ertrag einer abgeschlossenen Sammelaktion. */
  harvest(game, t) {
    const { world, effects } = game;
    if (this.carried >= this.capacity) {
      game.ui.toast('Voll beladen! Bring die Ressourcen zur Ewigen Flamme.', 'warn', 'full');
      this.resetGather();
      return;
    }
    let res, kind;
    if (t.kind === 'node') {
      kind = t.node.type;
      res = NODE_DEFS[kind].res;
      if (world.harvest(t.node, 1) <= 0) return;
    } else {
      kind = 'water';
      res = 'water';
    }
    this.inv[res] += 1;
    game.stats.gathered++;
    game.progress.notify('gather', res, 1);
    game.audio.play({ tree: 'chop', rock: 'mine', bush: 'pick', water: 'water' }[kind]);
    effects.burst(t.x, t.y - (kind === 'tree' ? 6 : 2), { n: 6, color: CHIP_COLORS[kind], speed: 50, life: 0.5, up: 35 });
    effects.text(t.x, t.y - 14, `+1 ${RES[res].name}`, RES[res].color);
  }

  // ---------------------------------------------------------------- Kampf
  startAttack(game) {
    this.resetGather();
    this.atk = { t: 0, base: Math.atan2(this.aimY, this.aimX), side: this.aimX < 0 ? 1 : -1, hit: false };
    this.trail.length = 0;
    this.actionT = PLAYER_ATTACK_TIME;
    game.audio.play('swing', 0.7);
  }

  /** Armwinkel (relativ zur Blickrichtung) im Verlauf des Angriffs. */
  attackArm() {
    const t = this.atk.t;
    if (t < ATK.windup) return lerp(ARM_REST, ARM_RAISED, ease(t / ATK.windup));
    if (t < ATK.windup + ATK.strike) return lerp(ARM_RAISED, ARM_FOLLOW, ease((t - ATK.windup) / ATK.strike));
    return lerp(ARM_FOLLOW, ARM_REST, Math.min(1, (t - ATK.windup - ATK.strike) / ATK.recover));
  }

  updateAttack(dt, game) {
    const a = this.atk;
    a.t += dt;
    if (!a.hit && a.t >= ATK.windup) {
      // Schlag: Körper-Lunge nach vorn, Treffer im Bogen vor dem Spieler
      a.hit = true;
      this.vx += this.aimX * 95;
      this.vy += this.aimY * 95;
      game.noise(this.x, this.y, 5 * TILE);
      let hits = 0;
      for (const e of this.foesInReach(game, true)) {
        const d = Math.max(1, dist(this.x, this.y, e.x, e.y));
        const dot = ((e.x - this.x) * this.aimX + (e.y - this.y) * this.aimY) / d;
        if (dot > 0.2 || d < 10) {
          game.hitUnit(e, PLAYER_DAMAGE, this.aimX * 7, this.aimY * 7);
          hits++;
        }
      }
      if (hits) {
        game.hitStop = 3;
        game.camera.addShake(1.5, 0.12);
        game.audio.play('hit');
      }
    }
    // Klingenspitze für den Bogen-Trail aufzeichnen
    if (a.t >= ATK.windup * 0.6 && a.t <= ATK.windup + ATK.strike + 0.03) {
      const ang = a.base + a.side * this.attackArm();
      this.trail.push({ x: this.x + Math.cos(ang) * 16, y: this.y - 10 + Math.sin(ang) * 16, t: game.time });
      if (this.trail.length > 8) this.trail.shift();
    }
    if (a.t >= ATK.windup + ATK.strike + ATK.recover) this.atk = null;
  }

  /** Respawnpunkt an der Flamme. */
  respawnPoint(game) {
    const c = game.buildings.center;
    return { x: c.x, y: c.y + 2 * TILE };
  }

  die(game) {
    this.dead = true;
    this.hp = 0;
    this.deathT = 0;
    this.respawnT = PLAYER_RESPAWN;
    this.converged = false;
    this.atk = null;
    this.resetGather();
    // Die Hälfte der getragenen Rohstoffe fällt als Beutehaufen zu Boden, der Rest bleibt
    const drop = {};
    let lost = 0;
    for (const k of RES_KEYS) {
      const n = Math.ceil(this.inv[k] / 2);
      if (n > 0) {
        drop[k] = n;
        this.inv[k] -= n;
        lost += n;
      }
    }
    if (lost) game.loot.drop(this.x, this.y, drop);
    game.effects.burst(this.x, this.y - 8, { n: 26, color: ['#a8322c', '#b8a04a', '#7a1c18'], speed: 55, life: 0.9 });
    game.effects.burst(this.x, this.y - 6, { n: 30, color: ['#8a8580', '#5a5450', '#b9b4a8'], speed: 14, life: 2.2, up: 26, gravity: -6, drag: 0.4 });
    const look = this.look(), x = this.x, y = this.y;
    game.effects.corpse((ctx, k) => drawHumanoid(ctx, x, y + k * 2, { ...look, pose: k < 0.35 ? 'kneel' : 'lie' }), 1.2);
    game.ui.toast(`Du bist gefallen!${lost ? ` ${lost} Ressourcen liegen als Beute am Boden.` : ''}`, 'danger');
    game.audio.play('death');
  }

  respawn(game) {
    const p = this.respawnPoint(game);
    this.dead = false;
    this.hp = this.maxHp;
    this.x = p.x;
    this.y = p.y;
    this.vx = this.vy = 0;
    this.lastHit = game.time;
    this.invuln = RESPAWN_INVULN;
    this.invulnBlink = true;
    this.standT = STAND_UP;
    this.energy = this.maxEnergy;
    this.aimX = 0;
    this.aimY = 1;
    game.flashT = 0.35;
    const c = game.buildings.center;
    if (c) c.pulse = 1;
    game.camera.addShake(2, 0.2);
    game.effects.burst(this.x, this.y - 8, { n: 22, color: ['#ffd36a', '#fff3c4'], speed: 55, life: 0.8, up: 30 });
    game.audio.play('respawn');
  }

  faceTowards(x, y) {
    const dx = x - this.x, dy = y - this.y;
    const l = Math.hypot(dx, dy);
    if (l < 1) return;
    this.aimX = dx / l;
    this.aimY = dy / l;
    if (Math.abs(dx) > 1) this.flip = dx < 0;
  }

  /** Gesamtes Inventar ins Lager der Siedlung legen. */
  deposit(game) {
    let off = 0;
    game.audio.play('deposit');
    game.progress.notify('deposit', 'all', this.carried);
    for (const k of RES_KEYS) {
      if (this.inv[k] <= 0) continue;
      game.stock[k] += this.inv[k];
      game.effects.text(this.x, this.y - 22 - off, `+${this.inv[k]} ${RES[k].name}`, RES[k].color);
      off += 7;
      this.inv[k] = 0;
    }
  }

  // ---------------------------------------------------------------- Zeichnen
  /** Grundaussehen der Figur. */
  look() {
    return { flip: this.flip, tunic: '#c8302a', skin: '#d6a676', helmet: '#e0b84a', plume: '#e8402c', belt: '#5a3a1e' };
  }

  /** Zeichnen; sil = Farbe für die Silhouette (hinter Gebäuden). */
  draw(ctx, sil = null, time = 0) {
    if (this.dead || this.introHidden) return;
    // Unverwundbar: Blinken
    const blink = this.invuln > 0 && this.invulnBlink && !sil && Math.floor(this.invuln * 14) % 2 === 0;
    if (blink) ctx.globalAlpha = 0.35;
    const o = { ...this.look(), walk: this.moving ? this.walk : 0, breath: time, hurt: this.hurt > 0, silhouette: sil, outline: OUTLINE.player, item: 'sword' };
    o.dir = this.aimY < -0.7 ? 'up' : this.aimY > 0.7 && Math.abs(this.aimX) < 0.5 ? 'down' : 'side';
    if (this.standT > 0) o.pose = this.standT > STAND_UP * 0.55 ? 'lie' : this.standT > STAND_UP * 0.2 ? 'kneel' : 'stand';
    if (this.atk) {
      const t = this.atk.t;
      o.arm = this.atk.base + this.atk.side * this.attackArm();
      o.lean = t < ATK.windup ? -1 : t < ATK.windup + ATK.strike + 0.05 ? 2 : 0;
      o.dir = 'side';
    } else if (this.gatherKey && this.gatherT > 0) {
      // Werkzeug-Schwung: ausholen, Schlag genau beim Ertrag
      const k = this.gatherT / this.gatherDur;
      const base = this.flip ? Math.PI : 0, side = this.flip ? 1 : -1;
      const sw = k < 0.65 ? lerp(-0.5, 1.6, k / 0.65) : lerp(1.6, -0.7, (k - 0.65) / 0.35);
      o.item = GATHER_ITEM[this.gatherKind];
      o.arm = o.item ? base + side * sw : base + side * (0.2 + Math.sin(k * Math.PI * 2) * 0.4);
      o.lean = k > 0.65 ? 1 : 0;
      o.dir = 'side';
    }
    drawHumanoid(ctx, this.x, this.y, o);
    if (blink) ctx.globalAlpha = 1;
  }

  /** Nachbilder des Dashs (helle, schnell verblassende Silhouetten). */
  drawGhosts(ctx, time) {
    for (const g of this.ghosts) {
      const age = time - g.t;
      if (age > 0.25) continue;
      ctx.globalAlpha = 0.45 * (1 - age / 0.25);
      drawHumanoid(ctx, g.x, g.y, { ...this.look(), flip: g.flip, walk: g.walk, silhouette: '#ffe8b0', noShadow: true });
    }
    ctx.globalAlpha = 1;
  }

  /** Bogen-Trail des Schwerthiebs (verblasst schnell). */
  drawTrail(ctx, time) {
    const tr = this.trail.filter((p) => time - p.t < 0.14);
    if (tr.length < 2) return;
    const sx = this.x, sy = this.y - 10;
    for (let i = 1; i < tr.length; i++) {
      const a = 1 - (time - tr[i].t) / 0.14;
      ctx.fillStyle = `rgba(255,244,214,${0.5 * a})`;
      ctx.beginPath();
      ctx.moveTo(sx + (tr[i - 1].x - sx) * 0.45, sy + (tr[i - 1].y - sy) * 0.45);
      ctx.lineTo(tr[i - 1].x, tr[i - 1].y);
      ctx.lineTo(tr[i].x, tr[i].y);
      ctx.lineTo(sx + (tr[i].x - sx) * 0.45, sy + (tr[i].y - sy) * 0.45);
      ctx.closePath();
      ctx.fill();
    }
  }

  /** Fortschrittsbalken der Sammelaktion über dem Ziel. */
  drawGatherBar(ctx) {
    if (!this.gatherKey || this.gatherT <= 0 || !this.gatherTarget) return;
    const t = this.gatherTarget, k = Math.min(1, this.gatherT / this.gatherDur);
    const x = Math.round(t.x - 7), y = Math.round(t.y - (t.promptH ?? 18) - 6);
    ctx.fillStyle = 'rgba(0,0,0,0.75)';
    ctx.fillRect(x - 1, y - 1, 16, 4);
    ctx.fillStyle = '#ffd36a';
    ctx.fillRect(x, y, Math.round(14 * k), 2);
  }
}
