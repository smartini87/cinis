// Balancing-Lauf: ein Bot spielt im Schnelldurchlauf (bis Nacht 30).
// Er startet allein: holt Holz für die erste Hütte, rettet tagsüber per Autopilot (A*) Überlebende aus den Lagern,
// baut morgens nach festen Regeln (Hütten, Versorgung, Türme, Mauerring mit Toren) und kämpft nachts an der Flamme.
// Ausgabe: Verlauf pro Nacht. Aufruf: node tools/smoke-test.mjs tools/scenarios/balance.mjs
export const query = 'skiptut';
export default async function (page) {
  const log = await page.evaluate(async () => {
    const { RECIPES, craft } = await import('/js/recipes.js');
    const g = window.__game, w = g.world, B = g.buildings, p = g.player, TILE = 16;
    const recipe = (id) => RECIPES.find((r) => r.id === id);
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
    // Was offene Baustellen noch brauchen, ist im Lager schon verplant
    const free = (k) => g.stock[k] + p.inv[k] - B.sites.reduce((a, b) => a + (b.site.need[k] || 0) - (b.site.got[k] || 0), 0);
    const canAfford = (cost) => Object.entries(cost).every(([k, n]) => free(k) >= n);
    const tryPlace = (type, cands) => {
      for (const [x, y, rot] of cands) {
        if (type !== 'gate' && !offRoad(type, x, y)) continue;
        if (B.canPlace(type, x, y).ok && canAfford(B.costAt(type, x, y))) {
          return B.place(g, type, x, y, rot ?? null);
        }
      }
      return null;
    };
    const towerSpots = ring(5, 7).filter(([x, y]) => (x + y) % 3 === 0).concat(ring(10, 12).filter(([x, y]) => (x + y) % 2 === 0));
    // Mauerring: Seiten senkrecht, oben/unten waagerecht
    const wallSpots = ring(9, 9).map(([x, y]) => [x, y, Math.abs(x - cx) === 9 && Math.abs(y - cy) < 9 ? 1 : 0]);
    const gateSpots = wallSpots.filter(([x, y]) => x === cx || y === cy);
    const homeSpots = ring(2, 4);
    const fireSpots = ring(6, 6).filter(([x, y]) => (x + y) % 4 === 0);
    const trapSpots = ring(10, 11).filter(([x, y]) => x === cx || y === cy || Math.abs(x - cx) === Math.abs(y - cy));
    // Bolzen an der Flamme nachproduzieren (Türme verbrauchen pro Schuss einen)
    const ammo = () => {
      const want = 30 + B.count('tower') * 12;
      for (let i = 0; i < 20 && g.stock.bolts < want && free('wood') > 25 && free('stone') > 15; i++) craft(g, recipe('bolts'));
    };
    // Flamme: entfachen, wenn danach Brennstoff für 3 Nächte da ist; bei niedriger Glut nachlegen
    const flame = () => {
      const f = g.flame;
      if (f.next && f.canUpgrade(g)) {
        const after = { ...g.stock };
        for (const [k, n] of Object.entries(f.next.cost)) after[k] -= n;
        if (Object.entries(f.next.fuel).every(([k, n]) => (after[k] || 0) >= n * 3)) f.upgrade(g);
      }
      if (f.vigor < 70 && f.fuelCovered(g.stock, 2)) f.feed(g);
    };
    const build = () => {
      flame();
      ammo();
      const pop = g.settlers.colony.length;
      // Baustellen, die seit mehr als einem Tag stocken (z. B. unerreichbar), wieder abreißen
      for (const b of B.sites) if (g.time - (b.site.since || 0) > 225) B.demolish(g, b);
      while (g.settlers.capacity(g) + B.sites.filter((b) => b.type === 'hut').length * 4 < pop + 3 && B.countAll('hut') < 10 && tryPlace('hut', homeSpots.concat(ring(5, 8)))) {}
      // Ohne Siedler liefert der Spieler selbst (wie E an der Baustelle)
      if (!pop) for (const b of B.sites) B.playerDeliver(g, b);
      if (!pop) return;
      // Zerstörte Tore zuerst ersetzen, damit niemand ausgesperrt ist
      if (B.countAll('wall')) while (free('stone') > 6 && tryPlace('gate', gateSpots)) {}
      while (B.countAll('farm') < Math.max(1, Math.ceil(pop / 5)) && tryPlace('farm', ring(3, 8))) {}
      while (B.countAll('well') < Math.max(1, Math.ceil(pop / 6)) && tryPlace('well', ring(3, 8))) {}
      if (B.sites.length > 4) return; // erst die offenen Baustellen fertig werden lassen
      while (free('wood') > 40 && free('stone') > 30 && tryPlace('tower', towerSpots)) {}
      while (free('stone') > 20 && tryPlace('gate', gateSpots)) {}
      while (free('stone') > 20 && tryPlace('wall', wallSpots)) {}
      if (g.isAvailable('workbench')) tryPlace('workbench', B.countAll('workbench') ? [] : ring(3, 6));
      if (g.isAvailable('storehouse') && !B.countAll('storehouse')) tryPlace('storehouse', ring(6, 8));
      if (g.isAvailable('firebowl')) while (B.countAll('firebowl') < 4 + g.flame.level && free('coal') > 6 && tryPlace('firebowl', fireSpots)) {}
      if (g.isAvailable('trap')) while (B.countAll('trap') < 12 && free('iron') > 2 && tryPlace('trap', trapSpots)) {}
      if (g.isAvailable('tower2')) for (const t of B.ofType('tower').slice(0, 2)) if (free('iron') > 8 && canAfford(B.costAt('tower2', t.tx, t.ty))) B.place(g, 'tower2', t.tx, t.ty);
    };

    // ---------------------------------------------------------------- Autopilot-Ausflüge
    let trip = null;
    const pathTo = (tx, ty) => w.findPath(p.tx, p.ty, tx, ty, 9000);
    const home = () => B.accessPoint(B.center, p.x, p.y);
    const startTrip = (kind, tx, ty, data) => {
      const path = pathTo(tx, ty);
      if (!path) return false;
      trip = { kind, phase: 'go', path, i: 0, t: 0, data };
      return true;
    };
    const steer = () => {
      if (trip.i >= trip.path.length) return true;
      const [tx, ty] = trip.path[trip.i];
      const dx = (tx + 0.5) * TILE - p.x, dy = (ty + 0.5) * TILE - p.y, d = Math.hypot(dx, dy);
      if (d < 5) {
        trip.i++;
        return trip.i >= trip.path.length;
      }
      p.botMove = { x: dx / d, y: dy / d };
      return false;
    };
    const backHome = () => {
      const h = home();
      trip.phase = 'back';
      trip.path = h ? pathTo(h[0], h[1]) || [] : [];
      trip.i = 0;
    };
    const endTrip = () => { trip = null; p.botMove = null; };
    const planTrip = () => {
      const c = g.cycle;
      if (c.isNight || c.isEvening || c.t < 15 || p.dead) return;
      // 1) Allein und zu wenig Holz für die erste Hütte: selbst Holz holen
      if (!g.settlers.colony.length && !B.count('hut') && !canAfford({ wood: 20, stone: 5 }) && !B.sites.length) {
        const res = g.stock.wood + p.inv.wood < 20 ? 'tree' : 'rock';
        const n = w.nodes.filter((x) => x.type === res && !x.removed && x.amount > 0).sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y))[0];
        const ap = n && w.accessTile(n.tx, n.ty, p.x, p.y);
        if (ap) startTrip('gather', ap[0], ap[1], n);
        return;
      }
      // 2) Freie Betten: nächstes Lager mit Wartenden
      if (g.settlers.freeBeds(g) <= 0) return;
      const waiting = g.settlers.list.filter((s) => s.mode === 'waiting' && s.poi && !s.wander);
      waiting.sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y));
      for (const s of waiting.slice(0, 3)) {
        const ap = w.accessTile(s.tx, s.ty, p.x, p.y) || [s.tx, s.ty + 1];
        if (startTrip('rescue', ap[0], ap[1], s.poi)) return;
      }
    };
    const runTrip = (dt) => {
      trip.t += dt;
      if (p.dead || trip.t > 120 || (g.cycle.isNight && trip.phase === 'go')) {
        if (!p.dead) { p.x = B.center.x; p.y = B.center.y + 30; }
        endTrip();
        return;
      }
      if (trip.phase === 'work') {
        p.botMove = null;
        g.input.keys.add('KeyE');
        if (p.carried >= 12 || trip.data.amount <= 0 || trip.t > trip.workEnd) {
          g.input.keys.delete('KeyE');
          backHome();
        }
        return;
      }
      if (!steer()) return;
      p.botMove = null;
      if (trip.phase === 'back') { endTrip(); return; }
      if (trip.kind === 'gather') {
        trip.phase = 'work';
        trip.workEnd = trip.t + 15;
        p.faceTowards(trip.data.x, trip.data.y);
      } else {
        for (const s of g.settlers.list) if (s.mode === 'waiting' && s.poi === trip.data && g.settlers.freeBeds(g) > 0) g.settlers.recruit(s, g);
        backHome();
      }
    };

    // Bot klinkt sich in die Ereignisse ein
    const origDawn = g.onDawn.bind(g);
    const rows = [];
    let minCenter = 1e9;
    g.onDawn = (day) => {
      rows.push({ night: day - 1, center: Math.round(minCenter), pop: g.settlers.colony.length, rescued: g.stats.rescued || 0, lvl: g.flame.level, vigor: Math.round(g.flame.vigor), huts: B.count('hut'), sites: B.sites.length, towers: B.count('tower'), bolts: g.stock.bolts, walls: B.count('wall'), gates: B.count('gate'), wood: Math.round(g.stock.wood), stone: Math.round(g.stock.stone), food: Math.round(g.stock.food), water: Math.round(g.stock.water), coal: Math.round(g.stock.coal), iron: Math.round(g.stock.iron), bowls: B.count('firebowl'), traps: B.count('trap'), kills: g.stats.kills, lost: g.stats.lost, hunted: g.stats.hunted || 0, camps: g.stats.camps || 0 });
      minCenter = 1e9;
      origDawn(day);
      build();
    };
    build();
    const t0 = performance.now();
    for (let i = 0; i < 31 * 225 * 60 && !g.over; i++) {
      const dt = 1 / 60;
      if (trip) runTrip(dt);
      else {
        if (i % 30 === 0) planTrip();
        if (!trip) g.input.keys.add('Space'); // an der Flamme kämpfen
      }
      if (trip) g.input.keys.delete('Space');
      g.update(dt);
      const c = B.center;
      if (c.hp < minCenter) minCenter = c.hp;
      if (g.cycle.t > 60 && g.cycle.t < 61 && !g.cycle.isNight) build();
      // ohne Ausflug: Spieler zurück zur Flamme, falls abgedrängt
      if (!trip && Math.hypot(p.x - c.x, p.y - c.y) > 40) { p.x = c.x; p.y = c.y + 30; }
    }
    g.input.keys.delete('Space');
    g.input.keys.delete('KeyE');
    return { rows, over: g.over, day: g.cycle.day, ms: Math.round(performance.now() - t0) };
  });
  for (const r of log.rows) console.log(JSON.stringify(r));
  console.log(`Ergebnis: ${log.over || 'läuft'} an Tag ${log.day} (${log.ms} ms)`);
  await page.screenshot({ path: 'tools/out/balance.png' });
}
