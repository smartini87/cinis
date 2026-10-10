// world.js – Kachelkarte: Generierung (Seed), Gelände-Rendering, Ressourcenknoten, Kollision.

import { TILE, MAP_W, MAP_H } from './config.js';
import { mulberry32, fbm, hash2, clamp, MinHeap } from './util.js';

/** Kacheltypen */
export const T = { GRASS: 0, DRY: 1, DIRT: 2, SAND: 3, PAVE: 4, SHALLOW: 5, WATER: 6, ASH: 7 };

/** Farben pro Kacheltyp: [Basis, hell, dunkel] als RGB */
const TILE_COLORS = [
  [[79, 122, 58], [93, 138, 68], [67, 105, 47]],     // GRASS
  [[125, 123, 69], [141, 138, 82], [108, 106, 58]],  // DRY (verdorrtes Gras)
  [[122, 92, 62], [134, 104, 74], [106, 79, 53]],    // DIRT
  [[201, 176, 122], [214, 191, 140], [184, 159, 107]], // SAND
  [[142, 138, 128], [160, 156, 146], [111, 107, 99]],  // PAVE (antikes Pflaster)
  [[79, 143, 168], [106, 166, 187], [66, 124, 150]],   // SHALLOW (Furt)
  [[44, 95, 134], [58, 114, 155], [36, 80, 115]],      // WATER
  [[74, 69, 66], [90, 84, 80], [59, 54, 52]],          // ASH (verbrannte Erde)
];

/** Ressourcenknoten: welche Ressource, Maximalmenge, Nachwachsen */
export const NODE_DEFS = {
  tree: { res: 'wood', max: 12, regrow: 420, label: 'Pinie' },     // Stumpf wächst nach regrow s nach
  rock: { res: 'stone', max: 16, regrow: 0, label: 'Säulentrümmer' }, // verschwindet beim Leeren
  bush: { res: 'food', max: 5, regrow: 16, label: 'Feigenstrauch' },  // 1 Frucht pro regrow s
};

export class World {
  constructor(seed) {
    this.seed = seed >>> 0;
    this.w = MAP_W;
    this.h = MAP_H;
    const n = this.w * this.h;
    this.tiles = new Uint8Array(n);
    this.nodes = [];
    this.nodeAt = new Int32Array(n).fill(-1);
    this.buildingAt = new Array(n).fill(null);
    this.cx = this.w >> 1; // Zentrum (Ewige Flamme)
    this.cy = this.h >> 1;
    this.fords = [];
    this.terrain = null;   // vorgerendertes Gelände (Canvas)
    this.generate();
  }

  idx(x, y) {
    return y * this.w + x;
  }
  inBounds(x, y) {
    return x >= 0 && y >= 0 && x < this.w && y < this.h;
  }
  /** Außerhalb der Karte zählt als tiefes Wasser (unpassierbar). */
  tileAt(x, y) {
    return this.inBounds(x, y) ? this.tiles[y * this.w + x] : T.WATER;
  }
  walkable(tx, ty) {
    return this.tileAt(tx, ty) !== T.WATER;
  }
  isWaterTile(tx, ty) {
    const t = this.tileAt(tx, ty);
    return t === T.WATER || t === T.SHALLOW;
  }

