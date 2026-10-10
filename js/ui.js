// ui.js – DOM-HUD über dem Canvas: Ressourcen, Traglast, Hinweise, Meldungen.

import { RES, RES_KEYS } from './config.js';
import { iconURL } from './sprites.js';

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
  }

  /** Kontextabhängiger Steuerungshinweis am unteren Rand. */
  contextHint() {
    const g = this.game, p = g.player, touch = g.input.usingTouch;
    const key = touch ? 'Tippen' : '[Leertaste/Klick]';
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
