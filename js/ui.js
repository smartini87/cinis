// ui.js – DOM-Oberfläche über dem Canvas: HUD (Ressourcen, Tag/Nacht, LP, Bauleiste, Hinweise, Meldungen)
// sowie Overlays (Hauptmenü, Pause, Tutorial, Hilfe, Sieg/Niederlage).

import { RES, RES_KEYS } from './config.js';
import { iconURL, buildingPreviewURL } from './sprites.js';
import { BUILDING_DEFS, BUILDABLE } from './buildings.js';
import { FOCI } from './settlers.js';
import { SETTLER, WIN_NIGHTS, TILE } from './config.js';
import { DAY_LEN, CYCLE } from './time.js';
import { fmtTime } from './util.js';
import { peekSave } from './save.js';

const TUTORIAL = [
  ['Die letzte Flamme', 'Rom liegt in Asche. Im Zentrum der Ruinen brennt die <b>Ewige Flamme</b>. Erlischt sie, ist alles verloren. Halte sie <b>30 Nächte</b> lang am Leben.'],
  ['Sammeln', 'Bewege dich mit <b>WASD</b>. Halte <b>Leertaste</b> oder die <b>linke Maustaste</b> an Bäumen, Trümmern, Feigensträuchern oder am Wasser, um Holz, Stein, Nahrung und Wasser zu sammeln. Du trägst bis zu 30 Einheiten – an der Flamme lieferst du automatisch ab.'],
  ['Bauen', 'Wähle Gebäude mit <b>1–5</b> oder über die Bauleiste und setze sie per Klick. <b>Hütten</b> bieten Platz für neue Siedler, <b>Farmen</b> und <b>Brunnen</b> versorgen sie, <b>Mauern</b> und <b>Türme</b> schützen die Flamme.'],
  ['Siedler', 'Siedler arbeiten selbstständig. Sie brauchen <b>Nahrung</b> und <b>Wasser</b> aus dem Lager. Jeden Morgen kommen neue hinzu, wenn Platz und Nahrung vorhanden sind. Links wählst du, was sie bevorzugt sammeln.'],
  ['Die Nacht', 'Bei Einbruch der Nacht kriechen <b>Aschgänger</b> aus den Ruinen – jede Nacht mehr. Rote Pfeile am Rand zeigen, woher sie kommen. Kämpfe mit dem Gladius, baue Türme hinter Mauern. Das erste Sonnenlicht verbrennt sie.'],
];

