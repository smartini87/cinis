// Szenario Mauern & Tore: Linie per Maus ziehen (Auto-Ausrichtung), Rotation per R, Diagonalen sind dicht,
// Ring mit Toren – Siedler gehen rein und raus, Gegner brechen durch Mauer/Tor statt durchzulaufen;
// komplett eingeschlossener Spieler: Gegner greifen die Mauer an statt hängenzubleiben.
export const query = 'skiptut';
export default async function (page) {
  const toScreen = (wx, wy) => page.evaluate(([wx, wy]) => {
    const g = window.__game, s = g.camera.worldToScreen(wx, wy), r = g.canvas.getBoundingClientRect();
    return { x: s.x * r.width / g.canvas.width, y: s.y * r.height / g.canvas.height };
  }, [wx, wy]);
  // 1) Mauerlinie mit der Maus ziehen (waagerecht, Auto)
  const base = await page.evaluate(() => {
    const g = window.__game, w = g.world;
    Object.assign(g.stock, { wood: 999, stone: 999 });
    for (const n of w.nodes) if (Math.hypot(n.tx - w.cx, n.ty - w.cy) < 12) w.removeNode(n);
    g.player.x = (w.cx + 0.5) * 16; g.player.y = (w.cy + 3) * 16; g.camera.snap(g.player.x, g.player.y);
    g.speed = 0;
    return { cx: w.cx, cy: w.cy };
  });
  await page.keyboard.press('KeyB');   // Kategorie „Wehr“
  await page.waitForTimeout(60);
  await page.keyboard.press('Digit1'); // Mauer
  const a = await toScreen((base.cx - 6 + 0.5) * 16, (base.cy - 5 + 0.5) * 16);
  const b = await toScreen((base.cx - 2 + 0.5) * 16, (base.cy - 5 + 0.5) * 16);
  await page.mouse.move(a.x, a.y);
  await page.waitForTimeout(60);
  await page.mouse.down();
  await page.waitForTimeout(60);
  await page.mouse.move(b.x, b.y, { steps: 5 });
  await page.waitForTimeout(80);
  await page.screenshot({ path: 'tools/out/walls-drag.png' });
  await page.mouse.up();
  await page.waitForTimeout(80);
  // 2) Rotation per R: Auto → waagerecht → senkrecht → ↘ → ↗ → Auto
  const rots = [];
  for (let i = 0; i < 5; i++) { await page.keyboard.press('KeyR'); await page.waitForTimeout(40); rots.push(await page.evaluate(() => window.__game.buildings.rotation)); }
  await page.keyboard.press('Escape');
  const r = await page.evaluate(async () => {
    const { moveCircle, overlaps } = await import('/js/physics.js');
    const g = window.__game, w = g.world, B = g.buildings, out = {}, cx = w.cx, cy = w.cy;
    g.speed = 1;
    const line = B.list.filter((b) => b.type === 'wall' && b.ty === cy - 5);
    out.dragged = line.length;
    out.dragRot = [...new Set(line.map((b) => b.rot))].join(',');
    for (const b of line) B.remove(b);
    // 3) Diagonale ist dicht: Kreis kommt nicht zwischen zwei diagonal benachbarten Mauern durch
    B.selected = 'wall'; B.rotation = 'auto';
    const diag = B.lineTiles(cx + 4, cy - 9, cx + 8, cy - 5);
    out.diagRot = [...new Set(diag.map((t) => t[2]))].join(',');
    B.placeTiles(g, diag.map(([tx, ty, rot]) => ({ tx, ty, rot, ok: true })));
    B.selected = null;
    B.finishAllSites(g);
    const probe = { x: (cx + 5 + 0.5) * 16, y: (cy - 9 + 0.5) * 16, r: 3 };
    for (let i = 0; i < 40; i++) moveCircle(w, probe, -1, 1, 'enemy');
    out.diagTight = !(Math.floor(probe.x / 16) <= cx + 4 && Math.floor(probe.y / 16) >= cy - 8);
    for (const bb of B.list.filter((x) => x.type === 'wall')) B.remove(bb);
    // 4) Ring (Radius 8) mit senkrechten Seiten und Toren auf den Straßen
    for (let y = cy - 8; y <= cy + 8; y++) for (let x = cx - 8; x <= cx + 8; x++) {
      const dx = Math.abs(x - cx), dy = Math.abs(y - cy);
      if (Math.max(dx, dy) !== 8) continue;
      const gate = x === cx || y === cy;
      const rot = dx === 8 ? 1 : 0;
      if (B.canPlace(gate ? 'gate' : 'wall', x, y).ok) B.place(g, gate ? 'gate' : 'wall', x, y, rot);
    }
    B.finishAllSites(g);
    out.ring = B.list.filter((b) => b.type === 'wall' || b.type === 'gate').length;
    out.sideRot = B.list.filter((b) => b.type === 'wall' && Math.abs(b.tx - cx) === 8 && Math.abs(b.ty - cy) < 8).every((b) => b.rot === 1);
    // Siedler: Hütte drinnen, Arbeit draußen
    B.place(g, 'hut', cx + 3, cy + 3);
    B.finishAllSites(g);
    for (let i = 0; i < 4; i++) g.settlers.spawn(B.center.x + i * 8, B.center.y + 30);
    let outside = 0, back = 0;
    const inside = (u) => Math.max(Math.abs(u.x / 16 - cx - 0.5), Math.abs(u.y / 16 - cy - 0.5)) < 7.6;
    for (let i = 0; i < 70 * 60; i++) {
      g.update(1 / 60);
      for (const s of g.settlers.colony) {
        if (!inside(s)) { s.wasOut = true; outside++; }
        else if (s.wasOut) { s.wasOut = false; back++; }
      }
    }
    out.settlersOut = outside > 0;
    out.settlersBack = back > 0;
    // 5) Gegner draußen: brechen durch statt durchzulaufen
    g.cycle.t = 160; g.enemies.queue = [];
    for (const s of g.settlers.colony) s.hp = 1e6;
    g.player.maxHp = g.player.hp = 1e6;
    const foes = [];
    for (let i = 0; i < 5; i++) foes.push(g.enemies.spawn('walker', (cx + 0.5) * 16 + (i - 2) * 10, (cy + 13) * 16));
    let illegal = 0;
    for (let i = 0; i < 25 * 60; i++) {
      g.update(1 / 60);
      const breached = B.list.some((b) => (b.type === 'wall' || b.type === 'gate') && b.dead) || B.list.filter((b) => b.type === 'wall' || b.type === 'gate').length < out.ring;
      for (const f of foes) if (!f.dead && inside(f) && !breached) illegal++;
    }
    out.illegal = illegal;
    out.ringDamaged = B.list.some((b) => (b.type === 'wall' || b.type === 'gate') && b.hp < b.maxHp) || B.list.filter((b) => b.type === 'wall' || b.type === 'gate').length < out.ring;
    for (const f of foes) f.dead = true;
    // 6) Spieler komplett eingeschlossen (Mauern ohne Tor), Gegner davor
    const px = cx - 4, py = cy - 4;
    for (let y = py - 2; y <= py + 2; y++) for (let x = px - 2; x <= px + 2; x++) {
      if (Math.max(Math.abs(x - px), Math.abs(y - py)) !== 2) continue;
      const o = w.buildingAt[w.idx(x, y)];
      if (o) B.remove(o);
      B.place(g, 'wall', x, y);
    }
    B.finishAllSites(g);
    const p = g.player;
    p.dead = false; p.standT = 0;
    p.x = (px + 0.5) * 16; p.y = (py + 0.5) * 16; p.vx = p.vy = 0; p.maxHp = p.hp = 1e6;
    g.input.keys.add('KeyD');
    let stuckInside = 0;
    for (let i = 0; i < 90; i++) { g.update(1 / 60); if (overlaps(w, p.x, p.y, p.r, 'friendly', 0.75)) stuckInside++; }
    g.input.keys.delete('KeyD');
    out.playerEscaped = Math.abs(p.x / 16 - px - 0.5) > 2;
    out.playerOverlap = stuckInside;
    const brute = g.enemies.spawn('walker', (px + 0.5) * 16, (py - 3) * 16);
    const wallsAround = B.list.filter((b) => b.type === 'wall' && Math.max(Math.abs(b.tx - px), Math.abs(b.ty - py)) === 2);
    for (let i = 0; i < 20 * 60; i++) {
      g.update(1 / 60);
    }
    out.enclosureAttacked = wallsAround.some((b) => b.dead || b.hp < b.maxHp) || g.player.hp < 1e6;
    brute.dead = true;
    p.maxHp = p.hp = 100;
    g.cycle.t = 60;
    g.camera.snap(B.center.x, B.center.y);
    return out;
  });
  r.rotations = rots.join(',');
  console.log(JSON.stringify(r));
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'tools/out/walls.png' });
  if (r.dragged !== 5 || r.dragRot !== '0') throw new Error('Mauerlinie per Ziehen falsch: ' + r.dragged + '/' + r.dragRot);
  if (r.rotations !== '0,1,2,3,auto') throw new Error('Rotation per R falsch: ' + r.rotations);
  if (r.diagRot !== '2' || !r.diagTight) throw new Error('Diagonale Mauer nicht dicht');
  if (!r.sideRot) throw new Error('Senkrechte Mauerseiten falsch ausgerichtet');
  if (!r.settlersOut || !r.settlersBack) throw new Error('Siedler kommen nicht durch die Tore');
  if (r.illegal) throw new Error('Gegner sind ohne Bresche in den Ring gelangt');
  if (!r.ringDamaged) throw new Error('Gegner greifen Mauer/Tor nicht an');
  if (r.playerEscaped || r.playerOverlap) throw new Error('Spieler kommt durch die Einschließung');
  if (!r.enclosureAttacked) throw new Error('Gegner greifen die Einschließung nicht an');
}
