// Szenario POIs: alle Ortstypen vorhanden (mehrere Seeds), Entdecken bei Annäherung, Siedler nur mit freier Hütte,
// Feindlager besiegen → Truhe mit Bauplan, Kiste, Hinterhalt am Wagen, Schrein-Segen, Signalfeuer, Speichern/Laden.
export const query = 'skiptut';
export default async function (page) {
  const r = await page.evaluate(async () => {
    const g = window.__game, P = g.pois, p = g.player, TILE = 16, out = {};
    const sim = (sec) => { for (let i = 0; i < sec * 60; i++) g.update(1 / 60); };
    const types = (list) => [...new Set(list.map((o) => o.type))].sort().join(',');
    out.types = types(P.list);
    out.count = P.list.length;
    out.waiting = g.settlers.list.filter((s) => s.mode === 'waiting').length;
    // Weitere Seeds: Generierung findet für alle Typen Platz
    const { World } = await import('/js/world.js');
    const { Pois } = await import('/js/pois.js');
    out.otherSeeds = [];
    for (const seed of [1, 99, 123456]) {
      const fake = { world: new World(seed), settlers: { spawn: () => ({}) }, enemies: { spawn: () => ({}), makeElite() {} } };
      const pp = new Pois();
      pp.generate(fake, false);
      out.otherSeeds.push(types(pp.list) + ':' + pp.list.length);
    }
    const near = (o, dx = 0, dy = 2.5) => { p.x = o.x + dx * TILE; p.y = o.y + dy * TILE; p.vx = p.vy = 0; g.camera.snap(p.x, p.y); };
    const pressE = (frames = 30) => { g.wildlife.clear(); g.input.keys.add('KeyE'); for (let i = 0; i < frames; i++) g.update(1 / 60); g.input.keys.delete('KeyE'); for (let i = 0; i < 4; i++) g.update(1 / 60); };
    // 1) Entdecken
    const camp = P.list.find((o) => o.type === 'camp' && !o.discovered);
    near(camp, 0, 3);
    sim(0.5);
    out.discovered = camp.discovered;
    // 2) Siedler ohne Hütte: Hinweis statt Mitnahme
    const s = g.settlers.list.find((x) => x.poi === camp);
    near({ x: s.x, y: s.y }, 0.9, 0);
    pressE();
    out.noHutStays = s.mode === 'waiting';
    out.noHutToast = /Hütte/.test(document.querySelector('.toasts').innerText);
    // Hütte bauen, dann klappt es
    Object.assign(g.stock, { wood: 200, stone: 200 });
    const w = g.world;
    let built = null;
    for (let d = 3; d < 9 && !built; d++) for (const [dx, dy] of [[d, 0], [-d, 0], [0, d], [0, -d]]) if (!built && g.buildings.canPlace('hut', w.cx + dx, w.cy + dy).ok) built = g.buildings.place(g, 'hut', w.cx + dx, w.cy + dy);
    near({ x: s.x, y: s.y }, 0.9, 0);
    pressE();
    out.follows = s.mode === 'follow';
    // 3) Feindlager: Wächter besiegen → Truhe mit Bauplan
    const ec = P.list.find((o) => o.type === 'enemyCamp');
    near(ec, 0, 5);
    sim(0.3);
    const guards = g.enemies.list.filter((e) => e.guard && e.guard.poi === ec.id);
    out.guards = guards.length;
    out.elite = guards.some((e) => e.elite);
    for (const e of guards) { e.hp = 1; g.hitUnit(e, 10, 0, 0); }
    sim(0.5);
    out.cleared = ec.state;
    near(ec.chest, 0, 1);
    const inv0 = p.carried;
    pressE();
    out.chestOpened = ec.chest.opened;
    out.loot = p.carried - inv0;
    out.blueprints = [...g.progress.blueprints].join(',');
    // 4) Wagen: Kiste öffnen löst Hinterhalt aus
    p.inv.wood = p.inv.stone = p.inv.food = p.inv.hide = 0;
    const wr = P.list.find((o) => o.type === 'wreck');
    const before = g.enemies.list.length;
    near(wr.crates[0], 0.8, 0);
    pressE();
    out.crateOpened = wr.crates[0].opened;
    out.ambush = g.enemies.list.length - before;
    for (const e of g.enemies.list) if (e.guard && e.guard.poi === wr.id) e.dead = true;
    // 5) Schrein: Heilung + Segen, nur einmal am Tag
    const sh = P.list.find((o) => o.type === 'shrine');
    p.hp = 30;
    near(sh, 0, 1.2);
    pressE();
    out.healed = p.hp === p.maxHp;
    out.buff = p.buffs.speed > 0 || p.buffs.regen > 0;
    // 6) Signalfeuer: deckt die Karte auf
    const wt = P.list.find((o) => o.type === 'watchtower');
    const ex0 = g.world.explored.reduce((a, b) => a + b, 0);
    near(wt, 0, 1.2);
    pressE();
    out.towerLit = wt.lit;
    out.revealed = g.world.explored.reduce((a, b) => a + b, 0) - ex0;
    sim(0.5);
    // 7) Minikarte/Randpfeile: entdeckte Orte
    out.discoveredCount = P.list.filter((o) => o.discovered).length;
    p.x = g.buildings.center.x; p.y = g.buildings.center.y + 30; g.camera.snap(p.x, p.y);
    sim(0.2);
    return out;
  });
  console.log(JSON.stringify(r));
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'tools/out/pois.png' });
  const all = 'camp,enemyCamp,shrine,vault,watchtower,wreck';
  if (r.types !== all) throw new Error('Nicht alle Ortstypen: ' + r.types);
  for (const t of r.otherSeeds) if (!t.startsWith(all)) throw new Error('Anderer Seed ohne alle Ortstypen: ' + t);
  if (!r.discovered) throw new Error('Ort wird nicht entdeckt');
  if (!r.noHutStays || !r.noHutToast) throw new Error('Siedler ohne Hütte mitgenommen / kein Hinweis');
  if (!r.follows) throw new Error('Siedler folgt nicht trotz Hütte');
  if (r.guards < 3 || r.cleared !== 'cleared' || !r.chestOpened || r.loot <= 0 || !r.blueprints) throw new Error('Feindlager-Belohnung fehlerhaft');
  if (!r.crateOpened || r.ambush < 2) throw new Error('Wagen/Hinterhalt fehlerhaft');
  if (!r.healed || !r.buff) throw new Error('Schrein wirkt nicht');
  if (!r.towerLit || r.revealed < 100) throw new Error('Signalfeuer wirkt nicht');
  // Speichern und Laden: Zustände bleiben
  const saved = await page.evaluate(async () => {
    const { saveGame, loadGame } = await import('/js/save.js');
    const g = window.__game;
    const snap = () => ({ pois: JSON.stringify(g.pois.serialize()), ex: g.world.explored.reduce((a, b) => a + b, 0), bp: [...g.progress.blueprints].join(','), guards: g.enemies.list.filter((e) => e.guard && !e.dead).length, waiting: g.settlers.list.filter((s) => s.mode && !s.wander).length });
    const a = snap();
    saveGame(g);
    loadGame(g);
    const b = snap();
    const pa = JSON.parse(a.pois), pb = JSON.parse(b.pois);
    const diff = pa.map((o, i) => JSON.stringify(o) === JSON.stringify(pb[i]) ? null : [JSON.stringify(o), JSON.stringify(pb[i])]).filter(Boolean);
    return { same: a.pois === b.pois && a.ex === b.ex && a.bp === b.bp && a.waiting === b.waiting, a: { ...a, pois: undefined }, b: { ...b, pois: undefined }, diff: diff.slice(0, 2), len: [pa.length, pb.length] };
  });
  console.log('Speichern/Laden', saved.same, JSON.stringify({ a: saved.a, b: saved.b, diff: saved.diff, len: saved.len }));
  if (!saved.same) throw new Error('POI-Zustand nach dem Laden verändert');
}
