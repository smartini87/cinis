// inventory.js – Spieler-Inventar mit Slots und Stapeln. Rohstoffe stapeln bis RES_STACK, Gegenstände nach
// ihrer Stapelgröße. Für Rohstoffe gibt es zusätzlich Kurzzugriffe (inv.wood lesen/setzen).

import { RES_KEYS, INV_SLOTS } from './config.js';
import { itemInfo } from './items.js';

export class Inventory {
  constructor(size = INV_SLOTS) {
    this.size = size;
    this.slots = new Array(size).fill(null);   // { id, n } oder null
    this.version = 0;                           // ändert sich bei jedem Zugriff (UI)
  }

  count(id) {
    let n = 0;
    for (const s of this.slots) if (s && s.id === id) n += s.n;
    return n;
  }

  has(id, n = 1) {
    return this.count(id) >= n;
  }

  /** Wie viele Einheiten von id passen noch hinein? */
  room(id) {
    const stack = itemInfo(id).stack;
    let r = 0;
    for (const s of this.slots) {
      if (!s) r += stack;
      else if (s.id === id) r += stack - s.n;
    }
    return r;
  }

  /** Hinzufügen; liefert die Menge, die nicht mehr passte. */
  add(id, n) {
    if (n <= 0) return 0;
    const stack = itemInfo(id).stack;
    for (const s of this.slots) {
      if (n <= 0) break;
      if (s && s.id === id && s.n < stack) {
        const k = Math.min(n, stack - s.n);
        s.n += k;
        n -= k;
      }
    }
    for (let i = 0; i < this.size && n > 0; i++) {
      if (this.slots[i]) continue;
      const k = Math.min(n, stack);
      this.slots[i] = { id, n: k };
      n -= k;
    }
    this.version++;
    return n;
  }

  /** Entfernen; liefert die tatsächlich entnommene Menge. */
  remove(id, n) {
    let took = 0;
    for (let i = this.size - 1; i >= 0 && took < n; i--) {
      const s = this.slots[i];
      if (!s || s.id !== id) continue;
      const k = Math.min(n - took, s.n);
      s.n -= k;
      took += k;
      if (s.n <= 0) this.slots[i] = null;
    }
    if (took) this.version++;
    return took;
  }

  /** Bestand eines Rohstoffs direkt setzen (Kurzzugriff inv.wood = …). */
  set(id, n) {
    const cur = this.count(id);
    if (n > cur) this.add(id, n - cur);
    else if (n < cur) this.remove(id, cur - n);
  }

  get used() {
    return this.slots.filter(Boolean).length;
  }

  get full() {
    return this.used >= this.size;
  }

  /** Summe aller Rohstoffe (für „trägt etwas zum Abliefern“). */
  get resources() {
    let n = 0;
    for (const s of this.slots) if (s && RES_KEYS.includes(s.id)) n += s.n;
    return n;
  }

  clear() {
    this.slots.fill(null);
    this.version++;
  }

  serialize() {
    return this.slots.map((s) => (s ? [s.id, s.n] : 0));
  }

  restore(data) {
    this.clear();
    if (Array.isArray(data)) {
      data.forEach((s, i) => {
        if (s && i < this.size) this.slots[i] = { id: s[0], n: s[1] };
      });
    } else if (data && typeof data === 'object') {
      // ältere Form { wood: 3, … }
      for (const [k, n] of Object.entries(data)) if (n > 0) this.add(k, n);
    }
    this.version++;
  }
}

// Kurzzugriffe: inv.wood, inv.stone, … lesen und setzen
for (const k of RES_KEYS) {
  Object.defineProperty(Inventory.prototype, k, {
    get() {
      return this.count(k);
    },
    set(v) {
      this.set(k, v);
    },
  });
}
