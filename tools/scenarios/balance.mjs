// Balancing-Lauf: ein einfacher Bot spielt 30 Nächte im Schnelldurchlauf.
// Er baut morgens nach festen Regeln (Hütten, Versorgung, Türme, Mauerring) und bleibt kämpfend an der Flamme.
// Ausgabe: Verlauf pro Nacht. Aufruf: node tools/smoke-test.mjs tools/scenarios/balance.mjs
export const query = 'skiptut'; // alles freigeschaltet (ohne geführten Einstieg)
export default async function (page) {
  const log = await page.evaluate(() => {
    const g = window.__game, w = g.world, B = g.buildings;
    const cx = w.cx, cy = w.cy;
    const ring = (r0, r1) => {
      const out = [];
      for (let y = cy - r1; y <= cy + r1; y++) for (let x = cx - r1; x <= cx + r1; x++) {
        const d = Math.max(Math.abs(x - cx), Math.abs(y - cy));
        if (d >= r0 && d <= r1) out.push([x, y]);
      }
      return out.sort((a, b) => Math.hypot(a[0] - cx, a[1] - cy) - Math.hypot(b[0] - cx, b[1] - cy));
    };
    // Straßen (Achsen durch die Flamme) bleiben frei, damit Siedler überall hinkommen
    const size = { hut: 2, farm: 2 };
    const offRoad = (type, x, y) => { const s = size[type] || 1; return !(x <= cx && cx < x + s) && !(y <= cy && cy < y + s); };
    const tryPlace = (type, cands) => {
      for (const [x, y] of cands) {
        if (type !== 'gate' && !offRoad(type, x, y)) continue;
        if (B.canPlace(type, x, y).ok && B.canAfford(g, B.costAt(type, x, y))) {
          return B.place(g, type, x, y);
        }
      }
      return null;
    };
    const towerSpots = ring(5, 7).filter(([x, y]) => (x + y) % 3 === 0).concat(ring(10, 12).filter(([x, y]) => (x + y) % 2 === 0));
    const wallSpots = ring(9, 9);
    const gateSpots = wallSpots.filter(([x, y]) => x === cx || y === cy);
    const homeSpots = ring(2, 4);
    const bot = () => {
      const pop = g.settlers.list.length;
      while (g.settlers.capacity(g) < pop + 2 && B.count('hut') < 12 && tryPlace('hut', homeSpots.concat(ring(5, 8)))) {}
      while (B.count('farm') < Math.max(1, Math.ceil(pop / 6)) && tryPlace('farm', ring(3, 8))) {}
      while (B.count('well') < Math.max(1, Math.ceil(pop / 7)) && tryPlace('well', ring(3, 8))) {}
      while (g.stock.wood > 40 && g.stock.stone > 30 && tryPlace('tower', towerSpots)) {}
      while (g.stock.stone > 20 && tryPlace('gate', gateSpots)) {}
      while (g.stock.stone > 20 && tryPlace('wall', wallSpots)) {}
    };
    // Bot klinkt sich in die Ereignisse ein
    const origDawn = g.onDawn.bind(g);
    const rows = [];
    let minCenter = 1e9;
    g.onDawn = (day) => {
      rows.push({ night: day - 1, center: Math.round(minCenter), pop: g.settlers.list.length, huts: B.count('hut'), towers: B.count('tower'), walls: B.count('wall'), gates: B.count('gate'), wood: Math.round(g.stock.wood), stone: Math.round(g.stock.stone), food: Math.round(g.stock.food), water: Math.round(g.stock.water), kills: g.stats.kills, lost: g.stats.lost });
      minCenter = 1e9;
      origDawn(day);
      bot();
    };
    g.input.keys.add('Space'); // Spieler kämpft dauerhaft an der Flamme
    bot();
    const rocks = w.nodes.filter((n) => n.type === 'rock' && !n.removed).length;
    console.log('Steinvorrat auf der Karte: ' + rocks * 16);
    const t0 = performance.now();
    for (let i = 0; i < 31 * 225 * 60 && !g.over; i++) {
      g.update(1 / 60);
      const c = B.center;
      if (c.hp < minCenter) minCenter = c.hp;
      if (g.cycle.t > 60 && g.cycle.t < 61 && !g.cycle.isNight) bot();
      // Spieler zurück zur Flamme, falls abgedrängt
      if (Math.hypot(g.player.x - c.x, g.player.y - c.y) > 40) { g.player.x = c.x; g.player.y = c.y + 30; }
    }
    g.input.keys.delete('Space');
    return { rows, over: g.over, day: g.cycle.day, ms: Math.round(performance.now() - t0) };
  });
  for (const r of log.rows) console.log(JSON.stringify(r));
  console.log(`Ergebnis: ${log.over || 'läuft'} an Tag ${log.day} (${log.ms} ms)`);
  await page.screenshot({ path: 'tools/out/balance.png' });
}
