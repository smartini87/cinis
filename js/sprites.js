// sprites.js – sämtliche Grafik per Code: Pixel-Sprites werden einmalig in Offscreen-Canvases
// gezeichnet (Bäume, Steine, Gebäude, Icons); Figuren werden pro Frame aus Rechtecken gebaut.

import { TILE } from './config.js';
import { hash2 } from './util.js';

export const Sprites = {};

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  return [c, g];
}

/** Gefülltes Rechteck in Pixeln. */
function px(g, x, y, w, h, color) {
  g.fillStyle = color;
  g.fillRect(x, y, w, h);
}

/** Gefüllte Ellipse aus Pixelzeilen (bleibt scharf). */
function blob(g, cx, cy, rx, ry, color, seed = 0, rough = 0) {
  g.fillStyle = color;
  for (let y = -ry; y <= ry; y++) {
    const k = 1 - (y * y) / (ry * ry);
    if (k < 0) continue;
    let w = Math.round(rx * Math.sqrt(k));
    if (rough) w += Math.round((hash2(y, seed, 31) - 0.5) * rough);
    if (w > 0) g.fillRect(cx - w, cy + y, w * 2, 1);
  }
}

// ------------------------------------------------------------------ Lesbarkeit: Konturen, Farbe, Silhouetten
/**
 * Macht ein Sprite kräftiger (Sättigung/Kontrast) und dunkelt die äußersten Pixel ab (1-px-Innenkontur),
 * damit Gebäude und Interactables sich vom entsättigten Boden abheben.
 */
function inkSprite(c, { sat = 1.18, con = 1.06, edge = 0.55 } = {}) {
  const g = c.getContext('2d');
  const img = g.getImageData(0, 0, c.width, c.height), d = img.data, W = c.width, H = c.height;
  const alpha = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? 0 : d[(y * W + x) * 4 + 3]);
  const edgeMask = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (alpha(x, y) < 200) continue;
      if (alpha(x - 1, y) < 100 || alpha(x + 1, y) < 100 || alpha(x, y - 1) < 100 || alpha(x, y + 1) < 100) edgeMask[y * W + x] = 1;
    }
  }
  for (let i = 0; i < W * H; i++) {
    const o = i * 4;
    if (d[o + 3] === 0) continue;
    let r = d[o], gg = d[o + 1], b = d[o + 2];
    const l = (r + gg + b) / 3;
    r = l + (r - l) * sat;
    gg = l + (gg - l) * sat;
    b = l + (b - l) * sat;
    r = 128 + (r - 128) * con;
    gg = 128 + (gg - 128) * con;
    b = 128 + (b - 128) * con;
    if (edgeMask[i]) {
      r *= 1 - edge;
      gg *= 1 - edge;
      b *= 1 - edge * 0.85;
    }
    d[o] = Math.max(0, Math.min(255, r));
    d[o + 1] = Math.max(0, Math.min(255, gg));
    d[o + 2] = Math.max(0, Math.min(255, b));
  }
  g.putImageData(img, 0, 0);
  return c;
}

const tintCache = new Map();
/** Einfarbige Silhouette eines Sprites (zwischengespeichert). */
export function tinted(img, color) {
  let m = tintCache.get(img);
  if (!m) tintCache.set(img, (m = new Map()));
  let t = m.get(color);
  if (!t) {
    const [c, g] = canvas(img.width, img.height);
    g.drawImage(img, 0, 0);
    g.globalCompositeOperation = 'source-in';
    g.fillStyle = color;
    g.fillRect(0, 0, img.width, img.height);
    m.set(color, (t = c));
  }
  return t;
}

/** Sprite mit 1-px-Außenkontur (z. B. Glow des aktuellen Interactables) zeichnen. */
export function drawOutlinedImage(ctx, img, x, y, color, alpha = 1) {
  const t = tinted(img, color);
  const a = ctx.globalAlpha;
  ctx.globalAlpha = a * alpha;
  ctx.drawImage(t, x - 1, y);
  ctx.drawImage(t, x + 1, y);
  ctx.drawImage(t, x, y - 1);
  ctx.drawImage(t, x, y + 1);
  ctx.globalAlpha = a;
  ctx.drawImage(img, x, y);
}

/** Weicher Bodenschatten (Ellipse aus Pixelzeilen) unter einer Figur. */
export function drawShadow(ctx, x, y, rx, alpha = 0.32) {
  x = Math.round(x);
  y = Math.round(y);
  ctx.fillStyle = `rgba(0,0,0,${alpha})`;
  const ry = Math.max(1, Math.round(rx * 0.35));
  for (let i = -ry; i <= ry; i++) {
    const w = Math.round(rx * Math.sqrt(1 - (i * i) / ((ry + 0.5) * (ry + 0.5))));
    ctx.fillRect(x - w, y + i, w * 2, 1);
  }
}

