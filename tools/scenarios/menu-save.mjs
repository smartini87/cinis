// Szenario Phase 6: Hauptmenü, Tutorial, Autosave, Fortsetzen nach Neuladen, Game-Over-Bildschirm.
export default async function (page) {
  const url = page.url().replace(/[?&]play/, '');
  await page.goto(url);
  await page.evaluate(() => localStorage.clear()); // der vorige ?play-Tab hat beim Verlassen gespeichert
  await page.reload();
  await page.waitForTimeout(800);
  await page.screenshot({ path: 'tools/out/menu.png' });
  await page.getByRole('button', { name: 'Neues Spiel' }).click();
  for (let i = 0; i < 4; i++) await page.getByRole('button', { name: 'Weiter' }).click();
  await page.screenshot({ path: 'tools/out/tutorial.png' });
  await page.getByRole('button', { name: "Los geht's!" }).click();
  const st = await page.evaluate(() => window.__game.state);
  if (st !== 'playing') throw new Error('Spiel startet nicht nach Tutorial: ' + st);
  // Fortschritt erzeugen und speichern
  const before = await page.evaluate(() => {
    const g = window.__game;
    g.stock.wood = 77;
    g.buildings.place(g, 'well', g.world.cx + 3, g.world.cy + 3) || g.buildings.add('well', g.world.cx + 3, g.world.cy + 3);
    for (let i = 0; i < 60 * 60; i++) g.update(1 / 60);
    g.pause();
    return { day: g.cycle.day, t: Math.round(g.cycle.t), b: g.buildings.list.length, s: g.settlers.list.length };
  });
  await page.screenshot({ path: 'tools/out/pause.png' });
  await page.getByRole('button', { name: /Speichern/ }).click();
  await page.reload();
  await page.waitForTimeout(600);
  await page.getByRole('button', { name: /Fortsetzen/ }).click();
  const after = await page.evaluate(() => {
    const g = window.__game;
    return { day: g.cycle.day, t: Math.round(g.cycle.t), b: g.buildings.list.length, s: g.settlers.list.length, state: g.state };
  });
  console.log('vorher', JSON.stringify(before), 'nachher', JSON.stringify(after));
  if (after.b !== before.b || after.s !== before.s || Math.abs(after.t - before.t) > 1 || after.state !== 'playing') throw new Error('Laden stimmt nicht');
  // Niederlage
  await page.evaluate(() => { const g = window.__game; g.buildings.center.hp = 1; g.cycle.t = 160; g.player.x += 300; g.enemies.spawn('brute', g.buildings.center.x, g.buildings.center.y + 30); });
  await page.waitForTimeout(3500);
  await page.screenshot({ path: 'tools/out/defeat.png' });
  const over = await page.evaluate(() => ({ over: window.__game.over, save: !!localStorage.getItem('cinis.save.v1') }));
  console.log('Ende', JSON.stringify(over));
  if (over.over !== 'defeat' || over.save) throw new Error('Game Over fehlerhaft');
}
