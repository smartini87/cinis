// Szenario Einstieg: Anfangs nur Lebenspunkte und Ziel-Banner; Questschritte (Bewegen, Holz, Stein, Abliefern,
// Hütte) per Simulation erfüllen; Bauleiste zeigt zunächst nur die Hütte; Uhr steht bis zur ersten Nacht;
// Fortschritt übersteht Speichern und Laden.
export default async function (page) {
  const vis = () => page.evaluate(() => {
    const u = window.__game.ui;
    const v = (e) => !!e && !e.hidden && !e.closest('[hidden]');
    return {
      res: v(u.resPanel), build: v(u.buildBar), clock: v(u.dayPanel), energy: v(u.enRow), mini: v(u.mini), carry: v(u.carryPanel),
      hp: v(u.hpPanel), banner: v(u.quest), hut: v(u.buildBtns.hut), farm: v(u.buildBtns.farm), tower: v(u.buildBtns.tower),
      text: u.questTxt.textContent, quest: window.__game.progress.quest,
    };
  });
  await page.waitForTimeout(300);
  const start = await vis();
  console.log('Start', JSON.stringify(start));
  await page.screenshot({ path: 'tools/out/progression-start.png' });
  if (!start.hp || !start.banner || start.res || start.build || start.clock || start.energy || start.mini) throw new Error('Start-HUD nicht minimal');
  const r = await page.evaluate(() => {
    const g = window.__game, p = g.player, w = g.world, out = {};
    const t0 = g.cycle.t;
    const sim = (sec, fn) => { for (let i = 0; i < sec * 60; i++) { g.update(1 / 60); if (fn && fn()) return true; } return false; };
    const step = () => g.progress.quest;
    // 1) Bewegen
    if (step() === 0) { g.input.keys.add('KeyD'); sim(2, () => step() > 0); g.input.keys.delete('KeyD'); }
    out.afterMove = step();
    // 2/3) Holz und Stein sammeln (am Knoten E halten)
    const gatherAt = (type, want) => {
      for (let tries = 0; tries < 6 && g.progress.state[type === 'tree' ? 'wood' : 'stone'] < want; tries++) {
        const n = w.nodes.filter((x) => x.type === type && !x.removed && x.amount > 0).sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y))[0];
        p.x = n.x; p.y = n.y + 12; p.vx = p.vy = 0;
        g.input.keys.add('KeyE');
        sim(12, () => n.amount <= 0 || g.progress.state[type === 'tree' ? 'wood' : 'stone'] >= want);
        g.input.keys.delete('KeyE');
      }
      sim(0.1); // Questfortschritt wird im nächsten Schritt ausgewertet
    };
    gatherAt('tree', 10);
    out.afterWood = step();
    gatherAt('rock', 5);
    out.afterStone = step();
    // 4) Abliefern
    const c = g.buildings.center;
    p.x = c.x; p.y = c.y + 30;
    sim(0.5);
    out.afterDeliver = step();
    out.clockStill = g.cycle.t === t0;
    return out;
  });
  await page.waitForTimeout(200);
  const atHut = await vis();
  console.log('Quests', JSON.stringify(r), 'Hütten-Schritt', JSON.stringify(atHut));
  await page.screenshot({ path: 'tools/out/progression-hut.png' });
  if (r.afterMove < 1 || r.afterWood < 2 || r.afterStone < 3 || r.afterDeliver < 4) throw new Error('Questschritte nicht erfüllt');
  if (!r.clockStill) throw new Error('Uhr läuft im Einstieg');
  if (!atHut.build || !atHut.hut || atHut.farm || atHut.tower || !atHut.res) throw new Error('Bauleiste falsch freigeschaltet');
  const toasts = await page.evaluate(() => document.querySelector('.toasts').innerText);
  if (!/Neu: /.test(toasts)) throw new Error('Kein Freischalt-Hinweis');
  // 5) Hütte bauen → Farm wird freigeschaltet; danach speichern und laden
  const hut = await page.evaluate(() => {
    const g = window.__game, w = g.world;
    g.stock.wood = 100; g.stock.stone = 100;
    let ok = false;
    for (let d = 3; d < 8 && !ok; d++) for (const [dx, dy] of [[d, 0], [-d, 0], [0, d], [0, -d], [d, d], [-d, -d]]) {
      if (!ok && g.buildings.canPlace('hut', w.cx + dx, w.cy + dy).ok) ok = !!g.buildings.place(g, 'hut', w.cx + dx, w.cy + dy);
    }
    for (let i = 0; i < 30; i++) g.update(1 / 60);
    return { quest: g.progress.quest, farm: g.progress.has('b:farm') };
  });
  if (!hut.farm) throw new Error('Farm nach der Hütte nicht freigeschaltet');
  await page.evaluate(() => { const g = window.__game; g.pause(); });
  await page.getByRole('button', { name: /Speichern/ }).click();
  const url = page.url().replace(/[?&]play/, '');
  await page.goto(url);
  await page.waitForTimeout(600);
  await page.getByRole('button', { name: /Fortsetzen/ }).click();
  await page.waitForTimeout(300);
  const loaded = await vis();
  console.log('Nach dem Laden', JSON.stringify(loaded));
  if (loaded.quest !== hut.quest || !loaded.farm || loaded.tower || loaded.clock) throw new Error('Fortschritt nach dem Laden falsch');
}