// ------------------------------------------------------------------ Bäume, Steine, Büsche
function makePine(v) {
  // Römische Schirmpinie: dünner Stamm, flache breite Krone
  const [c, g] = canvas(24, 30);
  const trunk = ['#5b3f2a', '#4e3523', '#654631'][v];
  px(g, 11, 12, 2, 16, trunk);
  px(g, 10, 26, 4, 2, trunk);
  px(g, 9, 16, 2, 1, trunk);
  px(g, 13, 14, 3, 1, trunk);
  const greens = [['#2f5a2a', '#3d6e33', '#244820'], ['#35602c', '#467a38', '#29501f'], ['#2c5530', '#3b6a3b', '#203f24']][v];
  blob(g, 12, 9, 11, 5, greens[2], v, 2);
  blob(g, 12, 8, 10, 4, greens[0], v + 3, 2);
  blob(g, 10, 6, 6, 2, greens[1], v + 5, 1);
  for (let i = 0; i < 10; i++) px(g, 3 + Math.floor(hash2(i, v, 4) * 18), 5 + Math.floor(hash2(v, i, 9) * 7), 1, 1, greens[1]);
  return c;
}

function makeCypress() {
  const [c, g] = canvas(12, 30);
  px(g, 5, 25, 2, 4, '#4e3523');
  for (let y = 2; y < 27; y++) {
    const w = Math.round(Math.sin(((y - 1) / 26) * Math.PI) * 4.5);
    px(g, 6 - w, y, w * 2, 1, '#22452a');
    if (w > 1) px(g, 6 - w + 1, y, 1, 1, '#2f5a36');
  }
  return c;
}

function makeStump() {
  const [c, g] = canvas(16, 10);
  px(g, 5, 3, 6, 5, '#5b3f2a');
  px(g, 5, 3, 6, 1, '#a07c52');
  px(g, 6, 4, 4, 1, '#8a6a46');
  px(g, 3, 7, 3, 1, '#4e3523');
  px(g, 10, 7, 3, 1, '#4e3523');
  return c;
}

function makeRock(v) {
  // Zerbrochene Marmorsäule bzw. Mauerbrocken
  const [c, g] = canvas(18, 16);
  if (v === 0) {
    // liegende Säulentrommel
    px(g, 2, 7, 13, 6, '#b9b4a8');
    px(g, 2, 7, 13, 1, '#d8d4ca');
    for (let x = 4; x < 15; x += 3) px(g, x, 8, 1, 5, '#9a958a');
    px(g, 14, 7, 2, 6, '#e6e2d8');
    px(g, 2, 13, 14, 1, '#6f6b63');
  } else if (v === 1) {
    // stehender Säulenstumpf
    px(g, 5, 2, 8, 12, '#c3beb2');
    px(g, 5, 2, 8, 1, '#e6e2d8');
    px(g, 7, 3, 1, 11, '#a19c90');
    px(g, 10, 3, 1, 11, '#a19c90');
    px(g, 4, 13, 10, 2, '#8e8a80');
    px(g, 6, 1, 3, 1, '#c3beb2');
  } else {
    // grauer Tuffsteinbrocken
    blob(g, 9, 10, 7, 4, '#6f6b63', 3, 1);
    blob(g, 8, 9, 6, 3, '#8e8a80', 4, 1);
    px(g, 5, 7, 4, 1, '#a8a498');
    px(g, 12, 10, 2, 2, '#5a5650');
  }
  return c;
}

function makeBush(withFruit) {
  const [c, g] = canvas(16, 14);
  blob(g, 8, 8, 7, 5, '#2f5a2a', 7, 1);
  blob(g, 7, 7, 5, 3, '#3f7234', 8, 1);
  if (withFruit) {
    const pts = [[4, 7], [9, 5], [11, 9], [6, 10], [12, 6]];
    for (const [x, y] of pts) {
      px(g, x, y, 2, 2, '#6b2a5a');
      px(g, x, y, 1, 1, '#9a4a85');
    }
  }
  px(g, 3, 12, 10, 1, 'rgba(0,0,0,0.25)');
  return c;
}

