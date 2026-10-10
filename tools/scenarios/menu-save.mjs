// Szenario: Hauptmenü, Neues Spiel (geführter Einstieg), Autosave, Fortsetzen nach Neuladen, Game-Over-Bildschirm.
export default async function (page) {
  const url = page.url().replace(/[?&]play/, '');
  await page.goto(url);
  await page.evaluate(() => localStorage.clear()); // der vorige ?play-Tab hat beim Verlassen gespeichert
  // Ein Spielstand einer älteren Version wird beim Start sauber verworfen (mit Hinweis)
  await page.evaluate(() => localStorage.setItem('cinis.save.v3', JSON.stringify({ v: 3, cycle: { day: 4 }, settlers: [] })));
  await page.reload();
  await page.waitForTimeout(800);
  const old = await page.evaluate(() => ({ gone: localStorage.getItem('cinis.save.v3') === null, toast: /älteren Version/.test(document.querySelector('.toasts').innerText), cont: [...document.querySelectorAll('.mbtn')].some((b) => /Fortsetzen/.test(b.innerText)) }));
  console.log('Alter Spielstand', JSON.stringify(old));
  if (!old.gone || !old.toast || old.cont) throw new Error('Alter Spielstand nicht sauber verworfen');
  await page.screenshot({ path: 'tools/out/menu.png' });
  await page.getByRole('button', { name: 'Neues Spiel', exact: true }).click();
  await page.waitForTimeout(500);
  // Beim ersten Spiel läuft das Intro – überspringen
  if ((await page.evaluate(() => window.__game.state)) === 'intro') await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'tools/out/start.png' });
  const st = await page.evaluate(() => window.__game.state);
  if (st !== 'playing') throw new Error('Spiel startet nicht: ' + st);
  // Fortschritt erzeugen und speichern
  const before = await page.evaluate(() => {
    const g = window.__game;
    g.stock.wood = 77;
    g.buildings.add('well', g.world.cx + 3, g.world.cy + 3);
    g.progress.unlock('hud.clock', true); // Uhr laufen lassen
    for (let i = 0; i < 60 * 60; i++) g.update(1 / 60);
    g.pause();
    return { day: g.cycle.day, t: Math.round(g.cycle.t), b: g.buildings.list.length, s: g.settlers.list.filter((x) => !x.wander).length };
  });
  await page.screenshot({ path: 'tools/out/pause.png' });
  await page.getByRole('button', { name: /Speichern/ }).click();
  await page.reload();
  await page.waitForTimeout(600);
  await page.getByRole('button', { name: /Fortsetzen/ }).click();
  const after = await page.evaluate(() => {
    const g = window.__game;
    return { day: g.cycle.day, t: Math.round(g.cycle.t), b: g.buildings.list.length, s: g.settlers.list.filter((x) => !x.wander).length, state: g.state, clock: g.progress.has('hud.clock'), quest: g.progress.quest };
  });
  console.log('vorher', JSON.stringify(before), 'nachher', JSON.stringify(after));
  if (after.b !== before.b || after.s !== before.s || Math.abs(after.t - before.t) > 1 || after.state !== 'playing' || !after.clock) throw new Error('Laden stimmt nicht');
  // Niederlage
  await page.evaluate(() => { const g = window.__game; g.buildings.center.hp = 1; g.cycle.t = 160; g.player.x += 300; g.enemies.spawn('brute', g.buildings.center.x, g.buildings.center.y + 30); });
  await page.waitForTimeout(3500);
  await page.screenshot({ path: 'tools/out/defeat.png' });
  const over = await page.evaluate(() => ({ over: window.__game.over, save: !!localStorage.getItem('cinis.save.v4') }));
  console.log('Ende', JSON.stringify(over));
  if (over.over !== 'defeat' || over.save) throw new Error('Game Over fehlerhaft');
}
