// physics.js – Kollision für alle Einheiten: Kreis-Hitboxen gegen Rechtecke (Wasser, Gebäude) und Kreise
// (Baumstämme, Felsen). Auflösung per Herausschieben entlang der Normalen ergibt Gleiten an Wänden;
// Bewegung in Substeps verhindert Durchrutschen bei hohem Tempo bzw. Dash. Dazu die Trennung von Einheiten.
//
// Masken: 'friendly' (Spieler, Siedler – laufen durch Tore), 'enemy', 'animal' (Tore sind für sie zu).

import { TILE } from './config.js';

/** Tiefes Wasser (muss zu T.WATER in world.js passen; hier dupliziert, um Zirkelimporte zu vermeiden). */
const WATER = 6;

/** Feste Kreise der Ressourcenknoten: Radius und Versatz des Mittelpunkts nach unten. */
export const NODE_SOLID = { tree: { r: 4, oy: 3 }, rock: { r: 6, oy: 2 } };

/** Blockiert dieser Knoten gerade (Stümpfe und Sträucher nicht)? */
export function nodeSolid(n) {
  if (!n || n.removed) return null;
  const s = NODE_SOLID[n.type];
  if (!s) return null;
  if (n.type === 'tree' && n.amount <= 0) return null;
  return s;
}

/** Ist das Gebäude für diese Maske passierbar? (Tore nur für eigene Leute) */
export function buildingPassable(b, mask) {
  return b.type === 'gate' && mask === 'friendly' && !b.site;
}

/**
 * Rechteck eines Gebäudes innerhalb einer belegten Kachel (Weltkoordinaten).
 * Mauern/Tore können später schmaler sein (Rotation); Standard ist die volle Kachel.
 */
export function buildingTileRect(b, tx, ty) {
  const x = tx * TILE, y = ty * TILE;
  if (b.thin === 'h') return [x, y + 4, TILE, 8];
  if (b.thin === 'v') return [x + 4, y, 8, TILE];
  return [x, y, TILE, TILE];
}

/**
 * Löst Überlappungen eines Kreises (e.x, e.y, Radius r) mit allen festen Formen in der Nähe auf.
 * Liefert true, wenn eine Kollision stattfand.
 */
export function resolve(world, e, r, mask) {
  let hit = false;
  for (let iter = 0; iter < 4; iter++) {
    let moved = false;
    const x0 = Math.floor((e.x - r) / TILE), x1 = Math.floor((e.x + r) / TILE);
    const y0 = Math.floor((e.y - r) / TILE), y1 = Math.floor((e.y + r) / TILE);
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        if (!world.inBounds(tx, ty) || world.tiles[ty * world.w + tx] === WATER) {
          moved = pushRect(e, r, tx * TILE, ty * TILE, TILE, TILE) || moved;
          continue;
        }
        const b = world.buildingAt[ty * world.w + tx];
        if (b && !b.dead && !buildingPassable(b, mask)) {
          const [rx, ry, rw, rh] = buildingTileRect(b, tx, ty);
          moved = pushRect(e, r, rx, ry, rw, rh) || moved;
        }
        const id = world.nodeAt[ty * world.w + tx];
        if (id >= 0) {
          const n = world.nodes[id], s = nodeSolid(n);
          if (s) moved = pushCircle(e, r, n.x, n.y + s.oy, s.r) || moved;
        }
      }
    }
    if (!moved) break;
    hit = true;
  }
  return hit;
}

/** Kreis aus einem Rechteck schieben. */
function pushRect(e, r, rx, ry, rw, rh) {
  const cx = Math.max(rx, Math.min(e.x, rx + rw)), cy = Math.max(ry, Math.min(e.y, ry + rh));
  const dx = e.x - cx, dy = e.y - cy, d2 = dx * dx + dy * dy;
  if (d2 >= r * r - 1e-6) return false;
  if (d2 > 1e-8) {
    const d = Math.sqrt(d2), k = (r - d) / d;
    e.x += dx * k;
    e.y += dy * k;
    return true;
  }
  // Mittelpunkt im Rechteck: entlang der kleinsten Eindringtiefe hinaus
  const l = e.x - rx, rt = rx + rw - e.x, t = e.y - ry, b = ry + rh - e.y;
  const m = Math.min(l, rt, t, b);
  if (m === l) e.x = rx - r;
  else if (m === rt) e.x = rx + rw + r;
  else if (m === t) e.y = ry - r;
  else e.y = ry + rh + r;
  return true;
}

/** Kreis aus einem festen Kreis schieben. */
function pushCircle(e, r, cx, cy, cr) {
  const dx = e.x - cx, dy = e.y - cy, min = r + cr, d2 = dx * dx + dy * dy;
  if (d2 >= min * min - 1e-6) return false;
  const d = Math.sqrt(d2) || 0.01;
  const nx = d2 > 1e-8 ? dx / d : 0, ny = d2 > 1e-8 ? dy / d : 1;
  e.x = cx + nx * min;
  e.y = cy + ny * min;
  return true;
}