// ------------------------------------------------------------------ Icons (HUD)
function makeIcon(kind) {
  const [c, g] = canvas(12, 12);
  if (kind === 'wood') {
    px(g, 1, 6, 10, 3, '#7a5233');
    px(g, 2, 3, 10, 3, '#8d6240');
    px(g, 10, 3, 2, 3, '#c49a6a');
    px(g, 0, 6, 2, 3, '#c49a6a');
  } else if (kind === 'stone') {
    blob(g, 6, 7, 5, 4, '#8e8a80');
    px(g, 3, 4, 5, 2, '#c3beb2');
  } else if (kind === 'food') {
    blob(g, 6, 7, 4, 4, '#7a3266');
    px(g, 4, 5, 2, 2, '#a8579a');
    px(g, 6, 1, 1, 3, '#3f7234');
    px(g, 7, 2, 3, 1, '#4f8a3f');
  } else if (kind === 'water') {
    for (let y = 1; y < 11; y++) {
      const w = y < 5 ? Math.floor(y / 2) + 1 : Math.round(Math.sqrt(Math.max(0, 16 - (y - 7) ** 2)));
      px(g, 6 - w, y, w * 2, 1, '#3f86c0');
    }
    px(g, 4, 6, 1, 2, '#9fd0f0');
  } else if (kind === 'people') {
    px(g, 2, 2, 3, 3, '#c99a6e');
    px(g, 1, 5, 5, 6, '#b8a074');
    px(g, 7, 3, 3, 3, '#c99a6e');
    px(g, 6, 6, 5, 5, '#8a6a4a');
  } else if (kind === 'heart') {
    px(g, 2, 3, 3, 3, '#c0392b');
    px(g, 7, 3, 3, 3, '#c0392b');
    px(g, 1, 4, 10, 3, '#c0392b');
    px(g, 2, 7, 8, 1, '#c0392b');
    px(g, 3, 8, 6, 1, '#c0392b');
    px(g, 5, 9, 2, 1, '#c0392b');
    px(g, 3, 4, 1, 1, '#f08a7a');
  } else if (kind === 'flame') {
    px(g, 4, 3, 4, 7, '#e8742a');
    px(g, 3, 6, 6, 4, '#e8742a');
    px(g, 5, 1, 2, 3, '#f0a53a');
    px(g, 5, 6, 2, 4, '#ffd36a');
  }
  return c;
}

// ------------------------------------------------------------------ Gebäude
function makeCenter() {
  // Ruine eines Rundtempels (Tholos) mit großer Bronzeschale – die Ewige Flamme
  const [c, g] = canvas(52, 60);
  // Stufen
  px(g, 2, 50, 48, 8, '#8e8a80');
  px(g, 4, 48, 44, 3, '#b9b4a8');
  px(g, 2, 50, 48, 1, '#d8d4ca');
  px(g, 2, 54, 48, 1, '#6f6b63');
  px(g, 2, 57, 48, 1, '#5a5650');
  // Innenraum (Schatten)
  px(g, 6, 22, 40, 26, '#3b3634');
  px(g, 6, 44, 40, 4, '#2c2826');
  // Säulen (einige abgebrochen)
  const heights = [26, 26, 18, 26, 26, 12, 26];
  for (let i = 0; i < 7; i++) {
    const x = 5 + i * 7, h = heights[i];
    px(g, x, 48 - h, 4, h, '#d8d4ca');
    px(g, x + 3, 48 - h, 1, h, '#a8a498');
    px(g, x + 1, 48 - h, 1, h, '#ece8de');
    px(g, x - 1, 47, 6, 2, '#b9b4a8');
    if (h === 26) px(g, x - 1, 21, 6, 2, '#c3beb2');
  }
  // Gebälk (teilweise eingestürzt)
  px(g, 3, 16, 14, 5, '#c3beb2');
  px(g, 24, 16, 26, 5, '#c3beb2');
  px(g, 3, 16, 14, 1, '#ece8de');
  px(g, 24, 16, 26, 1, '#ece8de');
  for (let x = 4; x < 50; x += 4) if (x < 17 || x > 24) px(g, x, 18, 2, 1, '#8e8a80');
  // Bronzeschale auf Sockel
  px(g, 22, 34, 8, 14, '#8e8a80');
  px(g, 23, 34, 2, 14, '#b9b4a8');
  px(g, 16, 28, 20, 6, '#8a5a2a');
  px(g, 17, 33, 18, 2, '#6a4420');
  px(g, 16, 28, 20, 1, '#c08a4a');
  // Trümmer davor
  px(g, 40, 52, 7, 3, '#c3beb2');
  px(g, 6, 53, 5, 2, '#b9b4a8');
  return c;
}

