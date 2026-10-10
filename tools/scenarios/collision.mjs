// Szenario Kollision: Spieler (auch mit extrem hoher Geschwindigkeit) steckt nie in Mauer, Hütte oder Turm,
// Siedler betreten nie Gebäude und erreichen ihre Ziele, Tore lassen nur eigene Leute durch,
// Gegner stapeln sich nicht. Screenshot: Figur hinter einer Hütte bleibt als Silhouette sichtbar.
export const query = 'skiptut'; // alles freigeschaltet (ohne geführten Einstieg)
export default async function (page) {
  const r = await page.evaluate(async () => {
    const { overlaps } = await import('/js/physics.js');
    const g = window.__game, w = g.world, B = g.buildings, p = g.player, TILE = 16;
    const cx = w.cx, cy = w.cy;
    const out = {};
    Object.assign(g.stock, { wood: 999, stone: 999, water: 200, food: 200 });
    for (const n of w.nodes) if (Math.hypot(n.tx - cx, n.ty - cy) < 13) w.removeNode(n);
    const place = (t, x, y) => B.place(g, t, x, y) || (() => { throw new Error(`${t} bei ${x},${y} nicht baubar: ${B.canPlace(t, x, y).reason}`); })();
    // Hindernisparcours: Mauerzeile südlich, Hütte nordöstlich, Turm westlich
    for (let x = cx - 4; x <= cx + 4; x++) place('wall', x, cy + 5);
    const hut = place('hut', cx + 4, cy - 5);
    const tower = place('tower', cx - 5, cy - 1);
    g.update(1 / 60);
    const sim = (sec, check) => { for (let i = 0; i < sec * 60; i++) { g.update(1 / 60); if (check) check(); } };
    let bad = 0;
    const checkPlayer = () => { if (overlaps(w, p.x, p.y, p.r, 'friendly', 0.75)) bad++; };
    // 1) Spieler läuft mit Tastatur gegen alle Hindernisse (auch diagonal an Ecken)
    const run = (keys, sec, x, y) => {
      p.x = x; p.y = y; p.vx = p.vy = 0;
      for (const k of keys) g.input.keys.add(k);
      sim(sec, checkPlayer);
      for (const k of keys) g.input.keys.delete(k);
    };
    run(['KeyS'], 1.5, (cx + 0.5) * TILE, (cy + 3) * TILE);              // frontal gegen die Mauer
    run(['KeyS', 'KeyD'], 2, (cx + 2) * TILE, (cy + 3.5) * TILE);         // schräg an der Mauer entlang
    run(['KeyS', 'KeyA'], 2, (cx + 6.2) * TILE, (cy + 3.6) * TILE);       // auf die Mauerecke
    run(['KeyD', 'KeyW'], 2, (cx + 2) * TILE, (cy - 2) * TILE);           // gegen die Hütte
    run(['KeyA'], 1.5, (cx - 2.5) * TILE, (cy - 0.5) * TILE);             // gegen den Turm
    // Extremtempo (simuliert Dash/3×): Sollgeschwindigkeit 3000 Einheiten/s gegen die Mauer
    let tunnel = 0;
    for (const [sx, sy, vx, vy] of [[cx + 0.5, cy + 3.5, 0, 3000], [cx + 4.5, cy - 7.5, 0, 3000], [cx - 7.5, cy - 0.5, 3000, 0]]) {
      p.x = sx * TILE; p.y = sy * TILE;
      for (let i = 0; i < 10; i++) { p.vx = vx; p.vy = vy; g.update(1 / 60); checkPlayer(); }
      if (vy && p.y > sy * TILE + 3 * TILE) tunnel++;
      if (vx && p.x > sx * TILE + 3 * TILE) tunnel++;
    }
    out.playerOverlaps = bad;
    out.tunnel = tunnel;

    // 2) 20 Siedler arbeiten 45 s und suchen dann Schutz: nie in einem Gebäude, alle kommen an
    p.x = (cx + 0.5) * TILE; p.y = (cy + 3) * TILE;
    for (let i = 0; i < 20; i++) g.settlers.spawn((cx - 8 + (i % 5) * 4 + 0.5) * TILE, (cy - 8 + Math.floor(i / 5) * 2 + 0.5) * TILE);
    let huts = 0;
    for (let y = cy - 12; y <= cy + 12 && huts < 8; y += 3) for (let x = cx - 12; x <= cx + 12 && huts < 8; x += 3) {
      if (Math.abs(x - cx) < 7 && Math.abs(y - cy) < 7) continue;
      if (B.canPlace('hut', x, y).ok && B.place(g, 'hut', x, y)) huts++;
    }
    const gathered0 = g.stats.gathered;
    let inside = 0;
    const checkSettlers = () => {
      for (const s of g.settlers.list) {
        if (s.hidden) continue;
        const b = w.buildingAt[w.idx(Math.floor(s.x / TILE), Math.floor(s.y / TILE))];
        if ((b && b.type !== 'gate') || overlaps(w, s.x, s.y, s.r, 'friendly', 0.75)) inside++;
      }
    };
    sim(45, checkSettlers);
    out.gathered = g.stats.gathered - gathered0;
    g.cycle.t = 135; // Abend: alle suchen Schutz
    g.enemies.queue = [];
    sim(22, () => { checkSettlers(); g.enemies.queue.length = 0; });
    out.settlerInside = inside;
    out.sheltered = g.settlers.colony.filter((s) => s.hidden).length;
    out.settlers = g.settlers.colony.length;

    // 3) Mauerring mit Toren: Siedler kommen durch, Gegner nicht
    g.cycle.t = 20;
    sim(3);
    for (let y = cy - 10; y <= cy + 10; y++) for (let x = cx - 10; x <= cx + 10; x++) {
      if (Math.max(Math.abs(x - cx), Math.abs(y - cy)) !== 10) continue;
      const t = x === cx || y === cy ? 'gate' : 'wall';
      if (B.canPlace(t, x, y).ok) B.place(g, t, x, y);
    }
    g.update(1 / 60);
    const outside = [cx, cy + 18];
    const path = w.findPath(outside[0], outside[1], cx, cy + 3);
    out.pathThroughGate = !!path && path.some(([x, y]) => w.buildingAt[w.idx(x, y)]?.type === 'gate');
    g.cycle.t = 160;
    g.enemies.queue = [];
    const foes = [];
    for (let i = 0; i < 6; i++) foes.push(g.enemies.spawn('walker', (cx + 0.5) * TILE + (i - 3) * 6, (cy + 18) * TILE));
    for (const f of foes) f.retarget = 999; // nur Flussfeld, keine Einheitenjagd
    p.x = (cx + 2) * TILE; p.y = (cy + 2) * TILE;
    let breached = 0;
    sim(15, () => {
      for (const f of foes) if (!f.dead && Math.max(Math.abs(f.x / TILE - cx - 0.5), Math.abs(f.y / TILE - cy - 0.5)) < 9.4) breached++;
    });
    const ringHp = B.list.filter((b) => (b.type === 'wall' || b.type === 'gate') && b.hp < b.maxHp).length;
    out.breached = breached;
    out.ringDamaged = ringHp;

    // 4) 20 Gegner auf einem Punkt sind nach 2 s getrennt
    for (const e of g.enemies.list) e.dead = true;
    g.update(1 / 60);
    const px = (cx + 30) * TILE, py = (cy - 30) * TILE;
    const pack = [];
    for (let i = 0; i < 20; i++) { const e = g.enemies.spawn('walker', px, py); e.speed = 0; pack.push(e); }
    sim(2);
    let worst = 0;
    for (let i = 0; i < pack.length; i++) for (let j = i + 1; j < pack.length; j++) {
      const a = pack[i], b = pack[j], min = a.r + b.r, d = Math.hypot(a.x - b.x, a.y - b.y);
      worst = Math.max(worst, (min - d) / min);
    }
    out.enemyOverlap = Math.round(worst * 100) / 100;
    for (const e of pack) e.dead = true;

    // 5) Spieler hinter der Hütte (nördlich) für den Screenshot
    g.cycle.t = 60;
    p.x = hut.x; p.y = (hut.ty + 0.6) * TILE;
    for (const s of g.settlers.list) { s.x = hut.x + 6; s.y = (hut.ty + 0.4) * TILE; s.task = { type: 'idle', t: 99 }; s.path = null; break; }
    g.camera.zoomBias = 2; g.camera.updateZoom();
    g.camera.snap(p.x, p.y);
    return out;
  });
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'tools/out/collision-occlusion.png' });
  console.log(JSON.stringify(r));
  if (r.playerOverlaps) throw new Error(`Spieler steckte ${r.playerOverlaps}× in einem Collider`);
  if (r.tunnel) throw new Error('Spieler ist bei hohem Tempo durch ein Hindernis gerutscht');
  if (r.settlerInside) throw new Error(`Siedler ${r.settlerInside}× in einem Gebäude`);
  if (r.gathered < 10) throw new Error('Siedler arbeiten nicht (Ziele nicht erreicht)');
  if (r.sheltered < r.settlers) throw new Error(`Nur ${r.sheltered}/${r.settlers} Siedler haben Schutz erreicht`);
  if (!r.pathThroughGate) throw new Error('Kein Weg durch das Tor');
  if (r.breached) throw new Error('Gegner sind durch Mauer/Tor gelaufen');
  if (!r.ringDamaged) throw new Error('Gegner greifen Mauer/Tor nicht an');
  if (r.enemyOverlap > 0.3) throw new Error(`Gegner überlappen zu stark (${r.enemyOverlap})`);
}
