// Balancing-Lauf: ein Bot spielt im Schnelldurchlauf (endlos, höchstens 60 Nächte), beginnend mit dem Questpfad.
// Er startet allein, sammelt per Autopilot (A*) Holz und Stein, baut die erste Hütte selbst, rettet Überlebende,
// jagt unterwegs, entfacht die Flamme, wenn der Brennstoff reicht, und verteidigt sich mit Mauern und Toren,
// Fallen, Feuerschalen und einigen Türmen. Nachts kämpft er an der Flamme.
// Ausgabe: Verlauf pro Nacht. Aufruf: node tools/smoke-test.mjs tools/scenarios/balance.mjs
// BOT=towers: Vergleichsstrategie „nur Türme“ (keine Mauern, Fallen, Feuerschalen).
export default async function (page) {
  const mode = process.env.BOT || 'mixed';
  const log = await page.evaluate(async (mode) => {
    const { RECIPES, craft } = await import('/js/recipes.js');
    const g = window.__game, w = g.world, B = g.buildings, p = g.player, TILE = 16;
    const recipe = (id) => RECIPES.find((r) => r.id === id);
    const cx = w.cx, cy = w.cy;
    const towersOnly = mode === 'towers';
    const ring = (r0, r1) => {
      const out = [];
      for (let y = cy - r1; y <= cy + r1; y++) for (let x = cx - r1; x <= cx + r1; x++) {
        const d = Math.max(Math.abs(x - cx), Math.abs(y - cy));
        if (d >= r0 && d <= r1) out.push([x, y]);
      }
      return out.sort((a, b) => Math.hypot(a[0] - cx, a[1] - cy) - Math.hypot(b[0] - cx, b[1] - cy));
    };
    // Straßen (Achsen durch die Flamme) bleiben frei, damit Siedler überall hinkommen
    const size = { hut: 2, farm: 2, storehouse: 2, forge: 2 };
    const offRoad = (type, x, y) => { const s = size[type] || 1; return !(x <= cx && cx < x + s) && !(y <= cy && cy < y + s); };
    // Was offene Baustellen noch brauchen, ist im Lager schon verplant
    const free = (k) => g.stock[k] + p.inv.count(k) - B.sites.reduce((a, b) => a + (b.site.need[k] || 0) - (b.site.got[k] || 0), 0);
    const canAfford = (cost) => Object.entries(cost).every(([k, n]) => free(k) >= n);
    const tryPlace = (type, cands) => {
      if (!g.isAvailable(type)) return null;
      for (const [x, y, rot] of cands) {
        if (type !== 'gate' && !offRoad(type, x, y)) continue;
        if (B.canPlace(type, x, y).ok && canAfford(B.costAt(type, x, y))) return B.place(g, type, x, y, rot ?? null);
      }
      return null;
    };
    const R = 9; // Mauerring
    const wallSpots = ring(R, R).map(([x, y]) => [x, y, Math.abs(x - cx) === R && Math.abs(y - cy) < R ? 1 : 0]);
    const gateSpots = wallSpots.filter(([x, y]) => x === cx || y === cy);
    const towerSpots = towersOnly ? ring(4, 12).filter(([x, y]) => (x + y) % 2 === 0) : ring(6, 7).filter(([x, y]) => (x + y) % 3 === 0);
    const homeSpots = ring(2, 5);
    const fireSpots = ring(7, 7).filter(([x, y]) => (x + y) % 3 === 0);
    const trapSpots = ring(R + 1, R + 2).filter(([x, y]) => Math.abs(x - cx) <= 2 || Math.abs(y - cy) <= 2 || Math.abs(Math.abs(x - cx) - Math.abs(y - cy)) <= 1);

    // Bolzen an der Flamme bzw. Schmiede nachproduzieren
    const ammo = () => {
      const want = 30 + (B.count('tower') + B.count('tower2') * 2) * 10;
      for (let i = 0; i < 20 && g.stock.bolts < want; i++) {
        if (B.count('forge') && canAfford(recipe('boltsIron').cost) && free('wood') > 8) craft(g, recipe('boltsIron'));
        else if (free('wood') > 24 && free('stone') > 12) craft(g, recipe('bolts'));
        else break;
      }
      // Holzkohle, wenn Kohle knapp und Holz reichlich ist
      for (let i = 0; i < 10 && B.count('workbench') && g.stock.coal < 12 + B.count('firebowl') * 2 && free('wood') > 60; i++) craft(g, recipe('charcoal'));
      // Verbände für den Spieler
      if (p.inv.count('bandage') < 2 && canAfford(recipe('bandage').cost)) craft(g, recipe('bandage'));
    };
    // Werkzeug und Ausrüstung
    const gear = () => {
      for (const id of ['axe', 'pick', 'ironSword', 'armor', 'boots']) {
        const r = recipe(id);
        const station = r.station === 'flame' || B.count(r.station) > 0;
        if (station && !p.inv.has(id) && canAfford(r.cost)) craft(g, r);
      }
    };
    // Flamme: entfachen, wenn danach Brennstoff für 2 Nächte da ist; bei niedriger Glut nachlegen
    const flame = () => {
      const f = g.flame;
      if (f.next && f.canUpgrade(g)) {
        const after = { ...g.stock };
        for (const [k, n] of Object.entries(f.next.cost)) after[k] -= n;
        if (Object.entries(f.next.fuel).every(([k, n]) => (after[k] || 0) >= n * 2)) f.upgrade(g);
      }
      if (f.vigor < 75 && f.fuelCovered(g.stock, 2)) f.feed(g);
      // Kräuteröl für die höchsten Stufen
      if (f.level >= 6 && g.stock.oil < 6 && canAfford(recipe('oil').cost)) craft(g, recipe('oil'));
    };
    const build = () => {
      flame();
      ammo();
      gear();
      const pop = g.settlers.colony.length;
      // Baustellen, die seit mehr als einem Tag stocken (z. B. unerreichbar), wieder abreißen
      for (const b of B.sites) if (g.time - (b.site.since || 0) > 225) B.demolish(g, b);
      const huts = () => B.countAll('hut');
      while (huts() * 4 < Math.min(pop + 3, g.flame.popCap) && huts() < 10 && tryPlace('hut', homeSpots.concat(ring(5, 8)))) {}
      // Ohne Siedler liefert der Spieler selbst (wie E an der Baustelle)
      if (!pop) for (const b of B.sites) B.playerDeliver(g, b);
      if (!pop) return;
      if (B.countAll('wall') && !towersOnly) while (free('stone') > 6 && tryPlace('gate', gateSpots)) {}
      while (B.countAll('farm') < Math.max(1, Math.ceil(pop / 5)) && tryPlace('farm', ring(3, 8))) {}
      while (B.countAll('well') < Math.max(1, Math.ceil(pop / 6)) && tryPlace('well', ring(3, 8))) {}
      if (B.sites.length > 4) return; // erst die offenen Baustellen fertig werden lassen
      tryPlace('workbench', B.countAll('workbench') ? [] : ring(3, 6));
      if (!B.countAll('storehouse')) tryPlace('storehouse', ring(6, 8));
      if (!B.countAll('forge')) tryPlace('forge', ring(4, 8));
      const maxTowers = towersOnly ? 200 : 4 + g.flame.level;
      while (B.countAll('tower') + B.countAll('tower2') < maxTowers && free('wood') > 40 && free('stone') > 30 && tryPlace('tower', towerSpots)) {}
      if (towersOnly) return;
      while (free('stone') > 20 && tryPlace('gate', gateSpots)) {}
      while (free('stone') > 16 && tryPlace('wall', wallSpots)) {}
      while (B.countAll('firebowl') < 4 + g.flame.level && free('coal') > 6 && tryPlace('firebowl', fireSpots)) {}
      while (B.countAll('trap') < 8 + g.flame.level * 2 && free('iron') > 2 && tryPlace('trap', trapSpots)) {}
      for (const t of B.ofType('tower').slice(0, 4)) if (g.isAvailable('tower2') && free('iron') > 8 && canAfford(B.costAt('tower2', t.tx, t.ty))) B.place(g, 'tower2', t.tx, t.ty);
    };

    // ---------------------------------------------------------------- Autopilot-Ausflüge
    let trip = null;
    const pathTo = (tx, ty) => w.findPath(p.tx, p.ty, tx, ty, 9000);
    const home = () => B.accessPoint(B.center, p.x, p.y);
    const startTrip = (kind, tx, ty, data) => {
      const path = pathTo(tx, ty);
      if (!path) return false;
      trip = { kind, phase: 'go', path, i: 0, t: 0, data, lastX: p.x, lastY: p.y, stillT: 0 };
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
    const endTrip = () => { trip = null; p.botMove = null; g.input.keys.delete('KeyE'); };
    const goHome = () => { p.x = B.center.x; p.y = B.center.y + 30; p.vx = p.vy = 0; endTrip(); };
    const gatherTrip = (type) => {
      const n = w.nodes.filter((x) => x.type === type && !x.removed && x.amount > 0).sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y))[0];
      const ap = n && w.accessTile(n.tx, n.ty, p.x, p.y);
      return ap ? startTrip('gather', ap[0], ap[1], n) : false;
    };
    const planTrip = () => {
      const c = g.cycle, q = g.progress.step;
      if (c.isNight || c.isEvening || p.dead) return;
      // Questpfad: Holz und Stein selbst holen
      if (q && q.id === 'wood') return gatherTrip('tree');
      if (q && q.id === 'stone') return gatherTrip('rock');
      // Allein und zu wenig Material für die erste Hütte: selbst sammeln
      if (!g.settlers.colony.length && !B.countAll('hut') && !canAfford({ wood: 20, stone: 5 })) return gatherTrip(free('wood') < 20 ? 'tree' : 'rock');
      // Händler mit Bauplan: hingehen und kaufen
      const tr = g.pois.trader;
      if (!towersOnly && tr && tr.offers.some((o) => o.blueprint && !o.sold && canAfford(o.cost))) {
        const ap = w.accessTile(Math.floor(tr.x / TILE), Math.floor(tr.y / TILE), p.x, p.y);
        if (ap && startTrip('trade', ap[0], ap[1], tr)) return;
      }
      // Ein leichtes Feindlager räumen (Bauplan), sobald die Siedlung steht und es Tag ist
      if (!towersOnly && g.settlers.colony.length >= 6 && c.t < 90 && p.hp > 80) {
        const camp = g.pois.list.filter((o) => o.type === 'enemyCamp' && o.state === 'active' && o.ring <= 1).sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y))[0];
        const ap = camp && w.accessTile(camp.tx, camp.ty + 2, p.x, p.y);
        if (ap && startTrip('raid', ap[0], ap[1], camp)) return;
      }
      // Freie Betten: nächstes Lager mit Wartenden
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
      // Hängenbleiben (z. B. von Wölfen umzingelt): nach 10 s ohne Fortschritt zurück zur Flamme
      trip.stillT += dt;
      if (Math.hypot(p.x - trip.lastX, p.y - trip.lastY) > 8) { trip.stillT = 0; trip.lastX = p.x; trip.lastY = p.y; }
      if (p.dead || trip.t > 120 || (g.cycle.isNight && trip.phase === 'go') || (trip.stillT > 10 && trip.phase !== 'work' && trip.phase !== 'fight')) {
        if (!p.dead) goHome();
        else endTrip();
        return;
      }
      // Unterwegs jagen: Beutetiere in Reichweite angreifen
      if (!p.atk && p.actionT <= 0) {
        const prey = g.wildlife.list.find((a) => !a.dead && (a.def.cls === 'game' || a.def.cls === 'hostile' || a.aggroT > 0) && Math.hypot(a.x - p.x, a.y - p.y) < 24);
        if (prey) { p.faceTowards(prey.x, prey.y); p.startAttack(g); }
      }
      if (trip.phase === 'fight') {
        // Feindlager: Wächter angreifen, bis keiner mehr steht; dann Truhe öffnen
        const camp = trip.data;
        const foe = g.enemies.list.filter((e) => !e.dead && e.guard && e.guard.poi === camp.id).sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y))[0];
        if (!foe || trip.t > trip.fightEnd || p.hp < 30) {
          g.input.keys.delete('Space');
          if (!foe && camp.chest && !camp.chest.opened) g.pois.openChest(g, camp);
          backHome();
          return;
        }
        const d = Math.hypot(foe.x - p.x, foe.y - p.y);
        p.botMove = d > 16 ? { x: (foe.x - p.x) / d, y: (foe.y - p.y) / d } : null;
        g.input.keys.add('Space');
        if (p.hp < 50 && p.inv.has('bandage')) p.useBandage(g);
        return;
      }
      if (trip.phase === 'work') {
        // nah genug heran, dann E halten
        const n = trip.data, d = Math.hypot(n.x - p.x, n.y - p.y);
        p.botMove = d > 17 ? { x: (n.x - p.x) / d, y: (n.y - p.y) / d } : null;
        p.faceTowards(n.x, n.y);
        g.input.keys.add('KeyE');
        if (p.inv.room(trip.data.type === 'tree' ? 'wood' : 'stone') <= 0 || trip.data.amount <= 0 || trip.t > trip.workEnd || p.carried >= 14) {
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
      } else if (trip.kind === 'raid') {
        trip.phase = 'fight';
        trip.fightEnd = trip.t + 50;
      } else if (trip.kind === 'trade') {
        for (const o of trip.data.offers) if (o.blueprint && !o.sold && canAfford(o.cost)) g.pois.trade(g, trip.data, o);
        backHome();
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
      rows.push({
        night: day - 1, center: Math.round(minCenter), lvl: g.flame.level, vigor: Math.round(g.flame.vigor), quest: g.progress.done ? '-' : g.progress.step && g.progress.step.id,
        pop: g.settlers.colony.length, rescued: g.stats.rescued || 0, huts: B.count('hut'), towers: B.count('tower') + B.count('tower2'), walls: B.count('wall'), gates: B.count('gate'),
        traps: B.count('trap'), bowls: B.count('firebowl'), bolts: Math.round(g.stock.bolts), wood: Math.round(g.stock.wood), stone: Math.round(g.stock.stone),
        food: Math.round(g.stock.food), coal: Math.round(g.stock.coal), iron: Math.round(g.stock.iron), kills: g.stats.kills, lost: g.stats.lost, hunted: g.stats.hunted || 0, foes: g.enemies.plan ? g.enemies.plan.total : 0, bps: [...g.progress.blueprints].join('+'),
      });
      minCenter = 1e9;
      origDawn(day);
      build();
    };
    build();
    const t0 = performance.now();
    let questDoneAt = -1;
    const limit = 60 * 225 * 60;
    for (let i = 0; i < limit && !g.over && !(i > 3 * 225 * 60 && !g.progress.clockRunning); i++) {
      const dt = 1 / 60;
      if (g.state !== 'playing') g.setState('playing'); // Panels/Menüs gibt es für den Bot nicht
      if (trip) runTrip(dt);
      else {
        if (i % 30 === 0) planTrip();
        if (!trip) g.input.keys.add('Space'); // an der Flamme kämpfen
      }
      if (trip) g.input.keys.delete('Space');
      // Verband bei niedrigen LP
      if (p.hp < 45 && p.inv.has('bandage')) p.useBandage(g);
      g.update(dt);
      const c = B.center;
      if (c.hp < minCenter) minCenter = c.hp;
      if (i % 600 === 0) build();
      if (questDoneAt < 0 && g.progress.done) questDoneAt = g.cycle.day;
      // ohne Ausflug: Spieler zurück zur Flamme, falls abgedrängt
      if (!trip && !p.dead && Math.hypot(p.x - c.x, p.y - c.y) > 40) { p.x = c.x; p.y = c.y + 30; }
    }
    g.input.keys.delete('Space');
    g.input.keys.delete('KeyE');
    return { rows, over: g.over, reason: g.overReason, day: g.cycle.day, nights: Math.max(0, g.cycle.day - 1), questDoneAt, quest: g.progress.step && g.progress.step.id, questState: JSON.stringify(g.progress.state), pop: g.settlers.colony.length, huts: B.countAll('hut'), sites: B.sites.length, stock: JSON.stringify({ w: g.stock.wood, s: g.stock.stone }), ms: Math.round(performance.now() - t0) };
  }, mode);
  for (const r of log.rows) console.log(JSON.stringify(r));
  if (log.questDoneAt < 0) console.log('Questpfad hängt bei', log.quest, log.questState, 'Kolonie', log.pop, 'Hütten', log.huts, 'Baustellen', log.sites, log.stock);
  console.log(`Strategie ${mode}: ${log.over ? `Game Over (${log.reason})` : 'läuft'} nach ${log.nights} Nächten · Questpfad fertig an Tag ${log.questDoneAt} (${log.ms} ms)`);
  await page.screenshot({ path: 'tools/out/balance.png' });
}
