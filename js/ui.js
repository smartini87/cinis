// ui.js – DOM-HUD über dem Canvas: Ressourcen, Traglast, Hinweise, Meldungen.

import { RES, RES_KEYS } from './config.js';
import { iconURL, buildingPreviewURL } from './sprites.js';
import { BUILDING_DEFS, BUILDABLE } from './buildings.js';
import { FOCI } from './settlers.js';
import { SETTLER, WIN_NIGHTS } from './config.js';
import { DAY_LEN, CYCLE } from './time.js';
import { fmtTime } from './util.js';

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
        this.game.audio?.play('click');
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
        this.game.audio?.play('click');
      });
      this.buildBtns[type] = btn;
    }
    // Hinweiszeile + Meldungen
    this.hint = el('div', 'hint', hud);
    this.toasts = el('div', 'toasts', hud);
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
    if (t) {
      if (t.kind === 'water') return `${key} Wasser schöpfen`;
      const verbs = { tree: 'Holz fällen', rock: 'Stein brechen', bush: 'Feigen pflücken' };
      return `${key} ${verbs[t.node.type]}`;
    }
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
