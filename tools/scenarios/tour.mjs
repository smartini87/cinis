// Rundgang für den Spielgefühl-Check: Screenshots von Hauptmenü, Intro, den ersten Spielminuten (Questpfad),
// Nacht 1, Nacht 5, einem Aschgänger-Lager und einem Mauerring mit Tor (tools/out/tour-*.png).
export const noWalk = true;
export default async function (page) {
  const shot = (name) => page.screenshot({ path: `tools/out/tour-${name}.png` });
  const sim = (sec) => page.evaluate((s) => { const g = window.__game; for (let i = 0; i < s * 60 && !g.over; i++) g.update(1 / 60); }, sec);
  // Hauptmenü (ohne ?play) mit frischem Speicher
  await page.goto(page.url().replace(/[?&]play/, ''));
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForTimeout(900);
  await shot('01-menu');
  // Intro: Text und Kamerafahrt
  await page.getByRole('button', { name: 'Neues Spiel', exact: true }).click();
  await page.waitForTimeout(4500);
  await shot('02-intro-text');
  await page.waitForFunction(() => window.__game.intro.phase === 'flight', null, { timeout: 20000 });
  await page.waitForTimeout(3000);
  await shot('03-intro-flight');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(600);
  await shot('04-start');
  // Erste Minuten: Questpfad (Holz, Stein, Abliefern, Hütte, Überlebende, Farm)
  await page.evaluate(() => {
    const g = window.__game, p = g.player, w = g.world;
    const near = (type) => w.nodes.filter((n) => n.type === type && !n.removed && n.amount > 0).sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y))[0];
    const n = near('tree');
    p.x = n.x; p.y = n.y + 14;
    g.input.keys.add('KeyD'); for (let i = 0; i < 90; i++) g.update(1 / 60); g.input.keys.delete('KeyD');
    p.x = n.x; p.y = n.y + 14;
    g.input.keys.add('KeyE'); for (let i = 0; i < 160; i++) g.update(1 / 60);
  });
  await page.waitForTimeout(300);
  await shot('05-gather');
  await page.evaluate(() => {
    const g = window.__game, p = g.player, w = g.world;
    const sim = (sec, until) => { for (let i = 0; i < sec * 60; i++) { g.update(1 / 60); if (until && until()) break; } };
    const near = (type) => w.nodes.filter((n) => n.type === type && !n.removed && n.amount > 0).sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y))[0];
    for (let k = 0; k < 4 && g.progress.quest < 2; k++) { const n = near('tree'); p.x = n.x; p.y = n.y + 14; sim(10, () => g.progress.quest >= 2 || n.amount <= 0); }
    for (let k = 0; k < 4 && g.progress.quest < 3; k++) { const n = near('rock'); p.x = n.x; p.y = n.y + 14; sim(10, () => g.progress.quest >= 3 || n.removed); }
    g.input.keys.delete('KeyE');
    const c = g.buildings.center;
    p.x = c.x; p.y = c.y + 32;
    sim(1);
  });
  await page.waitForTimeout(400);
  await shot('06-hut-quest');
  // Hütte setzen (Baustelle) und mit E beliefern
  await page.evaluate(() => {
    const g = window.__game, w = g.world, p = g.player;
    let b = null;
    if (!g.progress.has('b:hut')) throw new Error('Questpfad nicht beim Hüttenbau: ' + (g.progress.step && g.progress.step.id));
    for (let d = 3; d < 8 && !b; d++) for (const [dx, dy] of [[d, 1], [-d - 1, 1], [1, d], [1, -d - 1]]) if (!b && g.buildings.canPlace('hut', w.cx + dx, w.cy + dy).ok) b = g.buildings.place(g, 'hut', w.cx + dx, w.cy + dy);
    p.x = b.x; p.y = b.y + 28;
    for (let i = 0; i < 30; i++) g.update(1 / 60);
  });
  await page.waitForTimeout(300);
  await shot('07-hut-site');
  await page.evaluate(() => {
    const g = window.__game, p = g.player;
    g.input.keys.add('KeyE'); for (let i = 0; i < 30; i++) g.update(1 / 60); g.input.keys.delete('KeyE');
    for (let i = 0; i < 60; i++) g.update(1 / 60);
    // zum nächsten Lager mit Überlebenden
    const s = g.settlers.list.filter((o) => o.mode === 'waiting' && o.poi).sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y))[0];
    p.x = s.x + 16; p.y = s.y + 6;
    for (let i = 0; i < 40; i++) g.update(1 / 60);
  });
  await page.waitForTimeout(300);
  await shot('08-camp');
  await page.evaluate(() => {
    const g = window.__game, p = g.player;
    g.input.keys.add('KeyE'); for (let i = 0; i < 20; i++) g.update(1 / 60); g.input.keys.delete('KeyE');
    const c = g.buildings.center;
    for (const s of g.settlers.list) if (s.mode === 'follow') { s.x = c.x + 20; s.y = c.y + 40; }
    p.x = c.x; p.y = c.y + 40;
    for (let i = 0; i < 5 * 60 * 60 && g.progress.step && g.progress.step.id !== 'night'; i++) {
      g.update(1 / 60);
      if (g.progress.step.id === 'farm' && !g.buildings.countAll('farm')) {
        g.stock.wood = Math.max(g.stock.wood, 20); g.stock.water = Math.max(g.stock.water, 10);
        const w = g.world;
        for (let d = 3; d < 10 && !g.buildings.countAll('farm'); d++) for (const [x, y] of [[w.cx - d - 2, w.cy - 3], [w.cx + d, w.cy - 3], [w.cx - 1, w.cy + d], [w.cx - 1, w.cy - d - 3]]) if (!g.buildings.countAll('farm') && g.buildings.canPlace('farm', x, y).ok) g.buildings.place(g, 'farm', x, y);
        g.buildings.finishAllSites(g);
      }
    }
  });
  await page.waitForTimeout(400);
  await shot('09-five-minutes');
  // Nacht 1
  await page.evaluate(() => {
    const g = window.__game;
    for (let i = 0; i < 400 * 60 && !g.cycle.isNight; i++) g.update(1 / 60);
    for (let i = 0; i < 25 * 60; i++) g.update(1 / 60);
    const e = g.enemies.list.find((x) => !x.dead && !x.guard);
    if (e) { g.player.x = (e.x + g.buildings.center.x) / 2; g.player.y = (e.y + g.buildings.center.y) / 2; }
    for (let i = 0; i < 20; i++) g.update(1 / 60);
  });
  await page.waitForTimeout(400);
  await shot('10-night1');
  // Nacht 5 (vorgespult, mit Verteidigung aus dem Balancing-Muster)
  await page.evaluate(() => {
    const g = window.__game, w = g.world, B = g.buildings, cx = w.cx, cy = w.cy;
    g.progress.unlockAll(); g.ui.applyUnlocks();
    g.flame.level = 3;
    B.territoryCenter = g.flame.territory;
    Object.assign(g.stock, { wood: 400, stone: 400, iron: 30, coal: 40, bolts: 300, food: 100, water: 100 });
    for (let y = cy - 9; y <= cy + 9; y++) for (let x = cx - 9; x <= cx + 9; x++) {
      const dx = Math.abs(x - cx), dy = Math.abs(y - cy);
      if (Math.max(dx, dy) !== 9) continue;
      const t = x === cx || y === cy ? 'gate' : 'wall';
      if (B.canPlace(t, x, y).ok) B.place(g, t, x, y, dx === 9 && dy < 9 ? 1 : 0);
    }
    for (const [x, y] of [[cx + 6, cy + 6], [cx - 6, cy - 6], [cx + 6, cy - 6], [cx - 6, cy + 6]]) if (B.canPlace('tower', x, y).ok) B.place(g, 'tower', x, y);
    for (const [x, y] of [[cx + 7, cy], [cx - 7, cy], [cx, cy + 7], [cx, cy - 7]]) if (B.canPlace('firebowl', x, y).ok) B.place(g, 'firebowl', x, y);
    B.finishAllSites(g);
    for (let i = 0; i < 6; i++) g.settlers.spawn(B.center.x - 20 + i * 8, B.center.y + 30);
    g.cycle.day = 5; g.cycle.t = 128; g.cycle.duskFired = false;
    for (let i = 0; i < 60 * 60 && !g.over; i++) { B.center.hp = Math.max(B.center.hp, 600); g.update(1 / 60); }
    g.player.x = B.center.x + 40; g.player.y = B.center.y + 120;
    g.camera.snap(g.player.x, g.player.y);
  });
  await page.waitForTimeout(400);
  await shot('11-night5');
  // Aschgänger-Lager
  await page.evaluate(() => {
    const g = window.__game, o = g.pois.list.find((x) => x.type === 'enemyCamp' && x.state === 'active') || g.pois.list.find((x) => x.type === 'enemyCamp');
    g.player.x = o.x; g.player.y = o.y + 80; g.player.hp = g.player.maxHp;
    g.camera.snap(o.x, o.y + 20);
    for (let i = 0; i < 30; i++) g.update(1 / 60);
  });
  await page.waitForTimeout(400);
  await shot('12-enemy-camp');
  // Mauerring mit Tor bei Tag
  await page.evaluate(() => {
    const g = window.__game, B = g.buildings;
    for (const e of g.enemies.list) if (!e.guard) e.dead = true;
    g.cycle.t = 40;
    for (let i = 0; i < 30; i++) g.update(1 / 60);
    const gate = B.list.find((b) => b.type === 'gate');
    g.player.x = gate.x; g.player.y = gate.y + 26;
    g.camera.snap(gate.x, gate.y - 20);
  });
  await page.waitForTimeout(400);
  await shot('13-wall-gate');
}