function makeHut() {
  // Kleines Steinhaus mit Terrakotta-Ziegeldach (32 x 40)
  const [c, g] = canvas(32, 40);
  px(g, 3, 20, 26, 18, '#b9a98a');
  for (let y = 22; y < 38; y += 4) for (let x = 3 + ((y / 4) % 2) * 3; x < 29; x += 6) px(g, x, y, 1, 3, '#9a8a6c');
  for (let y = 21; y < 38; y += 4) px(g, 3, y, 26, 1, '#a39375');
  px(g, 3, 37, 26, 1, '#6f6450');
  // Tür + Fenster
  px(g, 13, 27, 7, 11, '#3d2a1c');
  px(g, 14, 28, 5, 10, '#5b3f2a');
  px(g, 16, 32, 1, 1, '#c9a24a');
  px(g, 6, 25, 4, 4, '#2a2420');
  px(g, 23, 25, 4, 4, '#ffd27a');
  // Dach
  for (let y = 0; y < 14; y++) {
    const w = 6 + y * 1.3;
    px(g, Math.round(16 - w), 7 + y, Math.round(w * 2), 1, y % 3 === 0 ? '#8a3a20' : '#b5532c');
  }
  px(g, 14, 5, 4, 3, '#8a3a20');
  for (let x = 0; x < 32; x += 3) px(g, x, 20, 1, 1, '#6a2a14');
  px(g, 0, 20, 32, 1, '#7a3018');
  return c;
}

function makeWell() {
  const [c, g] = canvas(16, 24);
  // Holzgestell
  px(g, 2, 3, 2, 14, '#6b4a2a');
  px(g, 12, 3, 2, 14, '#6b4a2a');
  px(g, 1, 2, 14, 2, '#8d6240');
  px(g, 7, 4, 1, 6, '#c9b07a');
  px(g, 6, 9, 3, 3, '#7a5233');
  // Steinring
  px(g, 1, 13, 14, 9, '#8e8a80');
  px(g, 1, 13, 14, 1, '#c3beb2');
  px(g, 3, 14, 10, 3, '#2c5f86');
  px(g, 4, 15, 3, 1, '#6aa6bb');
  for (let x = 1; x < 15; x += 4) px(g, x, 18, 1, 4, '#6f6b63');
  px(g, 1, 21, 14, 1, '#5a5650');
  return c;
}

function makeWall() {
  const [c, g] = canvas(16, 22);
  px(g, 0, 6, 16, 16, '#9a958a');
  px(g, 0, 6, 16, 2, '#c3beb2');
  for (let y = 10; y < 22; y += 4) {
    px(g, 0, y, 16, 1, '#7a766d');
    const off = (y / 4) % 2 ? 0 : 5;
    for (let x = off; x < 16; x += 8) px(g, x, y + 1, 1, 3, '#7a766d');
  }
  // Zinnen
  px(g, 1, 2, 4, 4, '#a8a498');
  px(g, 11, 2, 4, 4, '#a8a498');
  px(g, 1, 2, 4, 1, '#d0ccc0');
  px(g, 11, 2, 4, 1, '#d0ccc0');
  px(g, 0, 21, 16, 1, '#5a5650');
  return c;
}

function makeTower() {
  const [c, g] = canvas(20, 40);
  px(g, 3, 14, 14, 26, '#9a958a');
  for (let y = 16; y < 40; y += 4) px(g, 3, y, 14, 1, '#7a766d');
  px(g, 3, 14, 2, 26, '#b9b4a8');
  px(g, 15, 14, 2, 26, '#7a766d');
  px(g, 8, 24, 4, 6, '#2a2420');
  // Holzplattform
  px(g, 1, 10, 18, 4, '#7a5233');
  px(g, 1, 10, 18, 1, '#a07c52');
  for (let x = 2; x < 19; x += 4) px(g, x, 13, 2, 2, '#5b3f2a');
  return c;
}

function makeFarm() {
  const [c, g] = canvas(32, 32);
  px(g, 0, 0, 32, 32, '#5e4630');
  for (let y = 3; y < 32; y += 5) {
    px(g, 1, y, 30, 2, '#4a3624');
    px(g, 1, y + 2, 30, 1, '#6f553c');
  }
  // Zaun
  px(g, 0, 0, 32, 1, '#8d6240');
  px(g, 0, 31, 32, 1, '#8d6240');
  px(g, 0, 0, 1, 32, '#8d6240');
  px(g, 31, 0, 1, 32, '#8d6240');
  for (let i = 0; i < 32; i += 8) {
    px(g, i, 0, 2, 2, '#6b4a2a');
    px(g, i, 30, 2, 2, '#6b4a2a');
  }
  return c;
}

