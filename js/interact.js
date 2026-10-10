// interact.js – Interaktionsziele in Reichweite des Spielers: Ressourcenknoten, Wasser und alles, was
// spätere Systeme als Provider anmelden (Siedler, Kisten, Baustellen, Beute …). Liefert das beste Ziel,
// zeichnet den pulsierenden Glow (über die Zeichner der Objekte) und das „E“-Prompt über dem Ziel.

import { TILE, PLAYER_REACH } from './config.js';
import { dist } from './util.js';

export class Interact {
  constructor() {
    this.providers = [];   // fn(game, out) → schiebt Kandidaten { kind, x, y, act?, label, … } in out
    this.target = null;
    this.addProvider(nodeProvider);
    this.addProvider(waterProvider);
  }

  addProvider(fn) {
    this.providers.push(fn);
  }

  /** Bestes Ziel bestimmen: Mauszeiger auf einem Kandidaten > Blickrichtung/Nähe. */
  update(game) {
    const p = game.player;
    if (p.dead) {
      this.target = null;
      return null;
    }
    const cands = this._cands || (this._cands = []);
    cands.length = 0;
    for (const fn of this.providers) fn(game, cands);
    let best = null, bestScore = Infinity;
    const { input, camera } = game;
    let mx = null, my = null;
    if (input.mouse.inside && !game.buildings.selected) {
      const w = camera.screenToWorld(input.mouse.x, input.mouse.y);
      mx = w.x;
      my = w.y;
    }
    for (const c of cands) {
      const d = dist(p.x, p.y, c.x, c.y);
      if (d > (c.reach ?? PLAYER_REACH)) continue;
      const dot = ((c.x - p.x) * p.aimX + (c.y - p.y) * p.aimY) / Math.max(d, 1);
      let score = d - dot * 10 + (c.prio || 0);
      // Zeigt die Maus auf den Kandidaten, gewinnt er
      if (mx !== null && c.hit && c.hit(mx, my)) score -= 1000;
      if (score < bestScore) {
        bestScore = score;
        best = c;
      }
    }
    this.target = best;
    return best;
  }

  /** „E“-Prompt (Tastenkappe) über dem Ziel, in Bildschirmkoordinaten (scharf bei jedem Zoom). */
  drawPrompt(ctx, game) {
    const t = this.target;
    if (!t || game.player.dead || game.buildings.selected) return;
    if (game.enemies.list.some((e) => !e.dead && Math.abs(e.x - game.player.x) < 40 && Math.abs(e.y - game.player.y) < 40)) return;
    const cam = game.camera;
    const s = cam.worldToScreen(t.x, t.y - (t.promptH ?? 18));
    const dpr = window.devicePixelRatio || 1;
    const bob = Math.round(Math.sin(game.time * 4) * 2 * dpr);
    const sz = Math.round(15 * dpr), x = Math.round(s.x - sz / 2), y = Math.round(s.y - sz + bob);
    ctx.save();
    ctx.fillStyle = 'rgba(20,14,10,0.85)';
    ctx.fillRect(x, y, sz, sz);
    ctx.strokeStyle = '#ffd36a';
    ctx.lineWidth = Math.max(1, Math.round(1.5 * dpr));
    ctx.strokeRect(x + 0.5, y + 0.5, sz - 1, sz - 1);
    ctx.fillStyle = '#fff3c4';
    ctx.font = `bold ${Math.round(10 * dpr)}px Georgia, serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(game.input.usingTouch ? '●' : 'E', x + sz / 2, y + sz / 2 + dpr);
    if (t.label) {
      ctx.font = `${Math.round(9 * dpr)}px Georgia, serif`;
      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      ctx.fillText(t.label, x + sz / 2 + dpr, y - 7 * dpr + dpr);
      ctx.fillStyle = '#f3e6c4';
      ctx.fillText(t.label, x + sz / 2, y - 7 * dpr);
    }
    ctx.restore();
  }

  /** Glow-Stärke (0..1, pulsierend) für ein Objekt, falls es das aktuelle Ziel ist. */
  glowFor(obj, time) {
    const t = this.target;
    if (!t || t.obj !== obj) return 0;
    return 0.6 + Math.sin(time * 5) * 0.4;
  }
}

const NODE_LABEL = { tree: 'Holz fällen', rock: 'Stein brechen', bush: 'Feigen pflücken', herb: 'Kräuter sammeln', ashpile: 'Kohle schürfen' };

/** Ressourcenknoten im Umkreis von 2 Kacheln. */
function nodeProvider(game, out) {
  const { world, player: p } = game;
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      const n = world.nodeAtTile(p.tx + dx, p.ty + dy);
      if (!n || n.removed || n.amount <= 0) continue;
      out.push({
        kind: 'node', node: n, obj: n, x: n.x, y: n.y, label: NODE_LABEL[n.type],
        promptH: n.type === 'tree' ? 26 : 14,
        hit: (mx, my) => Math.floor(mx / TILE) === n.tx && Math.floor(my / TILE) === n.ty,
      });
    }
  }
}

/** Uferkacheln direkt neben dem Spieler (Wasser schöpfen). */
function waterProvider(game, out) {
  const { world, player: p } = game;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const tx = p.tx + dx, ty = p.ty + dy;
      if (!world.isWaterTile(tx, ty)) continue;
      if (p.distToTile(tx, ty) > 10) continue;
      out.push({
        kind: 'water', x: (tx + 0.5) * TILE, y: (ty + 0.5) * TILE, tx, ty, label: 'Wasser schöpfen', prio: 6, promptH: 10,
        reach: 30,
        hit: (mx, my) => Math.floor(mx / TILE) === tx && Math.floor(my / TILE) === ty,
      });
    }
  }
}
