// Szenario Baustellen: Platzieren ohne Material, Spieler liefert mit E aus dem Gepäck, Siedler holen den Rest aus
// dem Lager, Fertigstellung; Gegner zerstören Baustellen; Abriss einer Baustelle gibt 75 % zurück.
export const query = 'skiptut';
export default async function (page) {
  const r = await page.evaluate(() => {
    const g = window.__game, w = g.world, B = g.buildings, p = g.player, out = {};
    const sim = (sec) => { for (let i = 0; i < sec * 60; i++) g.update(1 / 60); };
    for (const n of w.nodes) if (Math.hypot(n.tx - w.cx, n.ty - w.cy) < 12) w.removeNode(n);
    Object.assign(g.stock, { wood: 0, stone: 0, food: 50, water: 50 });
    for (const k in p.inv) p.inv[k] = 0;
    // 1) Ohne Material platzieren
    const hut = B.place(g, 'hut', w.cx + 4, w.cy + 3);
    out.placed = !!hut && !!hut.site;
    out.hpShare = hut && Math.round((hut.hp / hut.maxHp) * 100);
    out.blocks = !w.passable(w.cx + 4, w.cy + 3, 'friendly');
    // 2) Spieler liefert aus dem Gepäck
    p.inv.wood = 8;
    p.x = hut.x; p.y = hut.y + 28; p.vx = p.vy = 0;
    g.input.keys.add('KeyE');
    sim(0.5);
    g.input.keys.delete('KeyE');
    out.gotWood = hut.site ? hut.site.got.wood || 0 : -1;
    out.invAfter = p.inv.wood;
    // 3) Siedler holen den Rest aus dem Lager
    Object.assign(g.stock, { wood: 60, stone: 40 });
    const c = B.center;
    for (let i = 0; i < 3; i++) g.settlers.spawn(c.x - 16 + i * 16, c.y + 30);
    p.x = c.x - 60; p.y = c.y - 60;
    let fetched = 0;
    for (let i = 0; i < 40 * 60 && hut.site; i++) {
      g.update(1 / 60);
      if (g.settlers.colony.some((s) => s.task && s.task.type === 'build')) fetched++;
    }
    out.settlersBuilt = fetched > 0;
    out.done = !hut.site && B.count('hut') === 1;
    out.stockAfter = { wood: g.stock.wood, stone: g.stock.stone };
    // 4) Gegner zerstören Baustellen: geschlossener Ring aus Mauer-Baustellen, Koloss draußen
    const ring = [];
    for (let y = w.cy - 9; y <= w.cy + 9; y++) for (let x = w.cx - 9; x <= w.cx + 9; x++) {
      if (Math.max(Math.abs(x - w.cx), Math.abs(y - w.cy)) !== 9) continue;
      const b = B.canPlace('wall', x, y).ok ? B.place(g, 'wall', x, y) : null;
      if (b) ring.push(b);
    }
    g.cycle.t = 160; g.enemies.queue = [];
    for (const s of g.settlers.list) s.hp = 1e6;
    const brute = g.enemies.spawn('brute', (w.cx + 0.5) * 16, (w.cy + 12) * 16);
    brute.retarget = 999;
    sim(25);
    out.ringSites = ring.length;
    out.siteDestroyed = ring.some((b) => b.dead);
    brute.dead = true;
    for (const b of ring) if (!b.dead) B.remove(b);
    g.cycle.t = 60;
    // 5) Abriss einer Baustelle: 75 % des Gelieferten zurück
    Object.assign(g.stock, { wood: 0, stone: 20 });
    const well = B.place(g, 'well', w.cx - 5, w.cy + 4);
    B.deliverTo(g, well, 'stone', 8);
    g.stock.stone = 0;
    B.demolish(g, well);
    out.refund = g.stock.stone;
    // Für den Screenshot: halbfertige Farm neben dem Spieler
    Object.assign(g.stock, { wood: 0, water: 0 });
    const farm = B.place(g, 'farm', w.cx + 3, w.cy - 6);
    B.deliverTo(g, farm, 'wood', 7);
    g.settlers.list.length = 0;
    p.x = farm.x + 10; p.y = farm.y + 34; g.camera.zoomBias = 1; g.camera.updateZoom(); g.camera.snap(p.x, p.y - 10);
    return out;
  });
  console.log(JSON.stringify(r));
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'tools/out/construction.png' });
  if (!r.placed || r.hpShare > 30 || !r.blocks) throw new Error('Baustelle wird nicht korrekt angelegt');
  if (r.gotWood !== 8 || r.invAfter !== 0) throw new Error('Spieler-Lieferung fehlerhaft');
  if (!r.settlersBuilt || !r.done) throw new Error('Siedler stellen die Baustelle nicht fertig');
  if (!r.siteDestroyed) throw new Error('Gegner zerstören die Baustelle nicht');
  if (r.refund !== 6) throw new Error('Abriss-Rückgabe falsch: ' + r.refund);
}