/** Alle statischen Sprites erzeugen (einmalig beim Start). */
export function buildSprites() {
  Sprites.pine = [0, 1, 2].map((v) => inkSprite(makePine(v)));
  Sprites.cypress = inkSprite(makeCypress());
  Sprites.stump = inkSprite(makeStump(), { edge: 0.35 });
  Sprites.rock = [0, 1, 2].map((v) => inkSprite(makeRock(v)));
  Sprites.bush = inkSprite(makeBush(true), { sat: 1.3 });
  Sprites.bushEmpty = inkSprite(makeBush(false), { sat: 1.1 });
  Sprites.center = inkSprite(makeCenter());
  Sprites.hut = inkSprite(makeHut());
  Sprites.well = inkSprite(makeWell());
  Sprites.wall = inkSprite(makeWall());
  Sprites.tower = inkSprite(makeTower());
  Sprites.farm = inkSprite(makeFarm(), { edge: 0.3 });
  Sprites.icons = {};
  for (const k of ['wood', 'stone', 'food', 'water', 'people', 'heart', 'flame']) Sprites.icons[k] = makeIcon(k);
}

/** Data-URL eines Icons für das DOM-HUD. */
export function iconURL(kind) {
  return Sprites.icons[kind].toDataURL();
}

// ------------------------------------------------------------------ Ressourcenknoten
/** Sprite und Position eines Knotens (für Zeichnen und Glow). */
export function nodeSprite(node) {
  const x = node.tx * TILE, y = node.ty * TILE;
  const sh = node.shake > 0 ? Math.round(Math.sin(node.shake * 60) * 1) : 0;
  if (node.type === 'tree') {
    if (node.amount <= 0) return [Sprites.stump, x, y + 6];
    if (node.variant === 2) return [Sprites.cypress, x + 2 + sh, y - 14];
    return [Sprites.pine[node.variant], x - 4 + sh, y - 14];
  }
  if (node.type === 'rock') return [Sprites.rock[node.variant], x - 1 + sh, y];
  if (node.type === 'bush') return [node.amount > 0 ? Sprites.bush : Sprites.bushEmpty, x + sh, y + 2];
  return null;
}

/** Knoten zeichnen; glow > 0 = pulsierende goldene Kontur (Interactable in Reichweite). */
export function drawNode(ctx, node, glow = 0) {
  const s = nodeSprite(node);
  if (!s) return;
  if (glow > 0) drawOutlinedImage(ctx, s[0], s[1], s[2], '#ffd36a', glow);
  else ctx.drawImage(s[0], s[1], s[2]);
}

// ------------------------------------------------------------------ Figuren
const OUTLINE_OFFSETS = [[-1, 0], [1, 0], [0, -1], [0, 1]];
/** Umrissfarben: Spieler hell, Siedler dunkel, Gegner dunkelrot */
export const OUTLINE = { player: '#fff3c4', settler: '#20160f', enemy: '#2a0805' };
/**
 * Zeichnet eine menschliche Figur mit Füßen bei (x,y).
 * o: { flip, walk (Animationsphase), tunic, skin, hair, helmet, plume, hurt, carry }
 */
