// util.js – kleine Helfer: Mathematik, deterministischer Zufall, Rauschen, Prioritätswarteschlange.

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
export const dist2 = (ax, ay, bx, by) => {
  const dx = ax - bx, dy = ay - by;
  return dx * dx + dy * dy;
};

/** Deterministischer Zufallsgenerator (mulberry32). Liefert eine Funktion -> [0,1). */
export function mulberry32(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Ganzzahl-Hash zweier Koordinaten -> [0,1). Für reproduzierbare Pixelvariationen. */
export function hash2(x, y, seed = 0) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed | 0, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Wertrauschen mit weicher Interpolation. */
export function valueNoise(x, y, seed) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi, seed), b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed), d = hash2(xi + 1, yi + 1, seed);
  return lerp(lerp(a, b, u), lerp(c, d, u), v);
}

/** Fraktales Rauschen (mehrere Oktaven Wertrauschen), Ergebnis ca. [0,1]. */
export function fbm(x, y, seed, octaves = 4) {
  let v = 0, amp = 0.5, f = 1, norm = 0;
  for (let i = 0; i < octaves; i++) {
    v += valueNoise(x * f, y * f, seed + i * 101) * amp;
    norm += amp;
    amp *= 0.5;
    f *= 2;
  }
  return v / norm;
}

/** Binärer Min-Heap für Dijkstra/A*. */
export class MinHeap {
  constructor() {
    this.items = [];
    this.prio = [];
  }
  get size() {
    return this.items.length;
  }
  push(item, p) {
    const it = this.items, pr = this.prio;
    it.push(item);
    pr.push(p);
    let i = it.length - 1;
    while (i > 0) {
      const par = (i - 1) >> 1;
      if (pr[par] <= pr[i]) break;
      [it[i], it[par]] = [it[par], it[i]];
      [pr[i], pr[par]] = [pr[par], pr[i]];
      i = par;
    }
  }
  pop() {
    const it = this.items, pr = this.prio;
    const top = it[0];
    const li = it.pop(), lp = pr.pop();
    if (it.length > 0) {
      it[0] = li;
      pr[0] = lp;
      const n = it.length;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < n && pr[l] < pr[m]) m = l;
        if (r < n && pr[r] < pr[m]) m = r;
        if (m === i) break;
        [it[i], it[m]] = [it[m], it[i]];
        [pr[i], pr[m]] = [pr[m], pr[i]];
        i = m;
      }
    }
    return top;
  }
}

/** Formatiert Sekunden als m:ss. */
export function fmtTime(sec) {
  const s = Math.max(0, Math.ceil(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