/**
 * Bewegt einen Kreis um (dx,dy) in Substeps (Schritt ≤ r/2) und gleitet an Hindernissen entlang.
 * Liefert true, wenn unterwegs etwas im Weg war.
 */
export function moveCircle(world, e, dx, dy, mask, r = e.r) {
  const len = Math.max(Math.abs(dx), Math.abs(dy));
  const n = Math.max(1, Math.ceil(len / Math.max(1, r * 0.5)));
  const sx = dx / n, sy = dy / n;
  let hit = false;
  for (let i = 0; i < n; i++) {
    e.x += sx;
    e.y += sy;
    if (resolve(world, e, r, mask)) hit = true;
  }
  return hit;
}

/** Überlappt ein Kreis feste Formen um mehr als tol Welteinheiten? (Tests/Debug) */
export function overlaps(world, x, y, r, mask, tol = 0.5) {
  const probe = { x, y };
  resolve(world, probe, r, mask);
  return Math.hypot(probe.x - x, probe.y - y) > tol;
}

/** Ist eine Kachel für diese Maske begehbar (Wegfindung)? */
export function tilePassable(world, tx, ty, mask) {
  if (!world.inBounds(tx, ty)) return false;
  const i = ty * world.w + tx;
  if (world.tiles[i] === WATER) return false;
  const b = world.buildingAt[i];
  if (b && !b.dead && !buildingPassable(b, mask)) return false;
  const id = world.nodeAt[i];
  if (id >= 0 && nodeSolid(world.nodes[id])) return false;
  return true;
}

// ------------------------------------------------------------------ Trennung von Einheiten
/** Räumliches Raster für Nachbarschaftsabfragen (Zellen à 32 Welteinheiten). */
export class SpatialHash {
  constructor(cell = 32) {
    this.cell = cell;
    this.map = new Map();
    this.used = [];   // belegte Zellen seit dem letzten clear (Arrays werden wiederverwendet)
  }
  clear() {
    for (const a of this.used) a.length = 0;
    this.used.length = 0;
  }
  key(cx, cy) {
    return (cx + 1024) * 4096 + (cy + 1024);
  }
  insert(o) {
    const k = this.key(Math.floor(o.x / this.cell), Math.floor(o.y / this.cell));
    let a = this.map.get(k);
    if (!a) this.map.set(k, (a = []));
    if (!a.length) this.used.push(a);
    a.push(o);
  }
  /** Alle Objekte in Zellen, die den Kreis (x,y,r) berühren, an fn übergeben. */
  query(x, y, r, fn) {
    const c = this.cell;
    const x0 = Math.floor((x - r) / c), x1 = Math.floor((x + r) / c);
    const y0 = Math.floor((y - r) / c), y1 = Math.floor((y + r) / c);
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const a = this.map.get(this.key(cx, cy));
        if (a) for (const o of a) fn(o);
      }
    }
  }
}

/**
 * Einheiten auseinanderschieben (kein Übereinanderlaufen). units: [{ e, mask, mass }].
 * Die Verschiebung läuft über moveCircle, damit niemand in eine Wand gedrückt wird.
 */
export function separateUnits(world, units, hash) {
  hash.clear();
  for (let i = 0; i < units.length; i++) {
    const u = units[i];
    u.i = i;
    u.px = 0;
    u.py = 0;
    u.x = u.e.x;
    u.y = u.e.y;
    hash.insert(u);
  }
  for (const a of units) {
    hash.query(a.x, a.y, a.e.r + 12, (b) => {
      if (b.i <= a.i) return;
      const dx = b.x - a.x, dy = b.y - a.y, min = a.e.r + b.e.r;
      if (Math.abs(dx) >= min || Math.abs(dy) >= min) return;
      const d2 = dx * dx + dy * dy;
      if (d2 >= min * min) return;
      let d = Math.sqrt(d2), nx, ny;
      if (d < 0.01) {
        // exakt übereinander: deterministisch nach Index auseinander
        const ang = (a.i * 2.399) % (Math.PI * 2);
        nx = Math.cos(ang);
        ny = Math.sin(ang);
        d = 0;
      } else {
        nx = dx / d;
        ny = dy / d;
      }
      const over = (min - d) * 0.5;
      const wa = b.mass / (a.mass + b.mass), wb = 1 - wa;
      a.px -= nx * over * wa;
      a.py -= ny * over * wa;
      b.px += nx * over * wb;
      b.py += ny * over * wb;
    });
  }
  for (const u of units) {
    if (u.px === 0 && u.py === 0) continue;
    // Begrenzen, damit große Stapel sich über mehrere Schritte sanft lösen
    const l = Math.hypot(u.px, u.py), k = l > 2 ? 2 / l : 1;
    moveCircle(world, u.e, u.px * k, u.py * k, u.mask);
  }
}