  // ---------------------------------------------------------------- Generierung
  generate() {
    const rng = mulberry32(this.seed);
    const s = this.seed % 100000;
    const W = this.w, H = this.h, cx = this.cx, cy = this.cy;
    const set = (x, y, t) => {
      if (this.inBounds(x, y)) this.tiles[y * W + x] = t;
    };

    // 1) Grundgelände aus Feuchtigkeit + Ascherauschen
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const m = fbm(x * 0.06, y * 0.06, s + 11);
        const a = fbm(x * 0.09, y * 0.09, s + 77);
        let t = m > 0.52 ? T.GRASS : m > 0.42 ? T.DRY : T.DIRT;
        if (a > 0.69) t = T.ASH;
        this.tiles[y * W + x] = t;
      }
    }

    // 2) Fluss („Tiberis") von Nord nach Süd westlich des Zentrums
    const riverBase = Math.floor(W * 0.27);
    const riverX = new Float32Array(H);
    for (let y = 0; y < H; y++) {
      const rx = riverBase + Math.sin(y * 0.075 + (s % 7)) * 5 + (fbm(y * 0.05, 0.5, s + 5) - 0.5) * 12;
      const hw = 1.6 + fbm(y * 0.1, 9.5, s + 9) * 1.6;
      riverX[y] = rx;
      for (let x = Math.max(0, Math.floor(rx - 6)); x < Math.min(W, Math.ceil(rx + 6)); x++) {
        const d = Math.abs(x + 0.5 - rx);
        if (d < hw) set(x, y, T.WATER);
        else if (d < hw + 1.3) set(x, y, T.SAND);
      }
    }
    // Furten: seichte Stellen, an denen man den Fluss überqueren kann
    const fordYs = [8 + Math.floor(rng() * 14), H - 10 - Math.floor(rng() * 14)];
    for (const fy of fordYs) {
      this.fords.push(fy);
      for (let y = fy - 1; y <= fy + 1; y++) {
        for (let x = 0; x < W; x++) {
          if (this.tileAt(x, y) === T.WATER && Math.abs(x - riverX[y]) < 6) set(x, y, T.SHALLOW);
        }
      }
    }

    // 3) Teich östlich des Flusses in Reichweite des Zentrums
    const ang = (rng() - 0.5) * Math.PI * 1.6;
    const pd = 11 + rng() * 3;
    const px = cx + Math.cos(ang) * pd, py = cy + Math.sin(ang) * pd;
    const pr = 2.6 + rng();
    for (let y = Math.floor(py - 6); y <= py + 6; y++) {
      for (let x = Math.floor(px - 6); x <= px + 6; x++) {
        const d = Math.hypot(x + 0.5 - px, (y + 0.5 - py) * 1.25) + (fbm(x * 0.4, y * 0.4, s + 3) - 0.5) * 1.5;
        if (d < pr) set(x, y, T.WATER);
        else if (d < pr + 1.2 && this.tileAt(x, y) !== T.WATER) set(x, y, T.SAND);
      }
    }
    this.pond = { x: px, y: py };

    // 4) Alte Römerstraßen durch das Zentrum (am Fluss: eingestürzte Brücke = Furt)
    for (let i = 0; i < W; i++) {
      for (const [x, y] of [[i, cy], [cx, i]]) {
        const t = this.tileAt(x, y);
        if (t === T.WATER) set(x, y, T.SHALLOW);
        else if (t !== T.SHALLOW && rng() < 0.85) set(x, y, T.PAVE);
      }
    }
    this.fords.push(cy);

    // 5) Ruinenfelder (Pflaster + Säulentrümmer)
    const ruins = [];
    for (let i = 0; i < 18; i++) {
      const rw = 4 + Math.floor(rng() * 5), rh = 4 + Math.floor(rng() * 4);
      const rx = 2 + Math.floor(rng() * (W - rw - 4)), ry = 2 + Math.floor(rng() * (H - rh - 4));
      if (Math.hypot(rx + rw / 2 - cx, ry + rh / 2 - cy) < 11) continue;
      ruins.push({ rx, ry, rw, rh });
      for (let y = ry; y < ry + rh; y++) {
        for (let x = rx; x < rx + rw; x++) {
          const t = this.tileAt(x, y);
          if (t === T.WATER || t === T.SHALLOW || t === T.SAND) continue;
          if (rng() < 0.8) set(x, y, T.PAVE);
        }
      }
    }

    // 6) Platz um das Zentrum pflastern
    for (let y = cy - 3; y <= cy + 3; y++) {
      for (let x = cx - 3; x <= cx + 3; x++) {
        if (Math.hypot(x - cx, y - cy) < 3.4) set(x, y, T.PAVE);
      }
    }

    // 7) Ressourcenknoten verteilen
    const free = (x, y) => this.inBounds(x, y) && this.nodeAt[y * W + x] < 0 && !this.isWaterTile(x, y) && this.tileAt(x, y) !== T.SAND;
    for (const r of ruins) {
      for (let y = r.ry; y < r.ry + r.rh; y++) {
        for (let x = r.rx; x < r.rx + r.rw; x++) {
          const edge = x === r.rx || y === r.ry || x === r.rx + r.rw - 1 || y === r.ry + r.rh - 1;
          if (edge && rng() < 0.4 && free(x, y) && x !== cx && y !== cy) this.addNode('rock', x, y);
        }
      }
    }
    for (let y = 1; y < H - 1; y++) {
      for (let x = 1; x < W - 1; x++) {
        if (!free(x, y) || x === cx || y === cy) continue;
        if (Math.hypot(x - cx, y - cy) < 5.5) continue;
        const t = this.tileAt(x, y);
        const forest = fbm(x * 0.07, y * 0.07, s + 200);
        const r = rng();
        if ((t === T.GRASS || t === T.DRY) && forest > 0.56 && r < 0.5) this.addNode('tree', x, y);
        else if (t !== T.PAVE && r < 0.012) this.addNode('tree', x, y);
        else if ((t === T.DIRT || t === T.DRY || t === T.ASH) && r < 0.024) this.addNode('rock', x, y);
        else if (t === T.GRASS && r < 0.045) this.addNode('bush', x, y);
      }
    }

    // 8) Startgarantie: in der Nähe des Zentrums gibt es von allem etwas
    const want = { tree: 7, rock: 5, bush: 4 };
    for (const type of Object.keys(want)) {
      let placed = 0, tries = 0;
      while (placed < want[type] && tries++ < 400) {
        const a = rng() * Math.PI * 2, d = 6 + rng() * 5;
        const x = Math.round(cx + Math.cos(a) * d), y = Math.round(cy + Math.sin(a) * d);
        if (free(x, y) && x !== cx && y !== cy) {
          this.addNode(type, x, y);
          placed++;
        }
      }
    }
  }

  addNode(type, x, y) {
    const def = NODE_DEFS[type];
    const node = {
      id: this.nodes.length, type, tx: x, ty: y,
      x: (x + 0.5) * TILE, y: (y + 0.5) * TILE,
      amount: def.max, max: def.max, timer: 0, removed: false,
      variant: Math.floor(hash2(x, y, this.seed) * 3), shake: 0,
    };
    this.nodes.push(node);
    this.nodeAt[y * this.w + x] = node.id;
    return node;
  }

  nodeAtTile(tx, ty) {
    if (!this.inBounds(tx, ty)) return null;
    const id = this.nodeAt[ty * this.w + tx];
    return id >= 0 ? this.nodes[id] : null;
  }

  /** Knoten endgültig entfernen (z. B. leere Trümmer oder wenn gebaut wird). */
  removeNode(node) {
    node.removed = true;
    node.amount = 0;
    if (this.nodeAt[node.ty * this.w + node.tx] === node.id) this.nodeAt[node.ty * this.w + node.tx] = -1;
  }

  /** Ressource abbauen; liefert die tatsächlich entnommene Menge. */
  harvest(node, amount) {
    const take = Math.min(amount, node.amount);
    node.amount -= take;
    node.shake = 0.2;
    if (node.amount <= 0) {
      node.timer = 0;
      if (node.type === 'rock') this.removeNode(node);
    }
    return take;
  }

  /** Nachwachsen von Bäumen (aus Stümpfen) und Früchten. */
  updateNodes(dt) {
    for (const n of this.nodes) {
      if (n.removed) continue;
      if (n.shake > 0) n.shake -= dt;
      const def = NODE_DEFS[n.type];
      if (n.type === 'tree' && n.amount <= 0) {
        n.timer += dt;
        if (n.timer >= def.regrow) {
          n.amount = n.max;
          n.timer = 0;
        }
      } else if (n.type === 'bush' && n.amount < n.max) {
        n.timer += dt;
        if (n.timer >= def.regrow) {
          n.amount++;
          n.timer = 0;
        }
      }
    }
  }

  // ---------------------------------------------------------------- Wegfindung (freundliche Einheiten)
  _searchBuffers() {
    if (!this._g) {
      const n = this.w * this.h;
      this._g = new Float32Array(n);
      this._came = new Int32Array(n);
      this._stamp = new Uint32Array(n);   // Generationsmarke statt Array-Reset
      this._closed = new Uint32Array(n);
      this._gen = 0;
    }
    this._gen++;
    return this._gen;
  }

  _reconstruct(goal, start) {
    const path = [];
    for (let c = goal; c !== start; c = this._came[c]) path.push([c % this.w, (c / this.w) | 0]);
    return path.reverse();
  }

  /** A* auf dem Geländeraster (8 Richtungen, keine Eckabkürzung). Liefert [[tx,ty],…] oder null. */
  findPath(sx, sy, gx, gy, maxNodes = 6000) {
    if (!this.walkable(gx, gy) || !this.inBounds(sx, sy)) return null;
    const W = this.w, start = sy * W + sx, goal = gy * W + gx;
    if (start === goal) return [];
    const gen = this._searchBuffers();
    const heap = new MinHeap();
    const h = (i) => {
      const dx = Math.abs((i % W) - gx), dy = Math.abs(((i / W) | 0) - gy);
      return Math.max(dx, dy) + 0.414 * Math.min(dx, dy);
    };
    this._g[start] = 0;
    this._stamp[start] = gen;
    heap.push(start, h(start));
    let expanded = 0;
    while (heap.size) {
      const cur = heap.pop();
      if (cur === goal) return this._reconstruct(goal, start);
      if (this._closed[cur] === gen) continue;
      this._closed[cur] = gen;
      if (++expanded > maxNodes) return null;
      const cx = cur % W, cy = (cur / W) | 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = cx + dx, ny = cy + dy;
          if (!this.walkable(nx, ny)) continue;
          if (dx && dy && (!this.walkable(cx + dx, cy) || !this.walkable(cx, cy + dy))) continue;
          const ni = ny * W + nx;
          if (this._closed[ni] === gen) continue;
          const cost = this._g[cur] + (dx && dy ? 1.414 : 1) + (this.tiles[ni] === T.SHALLOW ? 0.6 : 0);
          if (this._stamp[ni] !== gen || cost < this._g[ni]) {
            this._stamp[ni] = gen;
            this._g[ni] = cost;
            this._came[ni] = cur;
            heap.push(ni, cost + h(ni));
          }
        }
      }
    }
    return null;
  }

  /** Breitensuche zur nächsten Stelle, an der man Wasser schöpfen kann. */
  findPathToWater(sx, sy, maxNodes = 5000) {
    if (!this.inBounds(sx, sy)) return null;
    const W = this.w, start = sy * W + sx;
    const gen = this._searchBuffers();
    const queue = [start];
    this._stamp[start] = gen;
    const isSource = (x, y) => {
      if (this.tileAt(x, y) === T.SHALLOW) return true;
      return this.tileAt(x + 1, y) === T.WATER || this.tileAt(x - 1, y) === T.WATER || this.tileAt(x, y + 1) === T.WATER || this.tileAt(x, y - 1) === T.WATER;
    };
    for (let qi = 0; qi < queue.length && qi < maxNodes; qi++) {
      const cur = queue[qi], cx = cur % W, cy = (cur / W) | 0;
      if (isSource(cx, cy) && this.inBounds(cx, cy)) return { path: this._reconstruct(cur, start), tx: cx, ty: cy };
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cx + dx, ny = cy + dy;
        if (!this.inBounds(nx, ny) || !this.walkable(nx, ny)) continue;
        const ni = ny * W + nx;
        if (this._stamp[ni] === gen) continue;
        this._stamp[ni] = gen;
        this._came[ni] = cur;
        queue.push(ni);
      }
    }
    return null;
  }

  // ---------------------------------------------------------------- Kollision
  /** Prüft, ob ein Kreis (als Box angenähert) an (x,y) mit Radius r feste Kacheln berührt. */
  blocked(x, y, r, solid) {
    const x0 = Math.floor((x - r) / TILE), x1 = Math.floor((x + r) / TILE);
    const y0 = Math.floor((y - r) / TILE), y1 = Math.floor((y + r) / TILE);
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        if (solid(tx, ty)) return true;
      }
    }
    return false;
  }

  /** Bewegt eine Entität achsweise, gleitet an Hindernissen entlang. Gibt true zurück, wenn blockiert. */
  moveEntity(e, dx, dy, r, solid) {
    let hit = false;
    if (dx !== 0) {
      if (!this.blocked(e.x + dx, e.y, r, solid)) e.x += dx;
      else hit = true;
    }
    if (dy !== 0) {
      if (!this.blocked(e.x, e.y + dy, r, solid)) e.y += dy;
      else hit = true;
    }
    return hit;
  }

  /** Standard-Solidität für freundliche Einheiten: nur tiefes Wasser blockiert. */
  solidFriendly = (tx, ty) => !this.walkable(tx, ty);

  // ---------------------------------------------------------------- Rendering
  /** Gelände einmalig pixelgenau in ein Offscreen-Canvas rendern. */
  renderTerrain() {
    const W = this.w * TILE, H = this.h * TILE;
    const cnv = document.createElement('canvas');
    cnv.width = W;
    cnv.height = H;
    const g = cnv.getContext('2d');
    const img = g.createImageData(W, H);
    const d = img.data;
    const s = this.seed % 100000;
    // Großflächige Helligkeitsvariation pro Kachel
    const shade = new Float32Array(this.w * this.h);
    for (let ty = 0; ty < this.h; ty++) {
      for (let tx = 0; tx < this.w; tx++) shade[ty * this.w + tx] = 0.9 + fbm(tx * 0.15, ty * 0.15, s + 999, 3) * 0.2;
    }
    for (let py = 0; py < H; py++) {
      const ty = (py / TILE) | 0, ly = py % TILE;
      for (let px = 0; px < W; px++) {
        const tx = (px / TILE) | 0, lx = px % TILE;
        let t = this.tiles[ty * this.w + tx];
        const h = hash2(px, py, s);
        // Weiche, unregelmäßige Kachelkanten: Randpixel übernehmen manchmal die Nachbarkachel
        if (lx < 2 || lx > TILE - 3 || ly < 2 || ly > TILE - 3) {
          const nx = lx < 2 ? tx - 1 : lx > TILE - 3 ? tx + 1 : tx;
          const ny = ly < 2 ? ty - 1 : ly > TILE - 3 ? ty + 1 : ty;
          if (this.inBounds(nx, ny) && h < 0.35) {
            const nt = this.tiles[ny * this.w + nx];
            // Wasser franst nicht ins Land aus (klare Uferlinie)
            if (nt !== T.WATER && t !== T.WATER) t = nt;
          }
        }
        const pal = TILE_COLORS[t];
        let c = pal[0];
        if (h > 0.86) c = pal[1];
        else if (h < 0.14) c = pal[2];
        let k = shade[ty * this.w + tx];
        if (t === T.PAVE) {
          // Steinplatten mit versetzten Fugen und Rissen
          const row = (py / 8) | 0;
          const off = row % 2 ? 4 : 0;
          if (py % 8 === 0 || (px + off) % 8 === 0) c = pal[2];
          if (hash2((px + off) >> 3, row, s + 5) < 0.05) c = TILE_COLORS[T.GRASS][2]; // Gras in den Fugen
        } else if (t === T.WATER || t === T.SHALLOW) {
          if (hash2(px >> 2, py, s + 8) > 0.93) c = pal[1]; // Wellenlinien
        } else if (t === T.GRASS && h > 0.975) {
          c = [150, 140, 70]; // vereinzelte Halme
        }
        const o = (py * W + px) * 4;
        d[o] = clamp(c[0] * k, 0, 255);
        d[o + 1] = clamp(c[1] * k, 0, 255);
        d[o + 2] = clamp(c[2] * k, 0, 255);
        d[o + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    this.terrain = cnv;
    return cnv;
  }

  /** Sichtbaren Geländeausschnitt zeichnen (+ animierte Wasserglanzlichter). */
  drawTerrain(ctx, cam, time) {
    if (!this.terrain) this.renderTerrain();
    const l = Math.max(0, Math.floor(cam.left)), t = Math.max(0, Math.floor(cam.top));
    const w = Math.min(this.terrain.width - l, Math.ceil(cam.viewW) + 2);
    const h = Math.min(this.terrain.height - t, Math.ceil(cam.viewH) + 2);
    if (w > 0 && h > 0) ctx.drawImage(this.terrain, l, t, w, h, l, t, w, h);
    // Wasserglitzern
    const tx0 = Math.floor(cam.left / TILE), ty0 = Math.floor(cam.top / TILE);
    const tx1 = tx0 + Math.ceil(cam.viewW / TILE) + 1, ty1 = ty0 + Math.ceil(cam.viewH / TILE) + 1;
    ctx.fillStyle = 'rgba(190,225,240,0.55)';
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        if (this.tileAt(tx, ty) !== T.WATER || !this.inBounds(tx, ty)) continue;
        const h = hash2(tx, ty, 7);
        const ph = (time * 0.6 + h * 10) % 4;
        if (ph < 1.6) {
          const ox = Math.floor(h * 10) + Math.floor(ph * 2);
          const oy = Math.floor(hash2(ty, tx, 3) * 12) + 2;
          ctx.fillRect(tx * TILE + ox, ty * TILE + oy, 3, 1);
        }
      }
    }
  }
}
