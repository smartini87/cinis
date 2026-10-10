// Szenario Endlos & Highscore: nach Nacht 30 geht es weiter, spätere Wellen enthalten alle Gegnertypen,
// Fernkämpfer beschießen Türme, Brecher gehen durch Mauern, Boss stampft; Game Over trägt einen Rekord ein.
export const query = 'skiptut';
export default async function (page) {
  await page.evaluate(() => localStorage.removeItem('cinis.highscore.v1'));
  const r = await page.evaluate(async () => {
    const { waveFor } = await import('/js/enemies.js');
    const g = window.__game, w = g.world, B = g.buildings, p = g.player, out = {};
    const sim = (sec) => { for (let i = 0; i < sec * 60 && !g.over; i++) g.update(1 / 60); };
    for (const n of w.nodes) if (Math.hypot(n.tx - w.cx, n.ty - w.cy) < 12) w.removeNode(n);
    // 1) Wellen: Nacht 35 enthält alle Typen, Boss alle 5 Nächte
    const w35 = waveFor(35);
    out.w35 = { walker: w35.walker, dog: w35.dog, breaker: w35.breaker, archer: w35.archer, brute: w35.brute, swarm: w35.swarmGroups, boss: w35.boss, elite: w35.elite };
    out.counts = [5, 10, 20, 40, 60].map((n) => { const x = waveFor(n); return ['walker', 'dog', 'breaker', 'archer', 'brute'].reduce((a, k) => a + (x[k] || 0), 0); });
    out.bossNights = [4, 5, 9, 10, 15].map((n) => waveFor(n).boss || 0).join(',');
    // 2) Fernkämpfer beschießt einen Turm aus der Distanz
    Object.assign(g.stock, { wood: 999, stone: 999, bolts: 0 });
    const tw = B.place(g, 'tower', w.cx + 8, w.cy - 6);
    B.finishAllSites(g);
    g.cycle.t = 165; g.enemies.queue = [];
    p.x = B.center.x; p.y = B.center.y + 30;
    const ar = g.enemies.spawn('archer', tw.x + 80, tw.y);
    const hp0 = tw.hp;
    let minD = 1e9;
    for (let i = 0; i < 8 * 60; i++) { g.update(1 / 60); minD = Math.min(minD, Math.hypot(ar.x - tw.x, ar.y - tw.y)); }
    out.archerHit = Math.round(hp0 - tw.hp);
    out.archerDist = Math.round(minD);
    ar.dead = true;
    // 3) Brecher: geht auf die Mauer los statt außen herum
    for (let x = w.cx - 6; x <= w.cx + 6; x++) B.place(g, 'wall', x, w.cy + 7, 0);
    B.finishAllSites(g);
    sim(0.1);
    const br = g.enemies.spawn('breaker', (w.cx + 0.5) * 16, (w.cy + 12) * 16);
    sim(10);
    out.breakerWall = B.list.some((b) => b.type === 'wall' && (b.hp < b.maxHp || b.dead)) || B.list.filter((b) => b.type === 'wall').length < 13;
    br.dead = true;
    // 4) Boss (Stampfer) verletzt den Spieler in der Nähe
    p.x = B.center.x + 140; p.y = B.center.y + 140; p.hp = p.maxHp = 1e5;
    const boss = g.enemies.spawn('boss', p.x + 20, p.y);
    boss.ability = 'stomp'; boss.abilityT = 0;
    sim(3);
    out.stomp = p.hp < 1e5;
    boss.dead = true;
    p.maxHp = p.hp = 100;
    // 5) Endlos: Nacht 30 überstehen → Tag 31 läuft weiter
    for (const e of g.enemies.list) e.dead = true;
    g.flame.vigor = 100;
    Object.assign(g.stock, { wood: 999, coal: 999 });
    g.cycle.day = 30; g.cycle.t = 200; g.cycle.duskFired = true; g.enemies.queue = [];
    B.center.hp = B.center.maxHp = 1e6;
    sim(30);
    out.day = g.cycle.day;
    out.over = g.over;
    // 6) Game Over trägt den Rekord ein
    g.cycle.day = 12;
    g.stats.kills = 77;
    g.endGame('defeat');
    out.record = g.score && g.score.record;
    out.stored = JSON.parse(localStorage.getItem('cinis.highscore.v1')).top[0].nights;
    return out;
  });
  await page.waitForTimeout(1600);
  const endTxt = await page.evaluate(() => document.querySelector('.overlay').innerText);
  await page.screenshot({ path: 'tools/out/endless-gameover.png' });
  r.endRecord = /Neuer Rekord/.test(endTxt);
  r.endSeed = /gleicher Seed/.test(endTxt);
  // Hauptmenü zeigt den Rekord
  await page.getByRole('button', { name: 'Hauptmenü' }).click();
  await page.waitForTimeout(400);
  r.menuBest = /Rekord: 11 Nächte/.test(await page.evaluate(() => document.querySelector('.overlay').innerText));
  console.log(JSON.stringify(r));
  const w = r.w35;
  if (!(w.walker && w.dog && w.breaker && w.archer && w.brute && w.swarm && w.boss && w.elite)) throw new Error('Nacht 35 ohne alle Gegnertypen');
  if (!(r.counts[0] < r.counts[1] && r.counts[1] < r.counts[2] && r.counts[2] < r.counts[3] && r.counts[3] < r.counts[4])) throw new Error('Gegnerzahl steigt nicht');
  if (r.bossNights !== '0,1,0,1,1') throw new Error('Boss nicht alle 5 Nächte: ' + r.bossNights);
  if (!(r.archerHit > 0) || r.archerDist < 40) throw new Error('Fernkämpfer greift nicht aus der Distanz an');
  if (!r.breakerWall) throw new Error('Brecher greift die Mauer nicht an');
  if (!r.stomp) throw new Error('Boss-Stampfen wirkungslos');
  if (r.day !== 31 || r.over) throw new Error('Spiel endet nach Nacht 30');
  if (!r.record || r.stored !== 11 || !r.endRecord || !r.endSeed) throw new Error('Highscore fehlerhaft');
  if (!r.menuBest) throw new Error('Rekord nicht im Hauptmenü');
}
