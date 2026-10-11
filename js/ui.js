// ui.js – DOM-Oberfläche über dem Canvas: HUD (Ressourcen, Tag/Nacht, LP, Bauleiste, Hinweise, Meldungen)
// sowie Overlays (Hauptmenü, Pause, Tutorial, Hilfe, Sieg/Niederlage).

import { RES, RES_KEYS } from './config.js';
import { iconURL, buildingPreviewURL } from './sprites.js';
import { BUILDING_DEFS, BUILDABLE, BUILD_CATEGORIES } from './buildings.js';
import { FLAME_LEVELS, MAX_LEVEL } from './flame.js';
import { FOCI } from './settlers.js';
import { SETTLER, TILE } from './config.js';
import { loadScores, bestScore } from './highscore.js';
import { DAY_LEN, CYCLE } from './time.js';
import { fmtTime } from './util.js';
import { peekSave } from './save.js';
import { POI_TYPES } from './pois.js';
import { Sprites } from './sprites.js';
import { itemInfo } from './items.js';
import { RECIPES, STATION_NAMES, recipeName, recipeDesc, recipeUnlocked, craft } from './recipes.js';

/** Warum ein Rezept gesperrt ist (Flammenstufe/Bauplan). */
function lockText(game, r) {
  const u = r.unlock || {};
  const parts = [];
  if (u.level) parts.push(`Flammenstufe ${u.level}`);
  if (u.blueprint && !game.progress.blueprints.has(u.blueprint)) parts.push('Bauplan nötig');
  return 'Gesperrt: ' + parts.join(', ');
}

const HELP = `
<table class="keys">
<tr><td>WASD / Pfeile</td><td>Bewegen</td></tr>
<tr><td>Shift (halten)</td><td>Dash (kurz unverwundbar) · Sprint</td></tr>
<tr><td>Leertaste / E / Linksklick</td><td>Sammeln &amp; angreifen (gedrückt halten)</td></tr>
<tr><td>E</td><td>Interagieren: Siedler mitnehmen, Baustelle beliefern, Kiste, Schrein, Händler, Flamme, Werkbank</td></tr>
<tr><td>B, 1 – 9 / Bauleiste</td><td>Baukategorie wechseln, Gebäude wählen</td></tr>
<tr><td>R / Mausrad (im Baumodus)</td><td>Mauer bzw. Tor drehen</td></tr>
<tr><td>Rechtsklick / Esc</td><td>Bauen abbrechen</td></tr>
<tr><td>X</td><td>Abriss</td></tr>
<tr><td>I</td><td>Gepäck (Inventar)</td></tr>
<tr><td>T / Q</td><td>Fackel an/aus · Verband anlegen</td></tr>
<tr><td>F</td><td>Tempo 1× / 2× / 3×</td></tr>
<tr><td>P / Esc</td><td>Pause</td></tr>
<tr><td>M</td><td>Ton an/aus</td></tr>
<tr><td>Mausrad</td><td>Zoom</td></tr>
<tr><td>H</td><td>Diese Hilfe</td></tr>
<tr><td>Touch</td><td>Links ziehen = laufen, tippen = Aktion/Bauen, Knopf „Dash“</td></tr>
</table>`;

/**
 * Pfeil am Bildschirmrand, der auf einen Weltpunkt außerhalb der Sicht zeigt (Gegner, Flamme, POIs).
 * style: { color, size, icon (Zeichen im Pfeil), pulse }. Liefert true, wenn gezeichnet.
 */