export function drawHumanoid(ctx, x, y, o) {
  x = Math.round(x);
  y = Math.round(y);
  if (o.outline && !o.silhouette) {
    // Schatten, dann 1-px-Umriss (Silhouette 4× versetzt), dann die Figur
    drawShadow(ctx, x, y, 5);
    for (const [dx, dy] of OUTLINE_OFFSETS) drawHumanoid(ctx, x + dx, y + dy, { ...o, silhouette: o.outline, outline: null, noShadow: true });
    drawHumanoid(ctx, x, y, { ...o, outline: null, noShadow: true });
    return;
  }
  const f = o.flip ? -1 : 1;
  // Rechteck relativ zur Figur, horizontal gespiegelt bei Blick nach links
  const sil = o.silhouette;
  const R = (rx, ry, w, h, c) => {
    ctx.fillStyle = sil || c;
    ctx.fillRect(f === 1 ? x + rx : x - rx - w, y + ry, w, h);
  };
  const step = o.walk ? Math.round(Math.sin(o.walk) * 1.5) : 0;
  const bob = o.walk ? Math.abs(Math.round(Math.sin(o.walk))) : 0;
  const skin = o.hurt ? '#ffffff' : o.skin;
  const tunic = o.hurt ? '#ffffff' : o.tunic;
  if (!sil && !o.noShadow) R(-4, -1, 8, 2, 'rgba(0,0,0,0.28)');
  // Beine
  R(-3, -5, 2, 4 + Math.max(0, step), skin);
  R(1, -5, 2, 4 + Math.max(0, -step), skin);
  R(-3, -1 + Math.max(0, step), 2, 1, '#4a3020');
  R(1, -1 + Math.max(0, -step), 2, 1, '#4a3020');
  // Körper
  R(-4, -11 - bob, 8, 7, tunic);
  R(-4, -6 - bob, 8, 1, o.belt || '#5a3d24');
  // Arme
  R(-5, -10 - bob, 1, 5, skin);
  R(4, -10 - bob, 1, 5, skin);
  // Kopf
  R(-3, -16 - bob, 6, 5, skin);
  R(1, -14 - bob, 1, 1, '#1d1712');
  if (o.helmet) {
    R(-3, -17 - bob, 6, 3, o.helmet);
    R(-4, -15 - bob, 1, 3, o.helmet);
    if (o.plume) R(-2, -19 - bob, 5, 2, o.plume);
  } else if (o.hair) {
    R(-3, -17 - bob, 6, 2, o.hair);
    R(-3, -15 - bob, 1, 2, o.hair);
  }
  if (o.carry) {
    // getragene Ressource über dem Kopf
    const col = { wood: '#8d6240', stone: '#b9b4a8', food: '#7a3266', water: '#3f86c0' }[o.carry];
    R(-3, -22 - bob, 6, 4, col);
    R(-3, -22 - bob, 6, 1, 'rgba(255,255,255,0.35)');
  }
}

/** Animierte Flamme (Spitze bei x,y-Basis); size skaliert, t = Zeit. */
export function drawFlame(ctx, x, y, size, t) {
  x = Math.round(x);
  y = Math.round(y);
  const layers = [
    ['#b8401c', 1.0],
    ['#e8742a', 0.75],
    ['#f0a53a', 0.5],
    ['#ffe08a', 0.28],
  ];
  for (const [col, k] of layers) {
    ctx.fillStyle = col;
    const h = Math.round(size * 2.2 * k);
    for (let i = 0; i < h; i++) {
      const prog = i / h;
      const w = Math.max(1, Math.round(size * k * (1 - prog) * (0.85 + 0.15 * Math.sin(t * 9 + i))));
      const sway = Math.round(Math.sin(t * 6 + i * 0.5) * prog * 2);
      ctx.fillRect(x - w + sway, y - i, w * 2, 1);
    }
  }
}

/** Feldfrüchte auf einer Farm (Wachstum 0..1). */
export function drawCrops(ctx, x, y, growth) {
  const stage = Math.min(3, Math.floor(growth * 4));
  for (let row = 0; row < 6; row++) {
    for (let col = 0; col < 6; col++) {
      const cx = x + 3 + col * 5, cy = y + 3 + row * 5;
      if (stage === 0) {
        ctx.fillStyle = '#4f8a3f';
        ctx.fillRect(cx + 1, cy, 1, 1);
      } else if (stage === 1) {
        ctx.fillStyle = '#4f8a3f';
        ctx.fillRect(cx, cy - 1, 1, 2);
        ctx.fillRect(cx + 2, cy - 1, 1, 2);
      } else {
        ctx.fillStyle = '#3f7234';
        ctx.fillRect(cx, cy - 3, 3, 4);
        if (stage === 3) {
          ctx.fillStyle = '#d9b25a';
          ctx.fillRect(cx, cy - 4, 3, 2);
        }
      }
    }
  }
}

/** Ballista oben auf dem Turm, zeigt in Richtung angle. */
export function drawBallista(ctx, x, y, angle, recoil) {
  ctx.save();
  ctx.translate(Math.round(x), Math.round(y));
  ctx.rotate(angle);
  ctx.fillStyle = '#5b3f2a';
  ctx.fillRect(-4 - recoil, -1, 10, 3);
  ctx.fillStyle = '#8d6240';
  ctx.fillRect(2 - recoil, -5, 2, 11);
  ctx.fillStyle = '#d8d4ca';
  ctx.fillRect(4 - recoil, 0, 4, 1);
  ctx.restore();
}

