// world.js – Kachelkarte: Generierung (Seed), Gelände-Rendering, Ressourcenknoten, Kollision.

import { TILE, MAP_W, MAP_H } from './config.js';
import { mulberry32, fbm, hash2, clamp, MinHeap } from './util.js';
import { moveCircle, tilePassable, nodeSolid } from './physics.js';

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
  herb: { res: 'herbs', max: 3, regrow: 45, label: 'Kräuter' },        // wachsen langsam nach
  ashpile: { res: 'coal', max: 6, regrow: 0, label: 'Aschehaufen' },  // verschwindet beim Leeren
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
    this.props = new Uint8Array(n);     // feste Requisiten der Orte (Lagerhütte, Zelte, Wagen …): 1 = blockiert
    this.explored = new Uint8Array(n);  // erkundete Kacheln (Minikarte)
    this.exploredVersion = 0;
    this.cx = this.w >> 1; // Zentrum (Ewige Flamme)
    this.cy = this.h >> 1;
    this.fords = [];
    this.nodesChanged = false; // feste Knoten (Baum/Fels) kamen hinzu oder verschwanden → Flussfeld neu
    this.navDirty = true;      // Navigationsraster der eigenen Leute neu berechnen
    this.nav = null;           // Uint8Array: 1 = begehbar für eigene Leute
    this.region = null;        // Int32Array: Zusammenhangskomponente je Kachel (−1 = blockiert)
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
        else if (t === T.ASH && r < 0.075) this.addNode('ashpile', x, y);
        else if ((t === T.GRASS || t === T.DRY) && r < 0.058) this.addNode('herb', x, y);
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
    this.nodesChanged = this.navDirty = true;
    if (nodeSolid(node)) this.solidAdded = true;
    return node;
  }

  /**
   * Die Ruinen zerfallen weiter: auf zufälligen Pflasterflächen abseits der Flamme entstehen neue
   * Säulentrümmer (verhindert, dass Stein dauerhaft ausgeht). Liefert die Anzahl neuer Knoten.
   */
  crumbleRuins(count, minDist = 9) {
    let made = 0;
    for (let tries = 0; tries < count * 40 && made < count; tries++) {
      const x = 1 + Math.floor(Math.random() * (this.w - 2)), y = 1 + Math.floor(Math.random() * (this.h - 2));
      if (this.tileAt(x, y) !== T.PAVE || x === this.cx || y === this.cy) continue;
      if (Math.hypot(x - this.cx, y - this.cy) < minDist) continue;
      if (this.buildingAt[this.idx(x, y)]) continue;
      const old = this.nodeAtTile(x, y);
      if (old && !old.removed) continue;
      this.addNode('rock', x, y);
      made++;
    }
    return made;
  }

  /** Kacheln im Umkreis r (Kacheln) als erkundet markieren. Liefert true, wenn neu aufgedeckt wurde. */
  reveal(tx, ty, r) {
    let changed = false;
    for (let y = Math.max(0, ty - r); y <= Math.min(this.h - 1, ty + r); y++) {
      for (let x = Math.max(0, tx - r); x <= Math.min(this.w - 1, tx + r); x++) {
        const i = y * this.w + x;
        if (this.explored[i] || (x - tx) ** 2 + (y - ty) ** 2 > r * r) continue;
        this.explored[i] = 1;
        changed = true;
      }
    }
    if (changed) this.exploredVersion++;
    return changed;
  }

  isExplored(tx, ty) {
    return this.inBounds(tx, ty) && this.explored[ty * this.w + tx] === 1;
  }

  /** Neue Aschehaufen (Kohle) auf verbrannter Erde – jeden Morgen ein paar. */
  spawnAshPiles(count) {
    let made = 0;
    for (let tries = 0; tries < count * 60 && made < count; tries++) {
      const x = 1 + Math.floor(Math.random() * (this.w - 2)), y = 1 + Math.floor(Math.random() * (this.h - 2));
      if (this.tileAt(x, y) !== T.ASH || this.buildingAt[this.idx(x, y)] || this.props[this.idx(x, y)]) continue;
      const old = this.nodeAtTile(x, y);
      if (old && !old.removed) continue;
      this.addNode('ashpile', x, y);
      made++;
    }
    return made;
  }

  nodeAtTile(tx, ty) {
    if (!this.inBounds(tx, ty)) return null;
    const id = this.nodeAt[ty * this.w + tx];
    return id >= 0 ? this.nodes[id] : null;
  }

  /** Knoten endgültig entfernen (z. B. leere Trümmer oder wenn gebaut wird). */
  removeNode(node) {
    if (nodeSolid(node)) this.nodesChanged = this.navDirty = true;
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
      if (node.type === 'rock' || node.type === 'ashpile') this.removeNode(node);
      else if (node.type === 'tree') this.nodesChanged = this.navDirty = true; // Stumpf blockiert nicht mehr
    }
    return take;
  }

  /** Nachwachsen von Bäumen (aus Stümpfen) und Früchten. */
  nextToGate(tx, ty) {
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const b = this.inBounds(tx + dx, ty + dy) && this.buildingAt[this.idx(tx + dx, ty + dy)];
      if (b && b.type === 'gate') return true;
    }
    return false;
  }

  updateNodes(dt) {
    for (const n of this.nodes) {
      if (n.removed) continue;
      if (n.shake > 0) n.shake -= dt;
      const def = NODE_DEFS[n.type];
      if (n.type === 'tree' && n.amount <= 0) {
        n.timer += dt;
        // Kein Nachwachsen direkt vor Toren (der Durchgang bliebe sonst zugewachsen)
        if (n.timer >= def.regrow && this.nextToGate(n.tx, n.ty)) n.timer = def.regrow * 0.5;
        else if (n.timer >= def.regrow) {
          n.amount = n.max;
          n.timer = 0;
          this.nodesChanged = this.navDirty = this.solidAdded = true;
        }
      } else if ((n.type === 'bush' || n.type === 'herb') && n.amount < n.max) {
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

  /** Begehbar für eine Maske: Gelände, Gebäude (Tore nur für eigene Leute), Baumstämme und Felsen. */
  passable(tx, ty, mask = 'friendly') {
    return tilePassable(this, tx, ty, mask);
  }

  /**
   * Navigationsraster der eigenen Leute (begehbar ja/nein) und Zusammenhangskomponenten.
   * Wird nur bei Änderungen (Gebäude, Bäume, Felsen) neu aufgebaut; spart aussichtslose A*-Suchen.
   */
  updateNav() {
    const W = this.w, H = this.h, n = W * H;
    if (!this.nav) {
      this.nav = new Uint8Array(n);
      this.region = new Int32Array(n);
    }
    const nav = this.nav, region = this.region;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) nav[y * W + x] = tilePassable(this, x, y, 'friendly') ? 1 : 0;
    region.fill(-1);
    let label = 0;
    const queue = new Int32Array(n);
    for (let i = 0; i < n; i++) {
      if (!nav[i] || region[i] >= 0) continue;
      let head = 0, tail = 0;
      queue[tail++] = i;
      region[i] = label;
      while (head < tail) {
        const cur = queue[head++], cx = cur % W, cy = (cur / W) | 0;
        for (let k = 0; k < 4; k++) {
          const nx = cx + (k === 0 ? 1 : k === 1 ? -1 : 0), ny = cy + (k === 2 ? 1 : k === 3 ? -1 : 0);
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const ni = ny * W + nx;
          if (nav[ni] && region[ni] < 0) {
            region[ni] = label;
            queue[tail++] = ni;
          }
        }
      }
      label++;
    }
    this.navDirty = false;
  }

  /** Komponente einer Kachel; eine blockierte Startkachel übernimmt die einer begehbaren Nachbarkachel. */
  regionNear(tx, ty) {
    if (this.navDirty || !this.nav) this.updateNav();
    if (!this.inBounds(tx, ty)) return -1;
    const r = this.region[ty * this.w + tx];
    if (r >= 0) return r;
    for (const [dx, dy] of [[0, 1], [1, 0], [-1, 0], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]]) {
      const x = tx + dx, y = ty + dy;
      if (this.inBounds(x, y) && this.region[y * this.w + x] >= 0) return this.region[y * this.w + x];
    }
    return -1;
  }

  /**
   * A* auf dem Kachelraster (8 Richtungen, keine Eckabkürzung). Die Startkachel darf belegt sein.
   * Liefert [[tx,ty],…] oder null.
   */
  findPath(sx, sy, gx, gy, maxNodes = 6000, mask = 'friendly') {
    if (!this.inBounds(sx, sy) || !this.inBounds(gx, gy)) return null;
    const W = this.w, start = sy * W + sx, goal = gy * W + gx;
    let ok;
    if (mask === 'friendly') {
      if (this.navDirty || !this.nav) this.updateNav();
      const nav = this.nav;
      if (!nav[goal]) return null;
      // Ziel in einer anderen Zusammenhangskomponente: gar nicht erst suchen
      if (this.region[goal] !== this.regionNear(sx, sy)) return null;
      ok = (x, y) => x >= 0 && y >= 0 && x < W && y < this.h && nav[y * W + x] === 1;
    } else {
      if (!this.passable(gx, gy, mask)) return null;
      ok = (x, y) => this.passable(x, y, mask);
    }
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
          if (!ok(nx, ny)) continue;
          if (dx && dy && (!ok(cx + dx, cy) || !ok(cx, cy + dy))) continue;
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

  /** Nächste begehbare Nachbarkachel eines Knotens (Arbeitsplatz davor), vom Punkt (fx,fy) aus gesehen. */
  accessTile(tx, ty, fx, fy, mask = 'friendly') {
    let best = null, bd = Infinity;
    for (const [dx, dy] of [[0, 1], [1, 0], [-1, 0], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]]) {
      const x = tx + dx, y = ty + dy;
      if (!this.passable(x, y, mask)) continue;
      if (dx && dy && (!this.passable(tx + dx, ty, mask) && !this.passable(tx, ty + dy, mask))) continue;
      const d = Math.hypot((x + 0.5) * TILE - fx, (y + 0.5) * TILE - fy) + (dx && dy ? 6 : 0);
      if (d < bd) {
        bd = d;
        best = [x, y];
      }
    }
    return best;
  }

  /** Breitensuche zur nächsten Stelle, an der man Wasser schöpfen kann. */
  findPathToWater(sx, sy, maxNodes = 5000, mask = 'friendly') {
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
      if (isSource(cx, cy) && this.passable(cx, cy, mask)) return { path: this._reconstruct(cur, start), tx: cx, ty: cy };
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cx + dx, ny = cy + dy;
        if (!this.passable(nx, ny, mask)) continue;
        const ni = ny * W + nx;
        if (this._stamp[ni] === gen) continue;
        this._stamp[ni] = gen;
        this._came[ni] = cur;
        queue.push(ni);
      }
    }
    return null;
  }

  // ---------------------------------------------------------------- Flussfeld (Gegner)
  /**
   * Dijkstra vom Zentrum aus über die ganze Karte. Gebäude sind „teuer", aber passierbar:
   * Gegner laufen um Mauern herum, wenn der Umweg kurz ist, sonst schlagen sie sich durch.
   * Baumstämme und Felsen sind Hindernisse.
   */
  computeFlowField() {
    this.nodesChanged = false;
    const n = this.w * this.h;
    if (!this.flow) {
      this.flow = new Float32Array(n);
      this.flowB = new Float32Array(n);
    }
    // Normale Gegner meiden Mauern (teuer), Brecher gehen mitten hindurch (Mauern/Tore fast so billig wie Boden)
    this.dijkstra(this.flow, (b) => (b.type === 'wall' ? 14 : b.type === 'gate' ? 12 : 8));
    this.dijkstra(this.flowB, (b) => (b.type === 'wall' || b.type === 'gate' ? 1.5 : 6));
  }

  /** Dijkstra vom Zentrum über die ganze Karte; buildingCost(b) = Zusatzkosten einer Gebäudekachel. */
  dijkstra(flow, buildingCost) {
    const W = this.w, H = this.h, n = W * H;
    const ba = this.buildingAt, tiles = this.tiles;
    flow.fill(Infinity);
    const closed = new Uint8Array(n);
    const heap = new MinHeap();
    for (let i = 0; i < n; i++) {
      if (ba[i] && ba[i].type === 'center') {
        flow[i] = 0;
        heap.push(i, 0);
      }
    }
    const nodeAt = this.nodeAt, nodes = this.nodes;
    const solidNode = (i) => nodeAt[i] >= 0 && !!nodeSolid(nodes[nodeAt[i]]);
    const isB = (i) => ba[i] && ba[i].type !== 'trap';
    const free = (x, y) => this.walkable(x, y) && !isB(y * W + x) && !solidNode(y * W + x) && !this.props[y * W + x];
    while (heap.size) {
      const cur = heap.pop();
      if (closed[cur]) continue;
      closed[cur] = 1;
      const cx = cur % W, cy = (cur / W) | 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = cx + dx, ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const ni = ny * W + nx;
          if (closed[ni] || tiles[ni] === T.WATER || solidNode(ni) || this.props[ni]) continue;
          if (dx && dy && (!free(cx + dx, cy) || !free(cx, cy + dy))) continue;
          let c = tiles[ni] === T.SHALLOW ? 1.8 : 1;
          const b = ba[ni];
          if (b && b.type !== 'center' && b.type !== 'trap') c += buildingCost(b);
          const nd = flow[cur] + c * (dx && dy ? 1.414 : 1);
          if (nd < flow[ni]) {
            flow[ni] = nd;
            heap.push(ni, nd);
          }
        }
      }
    }
  }

  flowAt(tx, ty, breaker = false) {
    const f = breaker ? this.flowB : this.flow;
    return this.inBounds(tx, ty) && f ? f[ty * this.w + tx] : Infinity;
  }

  // ---------------------------------------------------------------- Kollision
  /**
   * Bewegt eine Entität (Kreis mit Radius r) mit Gleiten an Hindernissen; mask = 'friendly' | 'enemy' | 'animal'.
   * Gibt true zurück, wenn etwas im Weg war.
   */
  moveEntity(e, dx, dy, r, mask) {
    return moveCircle(this, e, dx, dy, mask, r);
  }

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
        // Boden zurücknehmen (entsättigt, dunkler), damit Figuren, Gebäude und Interactables herausstechen
        const wet = t === T.WATER || t === T.SHALLOW;
        const sat = wet ? 0.95 : 0.75, dim = wet ? 0.96 : 0.88;
        const l = (c[0] + c[1] + c[2]) / 3;
        const o = (py * W + px) * 4;
        d[o] = clamp((l + (c[0] - l) * sat) * k * dim, 0, 255);
        d[o + 1] = clamp((l + (c[1] - l) * sat) * k * dim, 0, 255);
        d[o + 2] = clamp((l + (c[2] - l) * sat) * k * dim, 0, 255);
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