const HELP = `
<table class="keys">
<tr><td>WASD / Pfeile</td><td>Bewegen</td></tr>
<tr><td>Leertaste / E / Linksklick</td><td>Sammeln &amp; angreifen (gedrückt halten)</td></tr>
<tr><td>1 – 5 / Bauleiste</td><td>Gebäude wählen, Klick setzt es</td></tr>
<tr><td>Rechtsklick / Esc</td><td>Bauen abbrechen</td></tr>
<tr><td>X</td><td>Abriss (50 % Rückerstattung)</td></tr>
<tr><td>F</td><td>Tempo 1× / 2× / 3×</td></tr>
<tr><td>P / Esc</td><td>Pause</td></tr>
<tr><td>M</td><td>Ton an/aus</td></tr>
<tr><td>Mausrad</td><td>Zoom</td></tr>
<tr><td>H</td><td>Diese Hilfe</td></tr>
<tr><td>Touch</td><td>Links ziehen = laufen, tippen = Aktion/Bauen</td></tr>
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
    const res = el('div', 'panel res-panel', hud);
    this.resEls = {};
    for (const k of RES_KEYS) {
      const row = el('div', 'res-row', res);
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
    pop.title = 'Siedler / Plätze. Neue Siedler kommen, wenn Platz (Hütten) und Nahrung da sind.';
    // Arbeitsschwerpunkt der Sammler
    const focus = el('div', 'panel focus-panel', hud);
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
    const day = el('div', 'panel day-panel', hud);
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
    // Lebenspunkte des Spielers
    const hp = el('div', 'panel hp-panel', hud);
    const himg = el('img', 'icon small', hp);
    himg.src = iconURL('heart');
    himg.alt = 'Leben';
    this.hpBar = el('div', 'fill', el('div', 'bar hp-bar', hp));
    this.hpTxt = el('span', 'hp-txt', hp);
    // Traglast
    const carry = el('div', 'panel carry-panel', hud);
    el('div', 'lbl', carry, 'Getragen');
    this.carryBar = el('div', 'fill', el('div', 'bar', carry));
    this.carryTxt = el('div', 'carry-txt', carry);
    // Bauleiste (unten Mitte)
    this.buildBar = el('div', 'panel buildbar', hud);
    this.buildBtns = {};
    for (const type of [...BUILDABLE, 'demolish']) {
      const btn = el('button', 'bslot', this.buildBar);
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
        el('span', 'bkey', btn, def.key);
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
    for (const s of g.settlers.list) if (!s.hidden) m.fillRect(Math.floor((s.x / TILE) * k) - 1, Math.floor((s.y / TILE) * k) - 1, 2, 2);
    m.fillStyle = '#ff4030';
    for (const e of g.enemies.list) {
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
    btns.push({ label: 'Steuerung', onClick: () => this.showHelp(() => this.showMainMenu()) });
    this.showOverlay('menu', `
      <div class="title">CINIS</div>
      <div class="subtitle">Die letzte Flamme</div>
      <p class="lore">Rom ist gefallen. Asche bedeckt die sieben Hügel, und nachts kriecht sie als Gestalt aus den Ruinen.
      Nur die Ewige Flamme hält sie fern. Sammle die Überlebenden, baue auf, verteidige das Licht – 30 Nächte lang.</p>`, btns);
  }

  confirmNew() {
    this.showOverlay('menu', `<h2>Neues Spiel?</h2><p>Der bisherige Spielstand wird überschrieben.</p>`, [
      { label: 'Ja, neu beginnen', cls: 'primary danger', onClick: () => this.game.startNewGame() },
      { label: 'Zurück', onClick: () => this.showMainMenu() },
    ]);
  }

  showPause() {
    const g = this.game;
    this.showOverlay('pause', `<h2>Pause</h2><p>Tag ${g.cycle.day} · ${g.settlers.list.length} Siedler · ${g.stats.kills} Feinde besiegt</p>`, [
      { label: 'Weiter', cls: 'primary', onClick: () => g.resume() },
      { label: 'Steuerung', onClick: () => this.showHelp(() => this.showPause()) },
      { label: `Ton: ${g.audio.muted ? 'aus' : 'an'}`, onClick: () => { g.toggleSound(); this.showPause(); } },
      { label: 'Speichern &amp; Hauptmenü', onClick: () => g.toMainMenu() },
    ]);
  }

  showHelp(back) {
    this.showOverlay('help', `<h2>Steuerung</h2>${HELP}`, [{ label: 'Zurück', cls: 'primary', onClick: back }]);
  }

  /** Mehrseitiges Tutorial; onDone wird nach der letzten Seite oder beim Überspringen aufgerufen. */
  showTutorial(onDone, page = 0) {
    const [title, text] = TUTORIAL[page];
    const last = page === TUTORIAL.length - 1;
    const dots = TUTORIAL.map((_, i) => `<span class="dot${i === page ? ' on' : ''}"></span>`).join('');
    this.showOverlay('tutorial', `<div class="tut-step">Einführung ${page + 1}/${TUTORIAL.length}</div><h2>${title}</h2><p>${text}</p><div class="dots">${dots}</div>`, [
      { label: last ? 'Los geht\'s!' : 'Weiter', cls: 'primary', onClick: () => (last ? onDone() : this.showTutorial(onDone, page + 1)) },
      ...(last ? [] : [{ label: 'Überspringen', onClick: onDone }]),
    ]);
  }

  showEnd(result) {
    const g = this.game, st = g.stats;
    const win = result === 'victory';
    const nights = win ? WIN_NIGHTS : Math.max(0, g.cycle.day - 1);
    this.showOverlay(win ? 'end victory' : 'end defeat', `
      <div class="title small">${win ? 'Sieg' : 'Die Flamme erlischt'}</div>
      <p>${win ? 'Dreißig Nächte hat das Licht der Asche getrotzt. Aus der Ruine wird wieder eine Stadt.' : 'Die Asche hat das letzte Licht Roms verschlungen.'}</p>
      <table class="stats">
        <tr><td>Überstandene Nächte</td><td>${nights} / ${WIN_NIGHTS}</td></tr>
        <tr><td>Besiegte Feinde</td><td>${st.kills}</td></tr>
        <tr><td>Errichtete Gebäude</td><td>${st.built}</td></tr>
        <tr><td>Siedler am Ende</td><td>${g.settlers.list.length}</td></tr>
        <tr><td>Verlorene Siedler</td><td>${st.lost || 0}</td></tr>
      </table>`, [
      { label: 'Neues Spiel', cls: 'primary', onClick: () => g.startNewGame() },
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
    for (const k of RES_KEYS) this.set('res' + k, this.resEls[k], String(Math.floor(g.stock[k])));
    const c = p.carried;
    this.set('carryW', this.carryBar.style, `${(c / p.capacity) * 100}%`, 'width');
    const parts = RES_KEYS.filter((k) => p.inv[k] > 0).map((k) => `${p.inv[k]} ${RES[k].name}`);
    this.set('carryT', this.carryTxt, `${c}/${p.capacity}` + (parts.length ? ' · ' + parts.join(', ') : ''));
    this.set('hint', this.hint, this.contextHint());
    // Tag/Nacht
    const cy = g.cycle;
    this.set('day', this.dayEl, `Tag ${Math.min(cy.day, WIN_NIGHTS)} / ${WIN_NIGHTS}`);
    let phase;
    if (cy.isNight) phase = `Nacht · Morgengrauen in ${fmtTime(cy.timeToDawn)} · ${g.enemies.list.length + g.enemies.queue.length} Feinde`;
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
    this.set('speed', this.speedBtn, `${g.speed}×`);
    this.set('sound', this.soundBtn, g.audio.muted ? '✕' : '♪');
    this.set('soundCls', this.soundBtn, g.audio.muted ? 'cbtn off' : 'cbtn', 'className');
    const st = g.settlers;
    this.set('pop', this.popEl, `${st.list.length}/${st.capacity(g)}`);
    const needy = st.list.filter((s) => s.hunger <= 0 || s.thirst <= 0).length;
    const hungry = st.list.filter((s) => s.hunger < SETTLER.needAt || s.thirst < SETTLER.needAt).length;
    this.set('popLbl', this.popLbl, needy ? `Siedler · ${needy} leiden!` : hungry ? `Siedler · ${hungry} bedürftig` : 'Siedler');
    this.set('popCls', this.popLbl, needy ? 'lbl danger' : 'lbl', 'className');
    for (const f of FOCI) this.set('f' + f.id, this.focusBtns[f.id], st.focus === f.id ? 'fbtn active' : 'fbtn', 'className');
    const bs = g.buildings;
    for (const type of [...BUILDABLE, 'demolish']) {
      const btn = this.buildBtns[type];
      const cls = 'bslot' + (bs.selected === type ? ' active' : '') + (type !== 'demolish' && !bs.canAfford(g, BUILDING_DEFS[type].cost) ? ' poor' : '');
      this.set('b' + type, btn, cls, 'className');
    }
  }

  /** Kontextabhängiger Steuerungshinweis am unteren Rand. */
  contextHint() {
    const g = this.game, p = g.player, touch = g.input.usingTouch;
    const key = touch ? 'Tippen' : '[Leertaste/Klick]';
    const bs = g.buildings;
    if (g.over) return '';
    if (p.dead) return `Du bist gefallen – Rückkehr an der Flamme in ${Math.ceil(p.respawnT)} s`;
    if (bs.selected === 'demolish') return touch ? 'Gebäude antippen zum Abreißen' : 'Gebäude anklicken zum Abreißen · Rechtsklick/Esc: beenden';
    if (bs.selected) {
      const def = BUILDING_DEFS[bs.selected];
      if (bs.ghost && !bs.ghost.ok) return `${def.name}: ${bs.ghost.reason}`;
      return touch ? `${def.name} – zum Bauen tippen` : `${def.name} – Klick: bauen${bs.selected === 'wall' ? ' (ziehen für Reihen)' : ''} · Rechtsklick/Esc: abbrechen`;
    }
    if (p.carried >= p.capacity) return 'Voll beladen – zurück zur Ewigen Flamme, um abzuliefern.';
    if (g.enemies.list.some((e) => !e.dead && Math.hypot(e.x - p.x, e.y - p.y) < 40)) return `${key} Angreifen`;
    const t = p.target;
    if (t && t.label) return `${touch ? 'Tippen' : '[E/Leertaste]'} ${t.label}`;
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
    while (this.toasts.children.length > 4) this.toasts.firstChild.remove();
    setTimeout(() => t.classList.add('out'), 3200);
    setTimeout(() => t.remove(), 3800);
  }
}