/** Kleines Vorschaubild eines Gebäudes für die Bauleiste. */
export function buildingPreviewURL(type) {
  let spr = { hut: Sprites.hut, farm: Sprites.farm, well: Sprites.well, wall: Sprites.wall, tower: Sprites.tower }[type];
  if (type === 'gate') {
    const [gc, gg] = canvas(16, 24);
    drawGate(gg, 0, 24, 0, 0);
    spr = gc;
  }
  if (type === 'farm') {
    const [fc, fg] = canvas(32, 32);
    fg.drawImage(Sprites.farm, 0, 0);
    drawCrops(fg, 0, 0, 0.8);
    spr = fc;
  }
  const [c, g] = canvas(40, 40);
  g.imageSmoothingEnabled = false;
  const k = Math.min(36 / spr.width, 36 / spr.height);
  const w = spr.width * k, h = spr.height * k;
  g.drawImage(spr, Math.round(20 - w / 2), Math.round(38 - h), Math.round(w), Math.round(h));
  return c.toDataURL();
}

// ------------------------------------------------------------------ Gegner
/**
 * Zeichnet einen Gegner mit Füßen bei (e.x, e.y).
 * e: { type, flip, walk, hurt, attack (0..1 Ausholbewegung), burn }
 */
export function drawEnemy(ctx, e, time, sil = null, outline = null) {
  if (outline && !sil) {
    const big = e.type === 'brute' || e.type === 'boss';
    drawShadow(ctx, e.x, e.y, e.type === 'boss' ? 9 : big ? 7 : e.type === 'dog' ? 6 : 5, 0.36);
    for (const [dx, dy] of OUTLINE_OFFSETS) drawEnemy(ctx, { ...e, x: e.x + dx, y: e.y + dy }, time, outline);
    drawEnemy(ctx, e, time, '');
    return;
  }
  const x = Math.round(e.x), y = Math.round(e.y);
  const f = e.flip ? -1 : 1;
  const white = e.hurt > 0;
  const R = (rx, ry, w, h, c) => {
    if (sil !== null && c.startsWith('rgba(0,0,0')) return; // Schatten nicht in Silhouette/Umriss-Durchgang
    ctx.fillStyle = sil || (white ? '#ffffff' : c);
    ctx.fillRect(f === 1 ? x + rx : x - rx - w, y + ry, w, h);
  };
  const step = Math.round(Math.sin(e.walk) * 1.5);
  const lunge = e.attack > 0 ? Math.round(Math.sin(e.attack * Math.PI) * 3) : 0;
  const eye = e.burn ? '#ffe08a' : '#ff7a2a';
  switch (e.type) {
    case 'walker': {
      // Aschgänger: gebückte, aschgraue Gestalt mit glühenden Augen
      R(-4, -1, 8, 2, 'rgba(0,0,0,0.3)');
      R(-3, -5, 2, 5 + Math.max(0, step), '#4a4542');
      R(1, -5, 2, 5 + Math.max(0, -step), '#4a4542');
      R(-4 + lunge, -12, 8, 8, '#3b3634');
      R(-4 + lunge, -12, 8, 1, '#5a5450');
      R(2 + lunge, -10, 4 + lunge, 2, '#8a8580');
      R(-5 + lunge, -9, 2, 4, '#8a8580');
      R(-2 + lunge * 1.3, -16, 6, 5, '#8a8580');
      R(1 + lunge * 1.3, -15, 1, 1, eye);
      R(3 + lunge * 1.3, -15, 1, 1, eye);
      R(-2 + lunge, -7, 1, 2, '#b8401c');
      break;
    }
    case 'dog': {
      // Ruinenhund: niedrig, dunkel, schnell
      R(-5, -1, 11, 2, 'rgba(0,0,0,0.3)');
      R(-5, -4, 2, 3 + Math.max(0, step), '#2c2622');
      R(-2, -4, 2, 3 + Math.max(0, -step), '#2c2622');
      R(2, -4, 2, 3 + Math.max(0, step), '#2c2622');
      R(4, -4, 2, 3 + Math.max(0, -step), '#2c2622');
      R(-6, -8, 12, 5, '#4a3a30');
      R(-6, -8, 12, 1, '#5e4a3c');
      R(-8, -9, 3, 2, '#4a3a30');
      R(4 + lunge, -11, 5, 5, '#4a3a30');
      R(5 + lunge, -13, 2, 2, '#3b2e26');
      R(7 + lunge, -10, 1, 1, eye);
      R(8 + lunge, -8, 2, 1, '#e8e2d4');
      break;
    }
    case 'brute': {
      // Aschkoloss: massig, mit glühenden Rissen
      R(-7, -1, 14, 3, 'rgba(0,0,0,0.35)');
      R(-5, -6, 4, 6 + Math.max(0, step), '#3b3634');
      R(1, -6, 4, 6 + Math.max(0, -step), '#3b3634');
      R(-7 + lunge, -18, 14, 13, '#4a4542');
      R(-7 + lunge, -18, 14, 2, '#6a6460');
      R(-3 + lunge, -14, 1, 6, '#e8742a');
      R(2 + lunge, -15, 1, 4, '#e8742a');
      R(-1 + lunge, -10, 4, 1, '#e8742a');
      R(-10 + lunge, -16, 3, 9, '#5a5450');
      R(7 + lunge * 2, -16, 4, 9, '#5a5450');
      R(7 + lunge * 2, -8, 5, 4, '#6a6460');
      R(-3 + lunge, -23, 7, 6, '#5a5450');
      R(1 + lunge, -21, 2, 1, eye);
      break;
    }
    case 'boss': {
      // Prätor der Asche: gerüstet, roter Umhang, Lorbeerkranz aus Glut
      R(-9, -1, 18, 3, 'rgba(0,0,0,0.4)');
      R(-8, -22, 4, 20, '#7a1c18');
      R(-6, -7, 4, 7 + Math.max(0, step), '#2c2622');
      R(2, -7, 4, 7 + Math.max(0, -step), '#2c2622');
      R(-6 + lunge, -22, 12, 15, '#3b3634');
      R(-6 + lunge, -22, 12, 3, '#8a7a4a');
      R(-6 + lunge, -12, 12, 2, '#8a7a4a');
      R(-2 + lunge, -19, 4, 6, '#b8401c');
      R(6 + lunge * 2, -21, 3, 10, '#4a4542');
      // Schwert
      R(8 + lunge * 2, -30 + lunge, 2, 18, '#9aa0a6');
      R(6 + lunge * 2, -13 + lunge, 6, 2, '#8a7a4a');
      R(-4 + lunge, -29, 9, 7, '#6a6460');
      R(-5 + lunge, -31, 11, 2, (time * 4) % 2 < 1 ? '#f0a53a' : '#e8742a');
      R(1 + lunge, -27, 1, 1, '#ffe08a');
      R(3 + lunge, -27, 1, 1, '#ffe08a');
      break;
    }
  }
}