export function drawEdgeArrow(ctx, cam, wx, wy, style = {}) {
  const s = cam.worldToScreen(wx, wy);
  if (s.x >= 0 && s.y >= 0 && s.x <= cam.vw && s.y <= cam.vh) return false;
  const dpr = window.devicePixelRatio || 1;
  const cx = cam.vw / 2, cy = cam.vh / 2, margin = 26 * dpr;
  const a = Math.atan2(s.y - cy, s.x - cx);
  const k = Math.min((cx - margin) / Math.abs(Math.cos(a) || 1e-6), (cy - margin) / Math.abs(Math.sin(a) || 1e-6));
  const x = cx + Math.cos(a) * k, y = cy + Math.sin(a) * k;
  const sz = 8 * dpr * (style.size || 1) * (style.pulse ? 1 + Math.sin(performance.now() / 180) * 0.12 : 1);
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(a);
  ctx.fillStyle = style.color || 'rgba(208,64,42,0.85)';
  ctx.beginPath();
  ctx.moveTo(sz, 0);
  ctx.lineTo(-sz, -sz * 0.7);
  ctx.lineTo(-sz * 0.5, 0);
  ctx.lineTo(-sz, sz * 0.7);
  ctx.closePath();
  ctx.fill();
  if (style.outline) {
    ctx.strokeStyle = style.outline;
    ctx.lineWidth = dpr;
    ctx.stroke();
  }
  ctx.restore();
  if (style.icon) {
    ctx.save();
    const ix = x - Math.cos(a) * sz * 2.1, iy = y - Math.sin(a) * sz * 2.1;
    ctx.font = `bold ${Math.round(11 * dpr)}px Georgia, serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillText(style.icon, ix + dpr, iy + dpr);
    ctx.fillStyle = style.color || '#fff';
    ctx.fillText(style.icon, ix, iy);
    ctx.restore();
  }
  return true;
}

/** Kurzhelfer zum Erzeugen von DOM-Elementen. */
function el(tag, cls, parent, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  if (parent) parent.appendChild(e);
  return e;
}

export class UI {
  constructor(game) {
    this.game = game;
    this.root = document.getElementById('ui');
    this.cache = {};         // zuletzt geschriebene Werte (DOM nur bei Änderung anfassen)
    this.toastKeys = {};     // Entprellung wiederholter Meldungen
    this.refreshT = 0;
    this.buildHud();
    // HUD-Knöpfe nach dem Klick entfokussieren, sonst löst die Leertaste (Sammeln) sie erneut aus
    this.root.addEventListener('click', (e) => {
      const b = e.target.closest('.hud button');
      if (b) b.blur();
    });
  }

  buildHud() {
    const hud = (this.hud = el('div', 'hud', this.root));
    // Ressourcen (oben links)
    // Linke Spalte: Lager und Arbeitsschwerpunkt untereinander (wächst mit der Zahl der Rohstoffe)
    const leftCol = el('div', 'left-col', hud);
    const res = (this.resPanel = el('div', 'panel res-panel', leftCol));
    this.resEls = {};
    this.resRows = {};
    this.seenRes = new Set(['wood', 'stone', 'food', 'water']);
    for (const k of RES_KEYS) {
      const row = (this.resRows[k] = el('div', 'res-row', res));
      row.title = RES[k].name;
      const img = el('img', 'icon', row);
      img.src = iconURL(k);
      img.alt = RES[k].name;
      this.resEls[k] = el('span', 'val', row, '0');
      el('span', 'lbl', row, RES[k].name);
    }
    // Bevölkerung
    const pop = el('div', 'res-row pop-row', res);
    const pimg = el('img', 'icon', pop);
    pimg.src = iconURL('people');
    pimg.alt = 'Siedler';
    this.popEl = el('span', 'val', pop, '0');
    this.popLbl = el('span', 'lbl', pop, 'Siedler');
    pop.title = 'Siedler / Plätze. Überlebende findest du in Lagern in der Wildnis – jede Hütte bietet 4 Plätze.';
    // Arbeitsschwerpunkt der Sammler
    const focus = (this.focusPanel = el('div', 'panel focus-panel', leftCol));
    el('div', 'lbl', focus, 'Siedler sammeln');
    const fb = el('div', 'focus-btns', focus);
    this.focusBtns = {};
    for (const f of FOCI) {
      const b = el('button', 'fbtn', fb, f.name);
      b.type = 'button';
      b.title = f.id === 'auto' ? 'Siedler sammeln, was am knappsten ist' : `Freie Siedler sammeln vor allem ${f.name}`;
      b.addEventListener('click', () => {
        this.game.settlers.focus = f.id;
        this.game.audio.play('click');
      });
      this.focusBtns[f.id] = b;
    }
    // Tag/Nacht + Zustand der Flamme (oben Mitte)
    const day = (this.dayPanel = el('div', 'panel day-panel', hud));
    const top = el('div', 'day-top', day);
    this.dayEl = el('span', 'day-num', top);
    this.phaseEl = el('span', 'day-phase', top);
    const cyc = el('div', 'cycle', day);
    el('div', 'cycle-day', cyc).style.width = `${(DAY_LEN / CYCLE) * 100}%`;
    el('div', 'cycle-night', cyc).style.width = `${(1 - DAY_LEN / CYCLE) * 100}%`;
    this.cycleMark = el('div', 'cycle-mark', cyc);
    const flame = el('div', 'flame-row', day);
    const fimg = el('img', 'icon small', flame);
    fimg.src = iconURL('flame');
    fimg.alt = 'Flamme';
    this.flameBar = el('div', 'fill', el('div', 'bar flame-bar', flame));
    this.flameTxt = el('span', 'flame-txt', flame);
    flame.title = 'Zustand des Tempels der Flamme (Lebenspunkte)';
    // Flammenstufe, Glut und Brennstoffbedarf pro Nacht
    const fl = el('div', 'flame-row vigor-row', day);
    this.lvlEl = el('span', 'lvl-badge', fl, 'Stufe 1');
    this.vigorBar = el('div', 'fill', el('div', 'bar vigor-bar', fl));
    this.fuelEl = el('span', 'fuel-txt', fl);
    fl.title = 'Glut der Flamme: Jede Nacht verbrennt sie Brennstoff aus dem Lager. Fehlt er, schrumpft sie – bei 0 erlischt sie.';
    // Lebenspunkte und Energie des Spielers
    const hpPanel = (this.hpPanel = el('div', 'panel hp-panel', hud));
    const hp = el('div', 'stat-row', hpPanel);
    const himg = el('img', 'icon small', hp);
    himg.src = iconURL('heart');
    himg.alt = 'Leben';
    this.hpBar = el('div', 'fill', el('div', 'bar hp-bar', hp));
    this.hpTxt = el('span', 'hp-txt', hp);
    const en = (this.enRow = el('div', 'stat-row en-row', hpPanel));
    en.title = 'Energie: Shift = Dash (kurzer Sprint mit Ausweichen), Shift halten = Sprinten';
    const eimg = el('img', 'icon small', en);
    eimg.src = iconURL('energy');
    eimg.alt = 'Energie';
    this.enBar = el('div', 'fill', el('div', 'bar en-bar', en));
    this.enTxt = el('span', 'hp-txt', en);
    // Dash-Knopf für Touch
    this.dashBtn = el('button', 'dash-btn', hud, 'Dash');
    this.dashBtn.type = 'button';
    this.dashBtn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.game.player.requestDash = true;
      this.game.input.sprintHeld = true;
    });
    const up = () => (this.game.input.sprintHeld = false);
    this.dashBtn.addEventListener('pointerup', up);
    this.dashBtn.addEventListener('pointercancel', up);
    this.dashBtn.addEventListener('pointerleave', up);
    // Gepäck: Belegung, Hotbar (Waffe, Rüstung, Fackel, Verband) und Knopf fürs Inventar
    const carry = (this.carryPanel = el('div', 'panel carry-panel', hud));
    const head = el('div', 'carry-head', carry);
    this.carryLbl = el('span', 'lbl', head, 'Gepäck');
    this.bagBtn = el('button', 'bag-btn', head, 'Inventar (I)');
    this.bagBtn.type = 'button';
    this.bagBtn.addEventListener('click', () => this.game.toggleInventory());
    this.carryBar = el('div', 'fill', el('div', 'bar', carry));
    this.hotbar = el('div', 'hotbar', carry);
    this.hotSlots = {};
    for (const [key, label, title] of [['weapon', '', 'Waffe (das beste Schwert im Gepäck)'], ['armor', '', 'Rüstung und Stiefel wirken, solange du sie trägst'], ['torch', 'T', 'Fackel: T zündet an bzw. löscht'], ['bandage', 'Q', 'Verband: Q heilt 40 LP']]) {
      const slot = el('div', 'hslot', this.hotbar);
      slot.title = title;
      const img = el('img', 'hicon', slot);
      img.alt = '';
      const n = el('span', 'hn', slot);
      if (label) el('span', 'hk', slot, label);
      this.hotSlots[key] = { slot, img, n };
      if (key === 'torch') slot.addEventListener('click', () => this.game.player.toggleTorch(this.game));
      if (key === 'bandage') slot.addEventListener('click', () => this.game.player.useBandage(this.game));
    }
    this.carryTxt = el('div', 'carry-txt', carry);
    // Bauleiste (unten Mitte)
    this.buildBar = el('div', 'panel buildbar', hud);
    // Kategorie-Reiter (B wechselt)
    this.catTabs = el('div', 'cat-tabs', this.buildBar);
    this.catBtns = BUILD_CATEGORIES.map((c, i) => {
      const t = el('button', 'cat-tab', this.catTabs, c.name);
      t.type = 'button';
      t.title = `${c.name} (B wechselt die Kategorie)`;
      t.addEventListener('click', () => {
        this.game.buildCat = i;
        this.game.audio.play('click');
      });
      return t;
    });
    this.buildRow = el('div', 'build-row', this.buildBar);
    this.buildKeys = {};
    this.buildBtns = {};
    for (const type of [...BUILDABLE, 'demolish']) {
      const btn = el('button', 'bslot', this.buildRow);
      btn.type = 'button';
      if (type === 'demolish') {
        el('div', 'demo-icon', btn, '⛏');
        el('div', 'bname', btn, 'Abriss');
        el('div', 'bcost', btn, '50 % zurück');
        el('span', 'bkey', btn, 'X');
        btn.title = 'Abriss: Gebäude anklicken, die Hälfte der Kosten wird erstattet.';
      } else {
        const def = BUILDING_DEFS[type];
        const img = el('img', 'bimg', btn);
        img.src = buildingPreviewURL(type);
        img.alt = def.name;
        el('div', 'bname', btn, def.name);
        const cost = el('div', 'bcost', btn);
        for (const k of RES_KEYS) {
          if (!def.cost[k]) continue;
          const c = el('span', 'c', cost);
          const ic = el('img', 'ci', c);
          ic.src = iconURL(k);
          ic.alt = RES[k].name;
          el('span', '', c, String(def.cost[k]));
        }
        this.buildKeys[type] = el('span', 'bkey', btn, '');
        btn.title = `${def.name}: ${def.desc}`;
      }
      btn.addEventListener('click', () => {
        this.game.buildings.select(type);
        this.game.audio.play('click');
      });
      this.buildBtns[type] = btn;
    }
    // Steuerknöpfe (oben rechts)
    const ctl = el('div', 'panel ctl-panel', hud);
    this.speedBtn = el('button', 'cbtn', ctl, '1×');
    this.speedBtn.title = 'Spieltempo (F)';
    this.speedBtn.addEventListener('click', () => this.game.cycleSpeed());
    this.soundBtn = el('button', 'cbtn', ctl, '♪');
    this.soundBtn.title = 'Ton an/aus (M)';
    this.soundBtn.addEventListener('click', () => this.game.toggleSound());
    const pauseBtn = el('button', 'cbtn', ctl, 'Ⅱ');
    pauseBtn.title = 'Pause (P)';
    pauseBtn.addEventListener('click', () => this.game.pause());
    const helpBtn = el('button', 'cbtn', ctl, '?');
    helpBtn.title = 'Steuerung (H)';
    helpBtn.addEventListener('click', () => this.game.showHelp());
    for (const b of ctl.children) b.type = 'button';
    // Minikarte (eigenes Canvas, damit Klicks darauf nicht im Spiel landen)
    this.mini = el('canvas', 'panel minimap', hud);
    this.mini.width = 192;
    this.mini.height = 192;
    this.mini.title = 'Übersichtskarte';
    this.miniCtx = this.mini.getContext('2d');
    this.miniBase = null;
    this.miniWorld = null;
    this.miniFrame = 0;
    // Ziel-Banner des Einstiegs (oben Mitte)
    this.quest = el('div', 'panel quest-banner', hud);
    el('div', 'quest-lbl', this.quest, 'Ziel');
    this.questTxt = el('div', 'quest-txt', this.quest);
    this.questProg = el('div', 'quest-prog', this.quest);
    // Hinweiszeile + Meldungen
    this.hint = el('div', 'hint', hud);
    this.toasts = el('div', 'toasts', this.root);
    // Overlay-Ebene für Menüs
    this.overlay = el('div', 'overlay', this.root);
    this.overlay.hidden = true;
  }

  /** Minikarte zeichnen: Gelände, Gebäude, Siedler, Gegner, Spieler und Sichtbereich. */
  drawMinimap() {
    if (this.hud.hidden || ++this.miniFrame % 3) return;
    const g = this.game, w = g.world, m = this.miniCtx, S = this.mini.width;
    const k = S / w.w;
    if (this.miniWorld !== w) {
      // Grundbild aus dem gerenderten Gelände verkleinern
      this.miniWorld = w;
      this.miniBase = document.createElement('canvas');
      this.miniBase.width = S;
      this.miniBase.height = S;
      const bc = this.miniBase.getContext('2d');
      bc.imageSmoothingEnabled = true;
      bc.drawImage(w.terrain, 0, 0, S, S);
    }
    m.imageSmoothingEnabled = false;
    m.drawImage(this.miniBase, 0, 0);
    m.fillStyle = `rgba(6,8,26,${g.cycle.darkness * 0.45})`;
    m.fillRect(0, 0, S, S);
    for (const b of g.buildings.list) {
      m.fillStyle = b.type === 'center' ? '#ffb040' : b.type === 'wall' ? '#d8d4ca' : b.type === 'tower' ? '#ffe08a' : '#c9a27a';
      m.fillRect(Math.floor(b.tx * k), Math.floor(b.ty * k), Math.ceil(b.size * k), Math.ceil(b.size * k));
    }
    m.fillStyle = '#9fe0ff';
    for (const s of g.settlers.list) if (!s.hidden && !s.mode) m.fillRect(Math.floor((s.x / TILE) * k) - 1, Math.floor((s.y / TILE) * k) - 1, 2, 2);
    // Nebel über Unerkundetem
    if (this.fogVersion !== w.exploredVersion || this.fogWorld !== w) {
      this.fogVersion = w.exploredVersion;
      this.fogWorld = w;
      if (!this.fog) {
        this.fog = document.createElement('canvas');
        this.fog.width = w.w;
        this.fog.height = w.h;
      }
      const fc = this.fog.getContext('2d'), img = fc.createImageData(w.w, w.h);
      for (let i = 0; i < w.w * w.h; i++) {
        img.data[i * 4] = 14;
        img.data[i * 4 + 1] = 12;
        img.data[i * 4 + 2] = 10;
        img.data[i * 4 + 3] = w.explored[i] ? 0 : 215;
      }
      fc.putImageData(img, 0, 0);
    }
    m.imageSmoothingEnabled = true;
    m.drawImage(this.fog, 0, 0, S, S);
    m.imageSmoothingEnabled = false;
    // Entdeckte Orte
    m.font = 'bold 11px Georgia, serif';
    m.textAlign = 'center';
    m.textBaseline = 'middle';
    for (const o of g.pois.list) {
      if (!o.discovered) continue;
      const t = POI_TYPES[o.type], ox = (o.x / TILE) * k, oy = (o.y / TILE) * k;
      const live = g.pois.interesting(o, g);
      m.fillStyle = 'rgba(0,0,0,0.7)';
      m.fillRect(ox - 4, oy - 4, 9, 9);
      m.fillStyle = live ? t.color : 'rgba(160,150,140,0.7)';
      m.fillText(t.icon, ox + 0.5, oy + 1);
    }
    if (g.pois.trader) {
      const t = g.pois.trader;
      m.fillStyle = 'rgba(0,0,0,0.7)';
      m.fillRect((t.x / TILE) * k - 4, (t.y / TILE) * k - 4, 9, 9);
      m.fillStyle = '#ffd36a';
      m.fillText('⚖', (t.x / TILE) * k + 0.5, (t.y / TILE) * k + 1);
    }
    m.textAlign = 'left';
    m.fillStyle = '#ff4030';
    for (const e of g.enemies.list) {
      if (e.guard && !w.isExplored(Math.floor(e.x / TILE), Math.floor(e.y / TILE))) continue;
      const r = e.type === 'boss' ? 4 : 3;
      m.fillRect(Math.floor((e.x / TILE) * k) - r / 2, Math.floor((e.y / TILE) * k) - r / 2, r, r);
    }
    // Flamme als pulsierender Ring (wichtigster Ort)
    const c = g.buildings.center;
    if (c) {
      const fx = (c.x / TILE) * k, fy = (c.y / TILE) * k, pr = 5 + Math.sin(g.time * 4) * 1.5;
      m.strokeStyle = 'rgba(255,200,90,0.9)';
      m.lineWidth = 1.5;
      m.beginPath();
      m.arc(fx, fy, pr, 0, Math.PI * 2);
      m.stroke();
    }
    const p = g.player;
    if (!p.dead) {
      m.fillStyle = '#fff';
      m.fillRect(Math.floor((p.x / TILE) * k) - 2, Math.floor((p.y / TILE) * k) - 2, 4, 4);
    }
    const cam = g.camera;
    m.strokeStyle = 'rgba(255,255,255,0.6)';
    m.lineWidth = 1;
    m.strokeRect(Math.floor((cam.left / TILE) * k) + 0.5, Math.floor((cam.top / TILE) * k) + 0.5, Math.round((cam.viewW / TILE) * k), Math.round((cam.viewH / TILE) * k));
  }

  setHudVisible(v) {
    this.hud.hidden = !v;
    if (v) this.applyUnlocks();
  }

  /** HUD-Elemente zu den Freischalt-Schlüsseln. */
  unlockElements() {
    const map = {
      'hud.res': [this.resPanel], 'hud.settlers': [this.focusPanel], 'hud.clock': [this.dayPanel], 'hud.energy': [this.enRow],
      'hud.carry': [this.carryPanel], 'hud.minimap': [this.mini], buildbar: [this.buildBar], demolish: [this.buildBtns.demolish],
    };
    for (const type of BUILDABLE) map['b:' + type] = [this.buildBtns[type]];
    return map;
  }

  /** Gesperrtes ausblenden, Freigeschaltetes zeigen (Gebäude: nur die aktive Kategorie). */
  applyUnlocks() {
    const g = this.game, pr = g.progress;
    if (!pr) return;
    for (const [key, els] of Object.entries(this.unlockElements())) {
      if (key.startsWith('b:')) continue;
      for (const e of els) if (e) e.hidden = !pr.has(key);
    }
    this.applyBuildBar();
  }

  /** Bauleiste: Reiter der Kategorien mit verfügbaren Gebäuden, Knöpfe der aktiven Kategorie mit Tasten 1–9. */
  applyBuildBar() {
    const g = this.game;
    if (!g.flame) return;
    let visibleCats = 0;
    BUILD_CATEGORIES.forEach((c, i) => {
      const any = c.types.some((t) => g.isAvailable(t));
      if (any) visibleCats++;
      this.set('cat' + i, this.catBtns[i], !any, 'hidden');
      this.set('catc' + i, this.catBtns[i], 'cat-tab' + (g.buildCat === i ? ' active' : ''), 'className');
    });
    this.set('catTabs', this.catTabs, visibleCats < 2, 'hidden');
    if (!BUILD_CATEGORIES[g.buildCat].types.some((t) => g.isAvailable(t))) {
      const first = BUILD_CATEGORIES.findIndex((c) => c.types.some((t) => g.isAvailable(t)));
      if (first >= 0) g.buildCat = first;
    }
    const choices = g.buildChoices();
    for (const type of BUILDABLE) {
      const i = choices.indexOf(type);
      this.set('bv' + type, this.buildBtns[type], i < 0, 'hidden');
      if (i >= 0) this.set('bk' + type, this.buildKeys[type], String(i + 1));
    }
  }

  /** Frisch freigeschaltetes Element mit kurzer Animation einblenden. */
  reveal(key) {
    this.applyUnlocks();
    for (const e of this.unlockElements()[key] || []) {
      if (!e) continue;
      e.classList.remove('reveal');
      void e.offsetWidth; // Animation neu starten
      e.classList.add('reveal');
      setTimeout(() => e.classList.remove('reveal'), 1600);
    }
  }

  // ---------------------------------------------------------------- Overlays
  /** Overlay mit Karte anzeigen; buttons: [{ label, cls, onClick }] */
  showOverlay(cls, html, buttons = []) {
    const o = this.overlay;
    o.innerHTML = '';
    o.className = 'overlay ' + cls;
    const card = el('div', 'card', o, html);
    const row = el('div', 'btn-row', card);
    for (const b of buttons) {
      const btn = el('button', 'mbtn ' + (b.cls || ''), row, b.label);
      btn.type = 'button';
      btn.addEventListener('click', () => {
        this.game.audio.play('click');
        b.onClick();
      });
    }
    o.hidden = false;
    const first = row.querySelector('.mbtn.primary') || row.querySelector('.mbtn');
    if (first) first.focus({ preventScroll: true });
    return card;
  }

  hideOverlay() {
    this.overlay.hidden = true;
    this.overlay.innerHTML = '';
  }

  get overlayOpen() {
    return !this.overlay.hidden;
  }

  showMainMenu() {
    const g = this.game;
    const info = peekSave();
    const btns = [];
    if (info) btns.push({ label: `Fortsetzen <small>Tag ${info.day} · ${info.settlers} Siedler</small>`, cls: 'primary', onClick: () => g.continueGame() });
    btns.push({ label: 'Neues Spiel', cls: info ? '' : 'primary', onClick: () => (info ? this.confirmNew() : g.startNewGame()) });
    btns.push({ label: 'Neues Spiel <small>Tutorial überspringen – alles freigeschaltet</small>', onClick: () => (info ? this.confirmNew(true) : g.startNewGame({ skipTutorial: true })) });
    btns.push({ label: 'Intro ansehen', onClick: () => g.watchIntro() });
    btns.push({ label: 'Steuerung', onClick: () => this.showHelp(() => this.showMainMenu()) });
    this.showOverlay('menu', `
      <div class="title">CINIS</div>
      <div class="subtitle">Die letzte Flamme</div>
      <p class="lore">Rom ist gefallen, Asche bedeckt die sieben Hügel. Nachts kriecht sie als Gestalt aus den Ruinen.
      Nur die Ewige Flamme hält sie fern. Finde Überlebende, baue auf und halte das Licht am Leben, Nacht für Nacht, so lange du kannst.</p>
      ${this.scoreHtml()}`, btns);
  }

  /** Bestwert und Bestenliste (Hauptmenü, Game Over). */
  scoreHtml(highlight = null) {
    const top = loadScores().top;
    if (!top.length) return '<p class="best">Noch kein Rekord – wie viele Nächte hältst du durch?</p>';
    const rows = top.map((e, i) => `<tr class="${e === highlight || (highlight && e.date === highlight.date) ? 'me' : ''}"><td>${i + 1}.</td><td>${e.nights} ${e.nights === 1 ? 'Nacht' : 'Nächte'}</td><td>${e.kills} Feinde</td><td>${e.rescued} gerettet</td><td class="seed">Seed ${e.seed}</td></tr>`).join('');
    return `<div class="best">Rekord: <b>${top[0].nights} ${top[0].nights === 1 ? 'Nacht' : 'Nächte'}</b></div><table class="scores">${rows}</table>`;
  }

  confirmNew(skipTutorial = false) {
    this.showOverlay('menu', `<h2>Neues Spiel?</h2><p>Der bisherige Spielstand wird überschrieben.</p>`, [
      { label: 'Ja, neu beginnen', cls: 'primary danger', onClick: () => this.game.startNewGame({ skipTutorial }) },
      { label: 'Zurück', onClick: () => this.showMainMenu() },
    ]);
  }

  showPause() {
    const g = this.game;
    const best = bestScore();
    this.showOverlay('pause', `<h2>Pause</h2><p>Tag ${g.cycle.day} · ${g.settlers.colony.length} Siedler · ${g.stats.kills} Feinde besiegt</p><p class="sub">Seed ${g.seed}${best ? ` · Rekord: ${best.nights} Nächte` : ''}</p>`, [
      { label: 'Weiter', cls: 'primary', onClick: () => g.resume() },
      { label: 'Steuerung', onClick: () => this.showHelp(() => this.showPause()) },
      { label: `Ton: ${g.audio.muted ? 'aus' : 'an'}`, onClick: () => { g.toggleSound(); this.showPause(); } },
      { label: 'Speichern &amp; Hauptmenü', onClick: () => g.toMainMenu() },
    ]);
  }

  showHelp(back) {
    this.showOverlay('help', `<h2>Steuerung</h2>${HELP}`, [{ label: 'Zurück', cls: 'primary', onClick: back }]);
  }

  showEnd(result) {
    const g = this.game, st = g.stats, sc = g.score || { entry: { nights: Math.max(0, g.cycle.day - 1) }, record: false };
    const nights = sc.entry.nights;
    const why = g.overReason === 'out' ? 'Die Glut ist verloschen – kein Brennstoff mehr.' : 'Die Asche hat den Tempel der Flamme eingerissen.';
    this.showOverlay('end defeat', `
      <div class="title small">Die Flamme erlischt</div>
      <p>${why}</p>
      ${sc.record ? '<div class="record">★ Neuer Rekord! ★</div>' : ''}
      <table class="stats">
        <tr><td>Überstandene Nächte</td><td>${nights}</td></tr>
        <tr><td>Besiegte Feinde</td><td>${st.kills}</td></tr>
        <tr><td>Gerettete Siedler</td><td>${st.rescued || 0}</td></tr>
        <tr><td>Flammenstufe</td><td>${g.flame.level}</td></tr>
        <tr><td>Errichtete Gebäude</td><td>${st.built}</td></tr>
        <tr><td>Verlorene Siedler</td><td>${st.lost || 0}</td></tr>
        <tr><td>Seed</td><td>${g.seed}</td></tr>
      </table>
      ${this.scoreHtml(sc.entry)}`, [
      { label: 'Neues Spiel', cls: 'primary', onClick: () => g.startNewGame({ skipTutorial: g.progress.done }) },
      { label: `Neues Spiel (gleicher Seed ${g.seed})`, onClick: () => g.startNewGame({ seed: g.seed, skipTutorial: g.progress.done }) },
      { label: 'Hauptmenü', onClick: () => g.toMainMenu() },
    ]);
  }

  /** Text nur bei Änderung setzen. */
  set(key, elem, value, prop = 'textContent') {
    if (this.cache[key] === value) return;
    this.cache[key] = value;
    elem[prop] = value;
  }

  update(dt) {
    this.refreshT -= dt;
    if (this.refreshT > 0) return;
    this.refreshT = 0.1;
    const g = this.game, p = g.player;
    for (const k of RES_KEYS) {
      if (g.stock[k] >= 1 || p.inv.count(k) > 0) this.seenRes.add(k);
      this.set('res' + k, this.resEls[k], String(Math.floor(g.stock[k])));
      this.set('resv' + k, this.resRows[k], !this.seenRes.has(k), 'hidden');
    }
    this.set('resCompact', this.resPanel, 'panel res-panel' + (this.seenRes.size > 5 ? ' compact' : ''), 'className');
    this.updateCarry(g, p);
    this.set('hint', this.hint, this.contextHint());
    // Ziel-Banner
    const qb = g.progress && g.progress.banner();
    this.set('qVis', this.quest, !qb, 'hidden');
    // Meldungen rutschen unter das Ziel-Banner, wenn es unter der Tagesanzeige steht
    this.set('tLow', this.toasts, 'toasts' + (qb && g.progress.has('hud.clock') ? ' low' : ''), 'className');
    if (qb) {
      this.set('qTxt', this.questTxt, qb.text);
      this.set('qProg', this.questProg, qb.progress);
      this.set('qPos', this.quest, 'panel quest-banner' + (g.progress.has('hud.clock') ? ' below' : ''), 'className');
    }
    // Tag/Nacht
    const cy = g.cycle;
    this.set('day', this.dayEl, `Tag ${cy.day}`);
    let phase;
    if (cy.isNight) phase = `Nacht · Morgengrauen in ${fmtTime(cy.timeToDawn)} · ${g.enemies.list.filter((e) => !e.guard).length + g.enemies.queue.length} Feinde`;
    else if (cy.isEvening) phase = `Dämmerung · Nacht in ${fmtTime(cy.timeToNight)}`;
    else phase = `Tag · Nacht in ${fmtTime(cy.timeToNight)}`;
    this.set('phase', this.phaseEl, phase);
    this.set('phaseCls', this.phaseEl, 'day-phase' + (cy.isNight ? ' night' : cy.isEvening ? ' evening' : ''), 'className');
    this.set('mark', this.cycleMark.style, `${cy.progress * 100}%`, 'left');
    const ctr = g.buildings.center;
    const ck = ctr ? Math.max(0, ctr.hp / ctr.maxHp) : 0;
    this.set('flameW', this.flameBar.style, `${ck * 100}%`, 'width');
    this.set('flameT', this.flameTxt, `${Math.ceil(ck * 100)} %`);
    this.set('flameCls', this.flameBar, 'fill' + (ck < 0.35 ? ' low' : ''), 'className');
    // Spieler-LP
    this.set('hpW', this.hpBar.style, `${(p.hp / p.maxHp) * 100}%`, 'width');
    this.set('hpT', this.hpTxt, p.dead ? 'gefallen' : `${Math.ceil(p.hp)}`);
    this.set('enW', this.enBar.style, `${(p.energy / p.maxEnergy) * 100}%`, 'width');
    this.set('enT', this.enTxt, `${Math.floor(p.energy)}`);
    this.set('enCls', this.enRow, 'stat-row en-row' + (p.emptyFlash > 0 ? ' empty' : '') + (p.sprinting ? ' sprint' : ''), 'className');
    this.set('touch', this.root, g.input.usingTouch ? 'touch' : '', 'className');
    this.set('dashVis', this.dashBtn, !g.progress.has('hud.energy'), 'hidden');
    this.set('speed', this.speedBtn, `${g.speed}×`);
    this.set('sound', this.soundBtn, g.audio.muted ? '✕' : '♪');
    this.set('soundCls', this.soundBtn, g.audio.muted ? 'cbtn off' : 'cbtn', 'className');
    const st = g.settlers;
    const colony = st.colony;
    this.set('pop', this.popEl, `${colony.length}/${st.capacity(g)}`);
    const needy = colony.filter((s) => s.hunger <= 0 || s.thirst <= 0).length;
    const hungry = colony.filter((s) => s.hunger < SETTLER.needAt || s.thirst < SETTLER.needAt).length;
    this.set('popLbl', this.popLbl, needy ? `Siedler · ${needy} leiden!` : hungry ? `Siedler · ${hungry} bedürftig` : 'Siedler');
    this.set('popCls', this.popLbl, needy ? 'lbl danger' : 'lbl', 'className');
    for (const f of FOCI) this.set('f' + f.id, this.focusBtns[f.id], st.focus === f.id ? 'fbtn active' : 'fbtn', 'className');
    this.applyBuildBar();
    this.updateFlameRow(g);
    const bs = g.buildings;
    for (const type of [...BUILDABLE, 'demolish']) {
      const btn = this.buildBtns[type];
      const cls = 'bslot' + (bs.selected === type ? ' active' : '') + (type !== 'demolish' && !bs.canAfford(g, BUILDING_DEFS[type].cost) ? ' poor' : '');
      this.set('b' + type, btn, cls, 'className');
    }
  }

  /** Flammenstufe, Glut und Bedarf pro Nacht (grün gedeckt, gelb knapp, rot fehlt). */
  updateFlameRow(g) {
    const f = g.flame;
    this.set('lvl', this.lvlEl, `Stufe ${f.level}`);
    this.set('vigW', this.vigorBar.style, `${f.k * 100}%`, 'width');
    this.set('vigC', this.vigorBar, 'fill' + (f.vigor < 35 ? ' low' : ''), 'className');
    const parts = Object.entries(f.def.fuel).map(([k, n]) => `${n} ${RES[k].name}`);
    const cover = f.fuelCovered(g.stock, 3) ? 'ok' : f.fuelCovered(g.stock, 1) ? 'warn' : 'bad';
    this.set('fuel', this.fuelEl, `${parts.join(' + ')} / Nacht`);
    this.set('fuelC', this.fuelEl, 'fuel-txt ' + cover, 'className');
  }

  /** Fenster der Ewigen Flamme: Stufe und Glut, Upgrade mit Vorschau, Brennstoff nachlegen, Herstellen. */
  showFlame() {
    const g = this.game, f = g.flame, B = g.buildings;
    const fuel = (def) => Object.entries(def.fuel).map(([k, n]) => `${n} ${RES[k].name}`).join(' + ');
    const nx = f.next;
    let html = `<h2>Die Ewige Flamme · Stufe ${f.level}</h2>
      <p class="sub">Glut ${Math.round(f.vigor)} % · Licht ${Math.round(f.light / 16)} Felder · Bauradius ${f.territory} · bis ${f.popCap} Siedler · Brennstoff pro Nacht: ${fuel(f.def)}</p>`;
    const card = this.showOverlay('crafting flame-panel', html, [{ label: 'Schließen (Esc)', cls: 'primary', onClick: () => g.closePanel() }]);
    const box = el('div', 'flame-box');
    card.insertBefore(box, card.querySelector('.btn-row'));
    if (nx) {
      const up = el('div', 'craft-row', box);
      const mid = el('div', 'craft-mid', up);
      el('div', 'craft-name', mid, `Entfachen: Stufe ${f.level + 1}`);
      const unlocks = Object.entries(BUILDING_DEFS).filter(([, d]) => d.unlock && d.unlock.level === f.level + 1).map(([, d]) => d.name);
      el('div', 'craft-desc', mid, `Licht ${Math.round(nx.light / 16)} Felder · Bauradius ${nx.territory} · bis ${nx.pop} Siedler${nx.aura ? ` · Schutzaura ${nx.aura}/s` : ''}${unlocks.length ? ` · neu: ${unlocks.join(', ')}` : ''}<br><b>Neuer Bedarf pro Nacht: ${fuel(nx)}</b>`);
      const cost = el('div', 'craft-cost', mid);
      for (const [k, n] of Object.entries(nx.cost)) {
        const have = (g.stock[k] || 0) + g.player.inv.count(k);
        const c = el('span', 'c' + (have >= n ? '' : ' miss'), cost);
        const ci = el('img', 'ci', c);
        ci.src = iconURL(k);
        el('span', '', c, `${n}`);
        c.title = `${RES[k].name}: ${Math.floor(have)} vorhanden`;
      }
      const btn = el('button', 'mbtn small', up, 'Entfachen');
      btn.type = 'button';
      btn.disabled = !f.canUpgrade(g);
      btn.addEventListener('click', () => {
        if (f.upgrade(g)) this.showFlame();
      });
    } else el('div', 'craft-desc', box, `Die Flamme brennt auf der höchsten Stufe (${MAX_LEVEL}).`);
    const feed = el('div', 'craft-row', box);
    const fm = el('div', 'craft-mid', feed);
    el('div', 'craft-name', fm, 'Brennstoff nachlegen');
    el('div', 'craft-desc', fm, 'Füllt die Glut aus Lager und Gepäck auf (Holz +2, Kohle +5, Harz +6, Kräuteröl +12 je Einheit).');
    const fb = el('button', 'mbtn small', feed, 'Nachlegen');
    fb.type = 'button';
    fb.disabled = f.vigor >= 100;
    fb.addEventListener('click', () => {
      const gain = f.feed(g);
      this.toast(gain > 0 ? `Die Glut steigt auf ${Math.round(f.vigor)} %.` : 'Kein Brennstoff vorhanden.', gain > 0 ? 'good' : 'warn');
      if (gain > 0) g.audio.play('torch');
      this.showFlame();
    });
    el('h3', 'flame-sub', box, 'Herstellen');
    this.fillRecipes(box, 'flame', () => this.showFlame());
  }

  /** Gepäck-Leiste: Belegung, Hotbar, Kurzliste der Rohstoffe. */
  updateCarry(g, p) {
    const inv = p.inv;
    this.set('carryL', this.carryLbl, `Gepäck ${inv.used}/${inv.size}`);
    this.set('carryW', this.carryBar.style, `${(inv.used / inv.size) * 100}%`, 'width');
    const parts = RES_KEYS.filter((k) => inv.count(k) > 0).map((k) => `${inv.count(k)} ${RES[k].name}`);
    this.set('carryT', this.carryTxt, parts.join(', '));
    const hs = this.hotSlots;
    const icon = (k) => (Sprites.icons[k] ? iconURL(k) : '');
    this.set('hW', hs.weapon.img, icon(inv.has('ironSword') ? 'ironSword' : 'sword'), 'src');
    this.set('hWt', hs.weapon.slot, inv.has('ironSword') ? 'Eisenschwert (Schaden 32)' : 'Gladius (Schaden 20)', 'title');
    const gear = inv.has('armor') ? 'armor' : inv.has('boots') ? 'boots' : null;
    this.set('hA', hs.armor.img, gear ? icon(gear) : '', 'src');
    this.set('hAc', hs.armor.slot, 'hslot' + (gear ? '' : ' empty'), 'className');
    this.set('hAn', hs.armor.n, inv.has('armor') && inv.has('boots') ? '+' : '');
    this.set('hT', hs.torch.img, icon('torch'), 'src');
    const torches = inv.count('torch');
    this.set('hTn', hs.torch.n, p.torchOn ? `${Math.ceil(p.torchT)}s` : torches ? String(torches) : '');
    this.set('hTc', hs.torch.slot, 'hslot' + (p.torchOn ? ' on' : torches || p.torchT ? '' : ' empty'), 'className');
    this.set('hB', hs.bandage.img, icon('bandage'), 'src');
    const band = inv.count('bandage');
    this.set('hBn', hs.bandage.n, band ? String(band) : '');
    this.set('hBc', hs.bandage.slot, 'hslot' + (band ? '' : ' empty'), 'className');
    this.set('bagVis', this.bagBtn, !g.progress.has('hud.inventory'), 'hidden');
  }

  // ---------------------------------------------------------------- Inventar, Herstellung, Handel
  /** Raster mit allen Slots; Klick auf Verband/Fackel benutzt sie. */
  showInventory() {
    const g = this.game, inv = g.player.inv;
    const card = this.showOverlay('inventory', `<h2>Gepäck</h2><p class="sub">${inv.used} von ${inv.size} Plätzen belegt · Ausrüstung wirkt, solange du sie trägst · Rohstoffe lieferst du an der Flamme ab</p>`, [
      { label: 'Schließen (I)', cls: 'primary', onClick: () => g.toggleInventory() },
    ]);
    const grid = el('div', 'inv-grid');
    card.insertBefore(grid, card.querySelector('.btn-row'));
    const tip = el('div', 'inv-tip', card, 'Fahre über einen Platz, um mehr zu erfahren.');
    card.insertBefore(tip, card.querySelector('.btn-row'));
    inv.slots.forEach((sl) => {
      const cell = el('div', 'inv-slot' + (sl ? '' : ' empty'), grid);
      if (!sl) return;
      const info = itemInfo(sl.id);
      const img = el('img', 'inv-icon', cell);
      img.src = Sprites.icons[sl.id] ? iconURL(sl.id) : iconURL('bag');
      img.alt = info.name;
      if (sl.n > 1) el('span', 'inv-n', cell, String(sl.n));
      cell.addEventListener('mouseenter', () => (tip.innerHTML = `<b>${info.name}</b>${sl.n > 1 ? ` ×${sl.n}` : ''} – ${info.desc}`));
      if (sl.id === 'bandage' || sl.id === 'torch') {
        cell.classList.add('usable');
        cell.addEventListener('click', () => {
          if (sl.id === 'bandage') g.player.useBandage(g);
          else g.player.toggleTorch(g);
          this.showInventory();
        });
      }
    });
  }

  /** Herstellungs-Menü einer Station (Flamme, Werkbank, Schmiede). */
  showCrafting(station) {
    const g = this.game;
    const card = this.showOverlay('crafting', `<h2>${STATION_NAMES[station]}</h2><p class="sub">Bezahlt wird aus dem Lager und deinem Gepäck.</p>`, [
      { label: 'Schließen (Esc)', cls: 'primary', onClick: () => g.closePanel() },
    ]);
    const box = el('div', 'flame-box');
    card.insertBefore(box, card.querySelector('.btn-row'));
    this.fillRecipes(box, station, () => this.showCrafting(station));
  }

  /** Rezeptliste einer Station in parent einfügen; refresh baut das Fenster nach dem Herstellen neu. */
  fillRecipes(parent, station, refresh) {
    const g = this.game, B = g.buildings, p = g.player;
    const list = el('div', 'craft-list', parent);
    for (const r of RECIPES.filter((x) => x.station === station)) {
      const unlocked = recipeUnlocked(g, r);
      const row = el('div', 'craft-row' + (unlocked ? '' : ' locked'), list);
      const icon = el('img', 'inv-icon', row);
      const outId = r.out.item || r.out.res;
      icon.src = Sprites.icons[outId] ? iconURL(outId) : iconURL('bag');
      const mid = el('div', 'craft-mid', row);
      el('div', 'craft-name', mid, recipeName(r));
      el('div', 'craft-desc', mid, unlocked ? recipeDesc(r) : lockText(g, r));
      const cost = el('div', 'craft-cost', mid);
      for (const [k, n] of Object.entries(r.cost)) {
        const have = (g.stock[k] || 0) + p.inv.count(k);
        const c = el('span', 'c' + (have >= n ? '' : ' miss'), cost);
        const ci = el('img', 'ci', c);
        ci.src = iconURL(k);
        ci.alt = RES[k].name;
        el('span', '', c, `${n}`);
        c.title = `${RES[k].name}: ${Math.floor(have)} vorhanden`;
      }
      const owned = r.unique && p.inv.has(r.out.item);
      const btn = el('button', 'mbtn small', row, owned ? 'Vorhanden' : 'Herstellen');
      btn.type = 'button';
      btn.disabled = !unlocked || owned || !B.canAfford(g, r.cost);
      btn.addEventListener('click', () => {
        const err = craft(g, r);
        if (err) this.toast(err, 'warn', 'craft');
        else this.toast(`Hergestellt: ${recipeName(r)}`, 'good');
        refresh();
      });
    }
  }

  /** Händler: Tauschangebote (aus Lager und Gepäck, Ware ins Gepäck bzw. als Bauplan). */
  showTrader(trader) {
    const g = this.game, B = g.buildings;
    const card = this.showOverlay('crafting', `<h2>Händler</h2><p class="sub">„Gute Ware für gute Ware, Hüter.“ Bezahlt wird aus Lager und Gepäck.</p>`, [
      { label: 'Schließen (Esc)', cls: 'primary', onClick: () => g.closePanel() },
    ]);
    const list = el('div', 'craft-list');
    card.insertBefore(list, card.querySelector('.btn-row'));
    trader.offers.forEach((o) => {
      const row = el('div', 'craft-row' + (o.sold ? ' locked' : ''), list);
      const icon = el('img', 'inv-icon', row);
      icon.src = o.blueprint ? iconURL('bag') : iconURL(o.give);
      const mid = el('div', 'craft-mid', row);
      el('div', 'craft-name', mid, o.blueprint ? `Bauplan: ${o.label}` : `${o.n} × ${RES[o.give].name}`);
      const cost = el('div', 'craft-cost', mid);
      for (const [k, n] of Object.entries(o.cost)) {
        const have = (g.stock[k] || 0) + g.player.inv.count(k);
        const c = el('span', 'c' + (have >= n ? '' : ' miss'), cost);
        const ci = el('img', 'ci', c);
        ci.src = iconURL(k);
        el('span', '', c, `${n}`);
      }
      const btn = el('button', 'mbtn small', row, o.sold ? 'Verkauft' : 'Tauschen');
      btn.type = 'button';
      btn.disabled = o.sold || !B.canAfford(g, o.cost);
      btn.addEventListener('click', () => {
        g.pois.trade(g, trader, o);
        this.showTrader(trader);
      });
    });
  }

  /** Kontextabhängiger Steuerungshinweis am unteren Rand. */
  contextHint() {
    const g = this.game, p = g.player, touch = g.input.usingTouch;
    const key = touch ? 'Tippen' : '[Leertaste/Klick]';
    const bs = g.buildings;
    if (g.over) return '';
    if (p.dead) return '';
    if (bs.selected === 'demolish') return touch ? 'Gebäude antippen zum Abreißen' : 'Gebäude anklicken zum Abreißen · Rechtsklick/Esc: beenden';
    if (bs.selected) {
      const def = BUILDING_DEFS[bs.selected];
      if (bs.ghost && !bs.ghost.ok) return `${def.name}: ${bs.ghost.reason}`;
      const tail = bs.ghost && !bs.ghost.afford ? ' – das Material wird nach und nach angeliefert' : '';
      const rot = bs.selected === 'wall' || bs.selected === 'gate' ? ` · R/Mausrad: Ausrichtung (${bs.rotationLabel})` : '';
      return touch ? `${def.name} – zum Bauen tippen${tail}` : `${def.name} – Klick: Baustelle setzen${bs.selected === 'wall' ? ' (ziehen für Linien)' : ''}${rot}${tail} · Rechtsklick/Esc: abbrechen`;
    }
    if (p.inv.full) return 'Dein Gepäck ist voll – zurück zur Ewigen Flamme, um Rohstoffe abzuliefern.';
    if (g.enemies.list.some((e) => !e.dead && Math.hypot(e.x - p.x, e.y - p.y) < 40)) return `${key} Angreifen`;
    const t = p.target;
    if (t && t.label) return `${touch ? 'Tippen' : t.eOnly ? '[E]' : '[E/Leertaste]'} ${t.label}`;
    return '';
  }

  /**
   * Meldung einblenden. kind: info | warn | danger | good.
   * key: gleiche Meldung höchstens alle 4 s.
   */
  toast(msg, kind = 'info', key = null) {
    if (key) {
      const now = performance.now();
      if (this.toastKeys[key] && now - this.toastKeys[key] < 4000) return;
      this.toastKeys[key] = now;
    }
    const t = el('div', `toast ${kind}`, this.toasts, msg);
    while (this.toasts.children.length > 3) this.toasts.firstChild.remove();
    setTimeout(() => t.classList.add('out'), 3200);
    setTimeout(() => t.remove(), 3800);
  }
}
