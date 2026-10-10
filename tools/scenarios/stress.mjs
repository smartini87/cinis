// Kollisions-Stresstest: 15 Spielminuten (= 5 Minuten bei 3× Tempo) mit Siedlern, Mauerring und Toren,
// Nächten voller Gegner, Wölfen und einem Bot-Spieler, der kreuz und quer läuft, dasht und kämpft.
// Geprüft wird in jedem Schritt: keine Einheit steckt in einem Collider, und keine Einheit hängt länger als 3 s
// fest (will laufen, kommt aber nicht vom Fleck, ohne dass andere Einheiten sie blockieren).
export const query = 'skiptut';
export default async function (page) {
  const r = await page.evaluate(async () => {
    const { overlaps } = await import('/js/physics.js');
    const g = window.__game, w = g.world, B = g.buildings, p = g.player, TILE = 16;
    const cx = w.cx, cy = w.cy;
    Object.assign(g.stock, { wood: 999, stone: 999, food: 300, water: 300, iron: 50, coal: 50, bolts: 500 });
    g.flame.level = 3;
    g.progress.addBlueprint('trap');
    for (const n of w.nodes) if (Math.hypot(n.tx - cx, n.ty - cy) < 6) w.removeNode(n);
    // Siedlung: Hütten, Farm, Brunnen, Mauerring (Radius 9) mit Toren, Türme, Fallen
    for (const [x, y] of [[cx + 3, cy + 3], [cx - 5, cy + 3], [cx + 3, cy - 5], [cx - 5, cy - 5]]) B.place(g, 'hut', x, y);
    B.place(g, 'farm', cx + 5, cy - 1); B.place(g, 'well', cx - 3, cy + 1);
    for (let y = cy - 9; y <= cy + 9; y++) for (let x = cx - 9; x <= cx + 9; x++) {
      const dx = Math.abs(x - cx), dy = Math.abs(y - cy);
      if (Math.max(dx, dy) !== 9) continue;
      const t = x === cx || y === cy ? 'gate' : 'wall';
      if (B.canPlace(t, x, y).ok) B.place(g, t, x, y, dx === 9 && dy < 9 ? 1 : 0);
    }
    for (const [x, y] of [[cx + 6, cy + 6], [cx - 6, cy - 6], [cx + 6, cy - 6], [cx - 6, cy + 6]]) B.place(g, 'tower', x, y);
    for (let i = -2; i <= 2; i++) B.place(g, 'trap', cx + i, cy + 11);
    B.finishAllSites(g);
    for (let i = 0; i < 12; i++) g.settlers.spawn(B.center.x - 30 + i * 5, B.center.y + 30);
    g.cycle.day = 4; g.cycle.t = 20; g.cycle.duskFired = false;

    const units = () => {
      const out = [];
      if (!p.dead) out.push(['player', p, 'friendly']);
      for (const s of g.settlers.list) if (!s.hidden) out.push(['settler', s, 'friendly']);
      for (const e of g.enemies.list) if (!e.dead) out.push(['enemy:' + e.type, e, e.mask]);
      for (const a of g.wildlife.list) if (!a.dead && a.def.cls !== 'deco') out.push(['animal:' + a.type, a, 'animal']);
      return out;
    };
    const stuckT = new Map(), last = new Map();
    let overlapsN = 0, stuckN = 0, frames = 0;
    const examples = [];
    const crowded = (u) => {
      for (const [, o] of units()) if (o !== u && Math.hypot(o.x - u.x, o.y - u.y) < (u.r + (o.r || 3)) + 3) return true;
      return false;
    };
    // Bot-Spieler: wechselnde Ziele kreuz und quer, Dash alle paar Sekunden, Leertaste gehalten
    let goal = null, goalT = 0, dashT = 2, progT = 0, px0 = p.x, py0 = p.y;
    const STEPS = 900 * 60;
    for (let i = 0; i < STEPS && !g.over; i++) {
      const dt = 1 / 60;
      if (g.state !== 'playing') g.setState('playing');
      goalT -= dt;
      // Wie ein Mensch: kommt der Spieler 1 s lang nicht voran (Ziel hinter einer Mauer), wählt er ein neues Ziel
      progT += dt;
      if (progT >= 1) {
        if (Math.hypot(p.x - px0, p.y - py0) < 6) goalT = 0;
        progT = 0; px0 = p.x; py0 = p.y;
      }
      if (!goal || goalT <= 0 || Math.hypot(goal.x - p.x, goal.y - p.y) < 8) {
        const a = Math.random() * Math.PI * 2, d = 40 + Math.random() * 220;
        goal = { x: B.center.x + Math.cos(a) * d, y: B.center.y + Math.sin(a) * d };
        goalT = 6;
      }
      const gx = goal.x - p.x, gy = goal.y - p.y, gl = Math.hypot(gx, gy) || 1;
      p.botMove = { x: gx / gl, y: gy / gl };
      dashT -= dt;
      if (dashT <= 0) { p.requestDash = true; dashT = 2 + Math.random() * 3; }
      g.input.keys.add('Space');
      p.hp = Math.max(p.hp, 60); // der Testspieler soll nicht dauernd sterben
      B.center.hp = B.center.maxHp;
      g.flame.vigor = 100;
      g.update(dt);
      if (g.hitStop > 0) continue;
      frames++;
      // Wolfsrudel nachts in der Nähe des Spielers
      // (nur außerhalb der Siedlung, wie im Spiel)
      if (g.cycle.isNight && i % (60 * 40) === 0 && Math.hypot(p.x - B.center.x, p.y - B.center.y) > 13 * TILE) g.wildlife.spawnGroup('wolf', p.x + 120, p.y + 40, g);
      for (const [kind, u, mask] of units()) {
        if (overlaps(w, u.x, u.y, u.r, mask, 0.75)) {
          overlapsN++;
          if (examples.length < 6) {
            const tb = w.buildingAt[w.idx(Math.floor(u.x / TILE), Math.floor(u.y / TILE))];
            const pr = last.get(u);
            examples.push(`overlap ${kind} @${Math.floor(u.x / TILE) - cx},${Math.floor(u.y / TILE) - cy} in=${tb ? tb.type + (tb.site ? '(site)' : '') : '-'} sub=${Math.round(u.x % TILE)},${Math.round(u.y % TILE)} dash=${u.dashT > 0} dead=${u.dead} prev=${pr ? Math.round(pr.x - u.x) + ',' + Math.round(pr.y - u.y) : '?'} step=${i}`);
          }
        }
        // Festhängen: läuft (Animationsphase steigt), kommt aber 3 s lang nicht vom Fleck und niemand steht im Weg
        if (i % 30 || kind === 'player') continue; // den Spieler steuert hier ein einfacher Testbot
        const l = last.get(u);
        last.set(u, { x: u.x, y: u.y, walk: u.walk });
        if (!l) continue;
        const wants = u.walk !== l.walk, moved = Math.hypot(u.x - l.x, u.y - l.y);
        const t = wants && moved < 1 && !crowded(u) ? (stuckT.get(u) || 0) + 0.5 : 0;
        stuckT.set(u, t);
        if (t > 3) {
          stuckN++;
          stuckT.set(u, 0);
          if (examples.length < 12) examples.push(`stuck ${kind} @${Math.floor(u.x / TILE) - cx},${Math.floor(u.y / TILE) - cy} task=${u.task ? u.task.type : u.state || '-'}${u.task && u.task.type ? ` path=${u.path ? JSON.stringify(u.path.slice(u.pathI, u.pathI + 3).map(([x, y]) => [x - cx, y - cy])) : '-'} sub=${Math.round(u.x % TILE)},${Math.round(u.y % TILE)} near=${[[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => { const tx = Math.floor(u.x / TILE) + dx, ty = Math.floor(u.y / TILE) + dy, n = w.nodeAtTile(tx, ty), b = w.buildingAt[w.idx(tx, ty)]; return (b ? b.type[0] : '') + (n && !n.removed && n.amount > 0 ? n.type[0] : '') + (w.passable(tx, ty, 'friendly') ? '' : '#') || '.'; }).join('')}` : ''}${u.guard ? ` guard tgt=${u.target ? (u.target === p ? 'P' : 'u') : '-'} patrol=${u.patrol ? Math.round(u.patrol.x - u.x) + ',' + Math.round(u.patrol.y - u.y) : '-'} wait=${(u.waitT || 0).toFixed(1)} bl=${(u.blockedT || 0).toFixed(2)} br=${u.breach ? u.breach.type : '-'}` : ''}`);
        }
      }
    }
    g.input.keys.delete('Space');
    p.botMove = null;
    return { frames, day: g.cycle.day, overlapsN, stuckN, examples, kills: g.stats.kills, settlers: g.settlers.colony.length };
  });
  console.log(JSON.stringify(r));
  if (r.overlapsN) throw new Error(`${r.overlapsN} Überlappungen mit Collidern`);
  if (r.stuckN) throw new Error(`${r.stuckN}× länger als 3 s festgehangen`);
}