/**
 * Tor mit Unterkante bei bottom. rot 0: Mauer läuft waagerecht (Durchgang nord–süd),
 * rot 1: Mauer läuft senkrecht (Durchgang west–ost). open 0..1 animiert die Flügel.
 */
export function drawGate(ctx, x, bottom, rot, open) {
  x = Math.round(x);
  const P = (rx, ry, w, h, c) => {
    ctx.fillStyle = c;
    ctx.fillRect(x + rx, bottom + ry, w, h);
  };
  if (rot === 0) {
    P(3, -18, 10, 18, '#2a2420'); // Durchgang (dunkel)
    // Pfosten + Sturz
    P(0, -22, 3, 22, '#9a958a');
    P(13, -22, 3, 22, '#9a958a');
    P(0, -22, 16, 4, '#a8a498');
    P(0, -22, 16, 1, '#d0ccc0');
    P(0, -1, 16, 1, '#5a5650');
    // Torflügel (Holz, Eisenbeschlag)
    const w = Math.max(0, Math.round(5 * (1 - open)));
    if (w > 0) {
      P(3, -18, w, 17, '#7a5233');
      P(13 - w, -18, w, 17, '#7a5233');
      P(3, -13, w, 1, '#3b3634');
      P(13 - w, -13, w, 1, '#3b3634');
      P(3, -6, w, 1, '#3b3634');
      P(13 - w, -6, w, 1, '#3b3634');
      if (w >= 4) {
        P(7, -18, 1, 17, '#5b3f2a');
        P(8, -18, 1, 17, '#5b3f2a');
      }
    }
  } else {
    // Mauer von der Seite: schmal; Pfosten an Nord- und Südende, Flügel dazwischen
    P(5, -24, 6, 8, '#9a958a');
    P(5, -24, 6, 1, '#d0ccc0');
    P(5, -7, 6, 7, '#9a958a');
    P(5, -7, 6, 1, '#c3beb2');
    P(5, -1, 6, 1, '#5a5650');
    const h = Math.max(0, Math.round(9 * (1 - open)));
    if (h > 0) {
      P(6, -16, 4, h, '#7a5233');
      P(6, -16, 4, 1, '#a07c52');
    }
  }
}

/** Ballista-Bolzen */
export function drawBolt(ctx, x, y, angle) {
  ctx.save();
  ctx.translate(Math.round(x), Math.round(y));
  ctx.rotate(angle);
  ctx.fillStyle = '#8d6240';
  ctx.fillRect(-5, 0, 7, 1);
  ctx.fillStyle = '#d8d4ca';
  ctx.fillRect(2, -1, 2, 3);
  ctx.restore();
}
