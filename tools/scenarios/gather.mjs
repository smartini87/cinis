// Szenario Phase 2: zum nächsten Baum teleportieren, sammeln, zur Flamme zurück, abliefern.
export const query = 'skiptut'; // alles freigeschaltet (ohne geführten Einstieg)
export default async function (page) {
  const before = await page.evaluate(() => {
    const g = window.__game, p = g.player, w = g.world;
    const tree = w.nodes.filter((n) => n.type === 'tree' && !n.removed).sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y))[0];
    p.x = tree.x + 12; p.y = tree.y + 4;
    return g.stock.wood;
  });
  await page.keyboard.down('Space'); await page.waitForTimeout(2500); await page.keyboard.up('Space');
  const carried = await page.evaluate(() => window.__game.player.inv.wood);
  await page.screenshot({ path: 'tools/out/gather.png' });
  await page.evaluate(() => { const g = window.__game; g.player.x = g.buildings.center.x; g.player.y = g.buildings.center.y + 30; });
  await page.waitForTimeout(400);
  const after = await page.evaluate(() => window.__game.stock.wood);
  console.log(`Holz getragen: ${carried}, Lager vorher ${before}, nachher ${after}`);
  if (!(carried > 0 && after === before + carried)) throw new Error('Sammeln/Abliefern fehlgeschlagen');
}
