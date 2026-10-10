// Szenario Phase 7: alle synthetisierten Klänge abspielen, Atmosphäre/Minikarte prüfen, Nacht-Screenshot.
export const query = 'skiptut'; // alles freigeschaltet (ohne geführten Einstieg)
export default async function (page) {
  const names = ['click', 'error', 'chop', 'mine', 'pick', 'water', 'deposit', 'build', 'demolish', 'swing', 'hit', 'hurt', 'death', 'enemyDie', 'claw', 'smash', 'bolt', 'horn', 'bell', 'alarm', 'collapse', 'arrive', 'victory', 'defeat'];
  const r = await page.evaluate(async (names) => {
    const a = window.__game.audio;
    a.init();
    for (const n of names) { a.last = {}; a.play(n); await new Promise((res) => setTimeout(res, 20)); }
    return { state: a.ctx && a.ctx.state, muted: a.muted };
  }, names);
  console.log('Audio', JSON.stringify(r));
  if (!r.state) throw new Error('Kein AudioContext');
  await page.keyboard.press('KeyM');
  await page.waitForTimeout(100); // Tastenflanken werden im nächsten Frame ausgewertet
  const muted = await page.evaluate(() => window.__game.audio.muted);
  await page.keyboard.press('KeyM');
  await page.waitForTimeout(100);
  if (!muted) throw new Error('Stummschalten per M wirkt nicht');
  await page.evaluate(() => {
    const g = window.__game, w = g.world;
    Object.assign(g.stock, { wood: 300, stone: 300, water: 80, food: 80 });
    for (const n of w.nodes) if (Math.hypot(n.tx - w.cx, n.ty - w.cy) < 7) w.removeNode(n);
    g.buildings.place(g, 'hut', w.cx + 3, w.cy - 4);
    g.buildings.place(g, 'farm', w.cx - 5, w.cy + 2);
    for (let i = -3; i <= 3; i++) g.buildings.place(g, 'wall', w.cx + i, w.cy + 6);
    for (const [dx, dy] of [[-4, 0], [4, 0], [0, -5], [2, 5]]) g.buildings.place(g, 'tower', w.cx + dx, w.cy + dy);
    g.cycle.day = 10; g.cycle.t = 140;
    for (let i = 0; i < 60 * 40; i++) g.update(1 / 60);
    const e = g.enemies.list.find((x) => x.type === 'boss') || g.enemies.list[0];
    if (e) { g.player.x = (e.x + g.buildings.center.x) / 2; g.player.y = (e.y + g.buildings.center.y) / 2; g.camera.snap(g.player.x, g.player.y); }
  });
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'tools/out/polish-night.png' });
}
