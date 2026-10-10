// Szenario Phase 4: Siedler arbeiten selbstständig, Farm wird bewirtschaftet, Bedürfnisse werden gestillt.
export const query = 'skiptut'; // alles freigeschaltet (ohne geführten Einstieg)
export default async function (page) {
  await page.evaluate(() => {
    const g = window.__game, c = g.world;
    Object.assign(g.stock, { wood: 200, stone: 200, water: 60, food: 60 });
    for (const n of c.nodes) if (Math.hypot(n.tx - c.cx, n.ty - c.cy) < 6) c.removeNode(n);
    g.buildings.place(g, 'farm', c.cx + 3, c.cy + 2);
    g.buildings.place(g, 'hut', c.cx - 5, c.cy + 2);
    g.settlers.list[0].hunger = 20; // muss essen gehen
  });
  // Simulation beschleunigen: 90 s Spielzeit in Schritten
  await page.evaluate(() => { const g = window.__game; for (let i = 0; i < 90 * 60; i++) g.update(1 / 60); });
  const r = await page.evaluate(() => {
    const g = window.__game;
    return { pop: g.settlers.list.length, stock: g.stock, jobs: g.settlers.list.map((s) => (s.job || '-') + ':' + (s.task && s.task.type)), hunger: g.settlers.list.map((s) => Math.round(s.hunger)), farm: g.buildings.ofType('farm')[0].growth.toFixed(2) };
  });
  console.log(JSON.stringify(r));
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'tools/out/settlers.png' });
  if (r.pop < 3) throw new Error('Siedler verloren');
  if (!r.jobs.some((j) => j.startsWith('farm'))) throw new Error('Kein Farmer zugewiesen');
  if (Math.min(...r.hunger) < 30) throw new Error('Siedler essen nicht');
}
