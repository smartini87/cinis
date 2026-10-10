// Szenario Respawn & Kampfanimation: Schwerthieb (Ausholen → Schlag mit Trail, Trefferpause, Rückstoß),
// Tod mit Beutehaufen und Countdown, Rückkehr an der Flamme mit Funken, Aufstehen und Unverwundbarkeit.
export const query = 'skiptut'; // alles freigeschaltet (ohne geführten Einstieg)
export default async function (page) {
  const sim = (sec) => page.evaluate((s) => { const g = window.__game; for (let i = 0; i < s * 60; i++) g.update(1 / 60); }, sec);
  const freeze = (on) => page.evaluate((v) => { window.__game.speed = v ? 0 : 1; }, on);
  // 1) Angriff: Gegner vor dem Spieler, Schlag mitten im Durchzug einfrieren
  const atk = await page.evaluate(() => {
    const g = window.__game, p = g.player;
    g.cycle.t = 160; g.enemies.queue = [];
    p.x = g.buildings.center.x + 60; p.y = g.buildings.center.y + 40;
    const e = g.enemies.spawn('walker', p.x + 14, p.y);
    e.retarget = 99; e.speed = 0;
    g.camera.zoomBias = 2; g.camera.updateZoom(); g.camera.snap(p.x, p.y);
    g.input.keys.add('Space');
    const hp0 = e.hp, x0 = e.x;
    let stopped = 0;
    for (let i = 0; i < 9; i++) { const t = g.time; g.update(1 / 60); if (g.time === t) stopped++; }
    g.input.keys.delete('Space');
    return { phase: p.atk && p.atk.t, hit: hp0 - e.hp, knock: Math.round((e.x - x0) * 10) / 10, kv: Math.round(e.kvx), hitStopFrames: stopped, trail: p.trail.length };
  });
  await freeze(true);
  await page.waitForTimeout(150);
  await page.screenshot({ path: 'tools/out/attack.png' });
  await freeze(false);
  console.log('Angriff', JSON.stringify(atk));
  if (!(atk.hit > 0)) throw new Error('Schwerthieb trifft nicht');
  if (atk.hitStopFrames < 2) throw new Error('Keine Trefferpause');
  if (!(atk.kv > 0 || atk.knock > 0)) throw new Error('Kein Rückstoß');
  // 2) Tod: Hälfte der Ressourcen als Beutehaufen, Countdown
  const death = await page.evaluate(() => {
    const g = window.__game, p = g.player;
    for (const e of g.enemies.list) e.dead = true;
    g.cycle.t = 60;
    g.update(1 / 60);
    Object.assign(p.inv, { wood: 10, stone: 6, food: 0, water: 0 });
    p.die(g);
    return { piles: g.loot.piles.length, pile: g.loot.piles[0] && g.loot.piles[0].items, inv: { ...p.inv }, x: p.x, y: p.y };
  });
  await sim(4);
  await freeze(true);
  await page.waitForTimeout(150);
  await page.screenshot({ path: 'tools/out/death.png' });
  await freeze(false);
  console.log('Tod', JSON.stringify(death));
  if (death.piles !== 1 || death.pile.wood !== 5 || death.pile.stone !== 3 || death.inv.wood !== 5) throw new Error('Beutehaufen falsch');
  // 3) Funken sammeln sich, dann Rückkehr
  await page.evaluate(() => { const g = window.__game, p = g.player; const n = (p.respawnT - 0.4) * 60; for (let i = 0; i < n; i++) g.update(1 / 60); g.camera.snap(g.buildings.center.x, g.buildings.center.y + 20); });
  await freeze(true);
  await page.waitForTimeout(150);
  await page.screenshot({ path: 'tools/out/respawn-converge.png' });
  await freeze(false);
  const back = await page.evaluate(() => {
    const g = window.__game, p = g.player;
    for (let i = 0; i < 30; i++) g.update(1 / 60);
    const r = { dead: p.dead, invuln: p.invuln > 0, standing: p.standT > 0, hp: p.hp };
    // Unverwundbar: ein Gegner direkt daneben richtet nichts aus
    g.cycle.t = 160; g.enemies.queue = [];
    const e = g.enemies.spawn('walker', p.x + 8, p.y);
    for (let i = 0; i < 40; i++) g.update(1 / 60);
    r.hpAfterHit = p.hp;
    e.dead = true;
    g.cycle.t = 60;
    return r;
  });
  console.log('Rückkehr', JSON.stringify(back));
  if (back.dead || !back.invuln || !back.standing) throw new Error('Respawn fehlerhaft');
  if (back.hpAfterHit < back.hp) throw new Error('Während der Unverwundbarkeit Schaden genommen');
  // 4) Beutehaufen wieder aufheben
  const pick = await page.evaluate(() => {
    const g = window.__game, p = g.player, pile = g.loot.piles[0];
    p.x = pile.x + 8; p.y = pile.y; p.standT = 0;
    g.input.keys.add('KeyE');
    for (let i = 0; i < 20; i++) g.update(1 / 60);
    g.input.keys.delete('KeyE');
    return { piles: g.loot.piles.length, wood: p.inv.wood, stone: p.inv.stone, stock: g.stock.wood, d: Math.round(g.buildings.distTo(g.buildings.center, p.x, p.y)) };
  });
  console.log('Aufheben', JSON.stringify(pick));
  // Der Rest wurde nach der Rückkehr an der Flamme automatisch abgeliefert; aufgehoben wird die Hälfte aus dem Haufen
  if (pick.piles !== 0 || pick.wood !== 5 || pick.stone !== 3) throw new Error('Beute nicht aufgehoben');
}
