// Szenario Phase 5: Verteidigung bauen, bis in die Nacht springen, Kampf beobachten, Morgen erreichen.
export const query = 'skiptut'; // alles freigeschaltet (ohne geführten Einstieg)
export default async function (page) {
  await page.evaluate(() => {
    const g = window.__game, w = g.world;
    Object.assign(g.stock, { wood: 300, stone: 300, water: 80, food: 80 });
    for (const n of w.nodes) if (Math.hypot(n.tx - w.cx, n.ty - w.cy) < 7) w.removeNode(n);
    g.buildings.place(g, 'hut', w.cx + 3, w.cy - 4);
    for (let i = 0; i < 3; i++) g.settlers.spawn(g.buildings.center.x - 16 + i * 16, g.buildings.center.y + 30);
    for (const [dx, dy] of [[-4, 0], [4, 0], [0, -5], [0, 5]]) g.buildings.place(g, 'tower', w.cx + dx, w.cy + dy);
    g.buildings.finishAllSites(g);
    g.cycle.t = 125; // kurz vor der Dämmerung
  });
  const sim = (sec) => page.evaluate((s) => { const g = window.__game; for (let i = 0; i < s * 60 && !g.over; i++) g.update(1 / 60); }, sec);
  await sim(30); // Dämmerung + Nachtbeginn
  const atNight = await page.evaluate(() => ({ night: window.__game.cycle.isNight, hidden: window.__game.settlers.list.filter((s) => s.hidden).length, pop: window.__game.settlers.colony.length }));
  console.log('Nachtbeginn', JSON.stringify(atNight));
  await sim(20);
  // Kamera zum Gegner für den Screenshot
  await page.evaluate(() => { const g = window.__game, e = g.enemies.list[0]; if (e) { g.player.x = e.x + 30; g.player.y = e.y; g.camera.snap(g.player.x, g.player.y); } });
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'tools/out/night.png' });
  const mid = await page.evaluate(() => ({ enemies: window.__game.enemies.list.length, kills: window.__game.stats.kills, center: Math.round(window.__game.buildings.center.hp) }));
  console.log('Nachtmitte', JSON.stringify(mid));
  await sim(70);
  const r = await page.evaluate(() => ({ day: window.__game.cycle.day, enemies: window.__game.enemies.list.length, over: window.__game.over, center: Math.round(window.__game.buildings.center.hp), hidden: window.__game.settlers.list.filter((s) => s.hidden).length, pop: window.__game.settlers.colony.length }));
  console.log('Morgen', JSON.stringify(r));
  if (!atNight.night || atNight.hidden < 1) throw new Error('Nacht/Schutz funktioniert nicht');
  if (r.day !== 2 || r.over) throw new Error('Erste Nacht nicht überstanden');
}
