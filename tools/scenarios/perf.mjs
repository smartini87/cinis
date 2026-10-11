// Performance-Messung in Nacht 15: ausgebaute Siedlung (Mauerring, Tore, Türme, Fallen, Feuerschalen, Hütten),
// 16 Siedler, die doppelte Welle von Nacht 15 auf einmal rund um die Siedlung, zusätzliche Tiere. Gemessen wird im echten
// requestAnimationFrame-Takt bei 1× und 3× Tempo: Bilder pro Sekunde sowie Update- und Zeichenzeit pro Bild.
// Grenzwert: durchschnittliche Rechenzeit pro Bild (Update + Zeichnen) bei 1× unter 16,7 ms. Das 95-%-Perzentil
// wird nur ausgegeben – es schwankt stark, wenn andere Prozesse (z. B. parallele Szenarien) die CPU belegen.
// Richtwert allein auf dem Rechner (headless, Software-Rendering): Ø ≈ 6 ms, 95 % < 10 ms auch bei 3×.
export const query = 'skiptut';
export default async function (page) {
  await page.evaluate(async () => {
    const { waveFor } = await import('/js/enemies.js');
    const g = window.__game, w = g.world, B = g.buildings, cx = w.cx, cy = w.cy;
    Object.assign(g.stock, { wood: 2000, stone: 2000, iron: 200, coal: 200, bolts: 2000, food: 400, water: 400 });
    g.flame.level = 5;
    B.territoryCenter = g.flame.territory;
    for (let y = cy - 9; y <= cy + 9; y++) for (let x = cx - 9; x <= cx + 9; x++) {
      const dx = Math.abs(x - cx), dy = Math.abs(y - cy);
      if (Math.max(dx, dy) !== 9) continue;
      const t = x === cx || y === cy ? 'gate' : 'wall';
      if (B.canPlace(t, x, y).ok) B.place(g, t, x, y, dx === 9 && dy < 9 ? 1 : 0);
    }
    for (const [x, y] of [[cx + 3, cy + 3], [cx - 5, cy + 3], [cx + 3, cy - 5], [cx - 5, cy - 5]]) if (B.canPlace('hut', x, y).ok) B.place(g, 'hut', x, y);
    for (let a = 0; a < 12; a++) {
      const x = cx + Math.round(Math.cos(a / 12 * Math.PI * 2) * 6.5), y = cy + Math.round(Math.sin(a / 12 * Math.PI * 2) * 6.5);
      if (B.canPlace(a % 2 ? 'tower' : 'firebowl', x, y).ok) B.place(g, a % 2 ? 'tower' : 'firebowl', x, y);
    }
    for (let i = -6; i <= 6; i++) for (const [x, y] of [[cx + i, cy + 11], [cx + i, cy - 11], [cx + 11, cy + i], [cx - 11, cy + i]]) if (B.canPlace('trap', x, y).ok) B.place(g, 'trap', x, y);
    B.finishAllSites(g);
    for (let i = 0; i < 16; i++) g.settlers.spawn(B.center.x - 30 + i * 4, B.center.y + 30);
    // Nacht 15 mit voller Welle rund um die Siedlung
    g.cycle.day = 15; g.cycle.t = 128; g.cycle.duskFired = false;
    for (let i = 0; i < 60 * 60 && !g.cycle.isNight; i++) g.update(1 / 60);
    const wave = waveFor(15);
    let n = 0;
    for (const [type, k] of Object.entries(wave)) {
      if (!['walker', 'dog', 'brute', 'breaker', 'archer', 'boss'].includes(type) || typeof k !== 'number') continue;
      for (let i = 0; i < k * 2; i++, n++) {
        const a = Math.random() * Math.PI * 2, d = (13 + Math.random() * 6) * 16;
        g.enemies.spawn(type, B.center.x + Math.cos(a) * d, B.center.y + Math.sin(a) * d, wave.hpMul * 3, wave.dmgMul);
      }
    }
    for (let s = 0; s < (wave.swarmGroups || 0) * 16; s++, n++) g.enemies.spawn('swarm', B.center.x + 200 + (s % 5) * 6, B.center.y + 40 + s, 3, 1);
    for (let i = 0; i < 4; i++) g.wildlife.spawnGroup('wolf', B.center.x - 260, B.center.y + i * 60, g);
    for (let i = 0; i < 6; i++) g.wildlife.spawnGroup('deer', B.center.x + 300, B.center.y - 200 + i * 60, g);
    g.player.x = B.center.x; g.player.y = B.center.y + 40;
    g.player.maxHp = g.player.hp = 1e6;
    B.center.maxHp = B.center.hp = 1e6;
    g.camera.snap(g.player.x, g.player.y);
    // Zeitmessung in Update und Render einhängen
    const prof = (window.__prof = { upd: 0, ren: 0, frames: [] });
    const u = g.update.bind(g), r = g.render.bind(g);
    g.update = (dt) => { const t = performance.now(); u(dt); prof.upd += performance.now() - t; };
    g.render = () => { const t = performance.now(); r(); const now = performance.now(); prof.frames.push({ upd: prof.upd, ren: now - t, at: now }); prof.upd = 0; };
    window.__nEnemies = n;
  });
  const measure = async (speed) => {
    await page.evaluate((s) => { window.__game.speed = s; window.__prof.frames.length = 0; }, speed);
    await page.waitForTimeout(6000);
    return page.evaluate(() => {
      const g = window.__game, f = window.__prof.frames.slice(10);
      const cost = f.map((x) => x.upd + x.ren).sort((a, b) => a - b);
      const span = (f[f.length - 1].at - f[0].at) / 1000;
      const avg = (k) => f.reduce((a, x) => a + x[k], 0) / f.length;
      return {
        fps: Math.round((f.length - 1) / span),
        updMs: +avg('upd').toFixed(2), renMs: +avg('ren').toFixed(2),
        p95Ms: +cost[Math.floor(cost.length * 0.95)].toFixed(2),
        enemies: g.enemies.list.filter((e) => !e.dead).length, animals: g.wildlife.list.length,
        buildings: g.buildings.list.length, settlers: g.settlers.list.length, night: g.cycle.isNight,
      };
    });
  };
  const r1 = await measure(1);
  const r3 = await measure(3);
  console.log(JSON.stringify({ spawned: await page.evaluate(() => window.__nEnemies), x1: r1, x3: r3 }));
  await page.screenshot({ path: 'tools/out/perf-night15.png' });
  if (!r1.night || !r3.night) throw new Error('Messung nicht in der Nacht');
  const avg1 = r1.updMs + r1.renMs;
  if (avg1 > 16.7) throw new Error(`1×: Ø ${avg1.toFixed(1)} ms Rechenzeit pro Bild (> 16,7 ms)`);
}
