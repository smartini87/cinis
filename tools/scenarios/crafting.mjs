// Szenario Inventar & Herstellung: Kisten liefern neue Rohstoffe, Werkbank bauen und per E öffnen, Werkzeug
// herstellen (Sammelbonus), volles Gepäck, Verband (Q), Fackel (T, Licht), Türme verbrauchen Bolzen, Händler.
export const query = 'skiptut';
export default async function (page) {
  const r = await page.evaluate(() => {
    const g = window.__game, w = g.world, B = g.buildings, p = g.player, out = {};
    const sim = (sec) => { for (let i = 0; i < sec * 60; i++) g.update(1 / 60); };
    const clearWild = () => { g.wildlife.clear(); for (const e of g.enemies.list) if (!e.guard) e.dead = true; };
    // 1) Kisten: neue Rohstoffe
    const got = {};
    for (const o of g.pois.list) for (const c of o.crates) {
      p.inv.clear();
      g.pois.openCrate(g, o, c);
      for (const s of p.inv.slots) if (s) got[s.id] = (got[s.id] || 0) + s.n;
      for (const e of g.enemies.list) if (e.guard && e.guard.poi === o.id) e.dead = true;
    }
    out.crateRes = Object.keys(got).sort().join(',');
    p.inv.clear();
    g.loot.clear();
    // 2) Werkbank bauen und mit E öffnen
    for (const n of w.nodes) if (Math.hypot(n.tx - w.cx, n.ty - w.cy) < 8) w.removeNode(n);
    Object.assign(g.stock, { wood: 200, stone: 200, iron: 10, cloth: 10, herbs: 10, resin: 5, hide: 10, coal: 10 });
    g.flame.level = 2; // Werkbank ab Flammenstufe 2
    const wb = B.place(g, 'workbench', w.cx + 4, w.cy + 4);
    B.finishAllSites(g);
    p.x = wb.x; p.y = wb.y + 18; p.vx = p.vy = 0;
    clearWild();
    sim(0.2);
    g.input.keys.add('KeyE');
    sim(0.1);
    g.input.keys.delete('KeyE');
    out.panel = g.panel;
    out.paused = g.state;
    out.rows = document.querySelectorAll('.craft-row').length;
    // Axt per Knopf herstellen
    const btn = [...document.querySelectorAll('.craft-row')].find((r) => /Axt/.test(r.innerText))?.querySelector('button');
    btn?.click();
    out.axe = p.inv.has('axe');
    g.closePanel();
    out.closed = g.state;
    // Leertaste öffnet die Werkbank nicht (nur E)
    g.input.keys.add('Space');
    sim(0.3);
    g.input.keys.delete('Space');
    out.spaceNoPanel = !g.panel;
    // 3) Werkzeugbonus: Baum fällen mit Axt
    const tree = w.nodes.filter((n) => n.type === 'tree' && !n.removed && n.amount > 0).sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y))[0];
    p.x = tree.x; p.y = tree.y + 12; p.vx = p.vy = 0;
    clearWild();
    g.input.keys.add('KeyE');
    sim(0.2);
    out.gatherDur = Math.round(p.gatherDur * 100) / 100;
    g.input.keys.delete('KeyE');
    sim(0.1);
    // 4) Volles Gepäck: kein Platz mehr für Holz
    p.inv.clear();
    const fill = ['axe', 'bandage', 'torch', 'stone', 'food', 'water', 'hide', 'iron', 'cloth', 'coal', 'herbs', 'resin', 'bolts', 'oil', 'armor', 'boots'];
    for (const id of fill) p.inv.add(id, 1);
    out.full = p.inv.full && p.inv.room('wood') === 0;
    out.leftover = p.inv.add('wood', 3);
    // 5) Verband (Q) und Fackel (T)
    p.inv.clear();
    p.inv.add('bandage', 2);
    p.inv.add('torch', 1);
    p.hp = 40;
    p.useBandage(g);
    out.healed = p.hp;
    g.cycle.t = 165; g.enemies.queue = [];
    p.x = g.buildings.center.x + 30 * 16; p.y = g.buildings.center.y;
    const dark = g.lightAt(p.x, p.y);
    p.toggleTorch(g);
    out.torchLight = Math.round((g.lightAt(p.x, p.y) - dark) * 100) / 100;
    out.torchUsed = !p.inv.has('torch') && p.torchOn;
    p.toggleTorch(g);
    // 6) Türme verbrauchen Bolzen; ohne Bolzen schießen sie nicht
    p.x = g.buildings.center.x; p.y = g.buildings.center.y + 30;
    const tw = B.place(g, 'tower', w.cx - 4, w.cy + 4);
    B.finishAllSites(g);
    g.stock.bolts = 5;
    const foe = g.enemies.spawn('brute', tw.x + 40, tw.y);
    foe.speed = 0; foe.hp = foe.maxHp = 1e5;
    sim(3);
    out.boltsAfter = g.stock.bolts;
    sim(4.5);
    out.noAmmo = tw.noAmmo && g.stock.bolts === 0;
    foe.dead = true;
    g.cycle.t = 60;
    sim(0.1);
    // 7) Händler
    p.inv.clear();
    g.pois.spawnTrader(g);
    const tr = g.pois.trader;
    const offer = tr.offers.find((o) => !o.blueprint);
    Object.assign(g.stock, { food: 100, hide: 50, wood: 100, stone: 100, iron: 10 });
    g.pois.trade(g, tr, offer);
    out.traded = offer.sold && p.inv.count(offer.give) === offer.n;
    // Inventar-Fenster per I
    g.progress.unlock('hud.inventory', true);
    return out;
  });
  await page.keyboard.press('KeyI');
  await page.waitForTimeout(200);
  const inv = await page.evaluate(() => ({ panel: window.__game.panel, slots: document.querySelectorAll('.inv-slot').length }));
  await page.screenshot({ path: 'tools/out/inventory.png' });
  await page.keyboard.press('KeyI');
  await page.waitForTimeout(150);
  r.invPanel = inv.panel;
  r.invSlots = inv.slots;
  r.afterClose = await page.evaluate(() => window.__game.state);
  console.log(JSON.stringify(r));
  for (const k of ['cloth', 'iron', 'coal']) if (!r.crateRes.includes(k)) throw new Error('Kisten ohne ' + k);
  if (r.panel !== 'crafting' || r.paused !== 'paused' || r.rows < 5) throw new Error('Werkbank öffnet nicht');
  if (!r.axe) throw new Error('Axt nicht hergestellt');
  if (r.closed !== 'playing' || !r.spaceNoPanel) throw new Error('Panel-Steuerung fehlerhaft');
  if (!(r.gatherDur < 0.4)) throw new Error('Kein Werkzeugbonus: ' + r.gatherDur);
  if (!r.full || r.leftover !== 3) throw new Error('Volles Gepäck nicht erkannt');
  if (r.healed !== 80) throw new Error('Verband heilt nicht');
  if (!(r.torchLight > 0.5) || !r.torchUsed) throw new Error('Fackel leuchtet nicht');
  if (!(r.boltsAfter < 5) || !r.noAmmo) throw new Error('Turmmunition wird nicht verbraucht');
  if (!r.traded) throw new Error('Handel fehlgeschlagen');
  if (r.invPanel !== 'inventory' || r.invSlots !== 16 || r.afterClose !== 'playing') throw new Error('Inventar-Fenster fehlerhaft');
}
