// Szenario Wildlife & Dash: Obergrenzen, Flucht, Jagd liefert Nahrung, Wildschwein-Charge, Wolfsrudel greift an,
// meidet Licht und gibt auf; Dash kostet Energie, geht nicht durch Mauern, aber durch Tore.
export default async function (page) {
  const r = await page.evaluate(async () => {
    const { overlaps } = await import('/js/physics.js');
    const g = window.__game, w = g.world, p = g.player, W = g.wildlife, TILE = 16;
    const out = {};
    const sim = (sec, fn) => { for (let i = 0; i < sec * 60; i++) { g.update(1 / 60); if (fn) fn(); } };
    const c = g.buildings.center;
    // Ein freier Platz in der Wildnis, weit weg von der Flamme
    let spot = null;
    for (let d = 26; d < 40 && !spot; d++) for (let a = 0; a < 16 && !spot; a++) {
      const tx = Math.round(w.cx + Math.cos(a / 16 * Math.PI * 2) * d), ty = Math.round(w.cy + Math.sin(a / 16 * Math.PI * 2) * d);
      let ok = true;
      for (let y = -2; y <= 2; y++) for (let x = -2; x <= 2; x++) if (!w.passable(tx + x, ty + y, 'friendly')) ok = false;
      if (ok) spot = { x: (tx + 0.5) * TILE, y: (ty + 0.5) * TILE };
    }
    const goSpot = () => { p.x = spot.x; p.y = spot.y; p.vx = p.vy = 0; g.camera.snap(p.x, p.y); };
    // 1) Obergrenzen über einen ganzen Tag und eine Nacht (Spieler streift umher)
    goSpot();
    let maxAll = 0, maxDeco = 0, types = new Set();
    g.cycle.t = 20;
    for (let i = 0; i < 225 * 60; i++) {
      if (i % 600 === 0) { const a = i / 600; p.x = spot.x + Math.cos(a) * 80; p.y = spot.y + Math.sin(a) * 80; g.camera.snap(p.x, p.y); }
      p.hp = p.maxHp;
      g.update(1 / 60);
      if (i % 30 === 0) {
        maxAll = Math.max(maxAll, W.list.length);
        maxDeco = Math.max(maxDeco, W.list.filter((a) => a.def.cls === 'deco').length);
        for (const a of W.list) types.add(a.type);
      }
    }
    out.maxAll = maxAll; out.maxDeco = maxDeco; out.types = [...types].sort().join(',');
    // Tag 2, mittags
    g.cycle.t = 60; g.enemies.queue = [];
    for (const e of g.enemies.list) e.dead = true;
    W.clear();
    goSpot();
    g.update(1 / 60);
    // 2) Hase flieht
    const rab = W.spawn('rabbit', p.x + 40, p.y);
    const d0 = Math.hypot(rab.x - p.x, rab.y - p.y);
    sim(1.5);
    out.rabbitFled = !rab.dead && Math.hypot(rab.x - p.x, rab.y - p.y) > d0 + 20;
    // 3) Jagd: Hase direkt neben dem Spieler erlegen → Nahrung im Inventar
    W.clear();
    goSpot();
    p.inv.food = 0;
    const prey = W.spawn('rabbit', p.x + 12, p.y);
    prey.sense = 99; // noch nicht aufgeschreckt
    p.faceTowards(prey.x, prey.y);
    p.startAttack(g);
    sim(0.5);
    out.hunted = prey.dead;
    out.food = p.inv.food;
    // 4) Wildschwein: Nähe reizt es, Charge verletzt
    W.clear();
    goSpot();
    p.hp = p.maxHp;
    const boar = W.spawn('boar', p.x + 20, p.y);
    sim(2.5, () => { p.vx = p.vy = 0; });
    out.boarCharged = p.hp < p.maxHp;
    // 5) Wolfsrudel: greift außerhalb der Siedlung an, gibt nach einer Weile auf
    W.clear();
    goSpot();
    g.cycle.day = 3; g.cycle.t = 165; g.cycle.duskFired = true; g.enemies.queue = [];
    p.hp = p.maxHp = 1e6;
    W.spawnGroup('wolf', p.x + 90, p.y, g);
    const pack = W.list.find((a) => a.type === 'wolf').pack;
    let attacked = false;
    sim(8, () => { if (p.hp < 1e6) attacked = true; });
    out.wolvesAttacked = attacked;
    sim(9);
    out.wolvesGaveUp = pack.target === null && pack.cooldown > 0;
    // 6) Wölfe meiden das Licht der Flamme
    W.clear();
    p.x = c.x; p.y = c.y + 30; g.camera.snap(p.x, p.y);
    W.spawnGroup('wolf', c.x + 200, c.y, g);
    let maxLight = 0;
    sim(10, () => { for (const a of W.list) if (a.type === 'wolf') maxLight = Math.max(maxLight, g.lightAt(a.x, a.y)); });
    out.wolfMaxLight = Math.round(maxLight * 100) / 100;
    p.maxHp = 100; p.hp = 100;
    W.clear();
    g.cycle.t = 60;
    // 7) Dash: Energie, kein Durchkommen durch Mauern, aber durch Tore
    Object.assign(g.stock, { wood: 500, stone: 500 });
    for (const n of w.nodes) if (Math.hypot(n.tx - w.cx, n.ty - w.cy) < 11) w.removeNode(n);
    const wy = w.cy + 6;
    for (let x = w.cx - 3; x <= w.cx + 3; x++) g.buildings.place(g, x === w.cx + 2 ? 'gate' : 'wall', x, wy);
    g.update(1 / 60);
    let inside = 0;
    const check = () => { if (overlaps(w, p.x, p.y, p.r, 'friendly', 0.75)) inside++; };
    p.x = (w.cx - 1 + 0.5) * TILE; p.y = (wy - 1.5) * TILE; p.vx = p.vy = 0; p.energy = 100;
    p.aimX = 0; p.aimY = 1;
    p.requestDash = true;
    sim(0.6, check);
    out.dashBlocked = p.y < wy * TILE;
    out.energyAfterDash = Math.round(p.energy);
    p.x = (w.cx + 2 + 0.5) * TILE; p.y = (wy - 1.5) * TILE; p.vx = p.vy = 0;
    p.dashCd = 0; p.requestDash = true;
    sim(0.6, check);
    out.dashThroughGate = p.y > (wy + 1) * TILE;
    out.dashOverlaps = inside;
    // Energie leer → kein Dash, Leiste blinkt
    p.energy = 10; p.regenDelay = 5; p.dashCd = 0;
    const y0 = p.y;
    p.requestDash = true;
    sim(0.3);
    out.emptyBlocked = Math.abs(p.y - y0) < 5 && p.emptyFlash > 0;
    return out;
  });
  console.log(JSON.stringify(r));
  await page.screenshot({ path: 'tools/out/wildlife.png' });
  if (r.maxAll > 60 || r.maxDeco > 30) throw new Error('Zu viele Tiere');
  if (!r.rabbitFled) throw new Error('Hase flieht nicht');
  if (!r.hunted || r.food < 2) throw new Error('Jagd liefert keine Nahrung');
  if (!r.boarCharged) throw new Error('Wildschwein greift nicht an');
  if (!r.wolvesAttacked) throw new Error('Wölfe greifen nicht an');
  if (!r.wolvesGaveUp) throw new Error('Wölfe geben nicht auf');
  if (r.wolfMaxLight > 0.5) throw new Error('Wölfe laufen ins Licht');
  if (!r.dashBlocked || r.dashOverlaps) throw new Error('Dash durch die Mauer');
  if (!r.dashThroughGate) throw new Error('Dash nicht durchs Tor');
  if (r.energyAfterDash > 75) throw new Error('Dash kostet keine Energie');
  if (!r.emptyBlocked) throw new Error('Dash trotz leerer Energie');
}
