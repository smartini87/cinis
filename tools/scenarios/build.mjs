// Szenario Phase 3: Gebäude per Tastatur wählen und per Mausklick platzieren.
export const query = 'skiptut'; // alles freigeschaltet (ohne geführten Einstieg)
export default async function (page) {
  await page.evaluate(() => { const g = window.__game; Object.assign(g.stock, { wood: 200, stone: 200, water: 50 });
    for (const n of g.world.nodes) if (Math.hypot(n.tx - g.world.cx, n.ty - g.world.cy) < 8) g.world.removeNode(n); });
  const place = async (key, dx, dy) => {
    await page.keyboard.press(key);
    const pos = await page.evaluate(([dx, dy]) => {
      const g = window.__game, c = g.buildings.center;
      const s = g.camera.worldToScreen(c.x + dx * 16, c.y + dy * 16);
      const r = g.canvas.getBoundingClientRect();
      return { x: s.x * r.width / g.canvas.width, y: s.y * r.height / g.canvas.height };
    }, [dx, dy]);
    await page.mouse.move(pos.x, pos.y);
    await page.waitForTimeout(50);
    await page.mouse.down(); await page.mouse.up();
    await page.waitForTimeout(80);
    console.log(key, await page.evaluate(() => document.querySelector('.toasts').innerText.replace(/\n/g, ' | ') + ' #' + window.__game.buildings.list.length + ' ' + window.__game.buildings.selected));
    await page.keyboard.press('Escape');
  };
  await place('Digit1', 4, -3);   // Siedlung: Hütte
  await place('Digit2', -5, 3);   // Farm
  await place('Digit3', 3, 3);    // Brunnen
  await page.keyboard.press('KeyB'); // Kategorie „Wehr“
  await page.waitForTimeout(80);
  await place('Digit1', -3, -4);  // Mauer
  await place('Digit3', 0, -5);   // Turm
  await page.keyboard.press('KeyB'); // weiter zu „Handwerk“ (ab Stufe 2), sonst zurück zu „Siedlung“
  await page.waitForTimeout(80);
  const cat = await page.evaluate(() => window.__game.buildCat);
  if (cat === 0) await page.keyboard.press('Digit1');
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'tools/out/build.png' });
  await page.keyboard.press('Escape');
  const types = await page.evaluate(() => window.__game.buildings.list.map((b) => b.type).sort().join(','));
  console.log('Gebäude:', types);
  if (types !== 'center,farm,hut,tower,wall,well') throw new Error('Nicht alle Gebäude platziert');
}
