// ui.js – DOM-HUD über dem Canvas: Ressourcen, Traglast, Hinweise, Meldungen.

import { RES, RES_KEYS } from './config.js';
import { iconURL, buildingPreviewURL } from './sprites.js';
import { BUILDING_DEFS, BUILDABLE } from './buildings.js';

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
    if (bs.selected === 'demolish') return touch ? 'Gebäude antippen zum Abreißen' : 'Gebäude anklicken zum Abreißen · Rechtsklick/Esc: beenden';
    if (bs.selected) {
      const def = BUILDING_DEFS[bs.selected];
      if (bs.ghost && !bs.ghost.ok) return `${def.name}: ${bs.ghost.reason}`;
      return touch ? `${def.name} – zum Bauen tippen` : `${def.name} – Klick: bauen${bs.selected === 'wall' ? ' (ziehen für Reihen)' : ''} · Rechtsklick/Esc: abbrechen`;
    }
    if (p.carried >= p.capacity) return 'Voll beladen – zurück zur Ewigen Flamme, um abzuliefern.';
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
