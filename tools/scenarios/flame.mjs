// Szenario Flammen-Level: Upgrade schaltet frei (Stufe und Bauplan), Brennstoffmangel lässt die Flamme schrumpfen,
// Nachlegen füllt die Glut, Schutzaura verbrennt Gegner, Flammen-Fenster per E, bei Glut 0 erlischt sie (Game Over).
export const query = 'skiptut';
export default async function (page) {
  const r = await page.evaluate(() => {
    const g = window.__game, f = g.flame, out = {};
    const sim = (sec) => { for (let i = 0; i < sec * 60; i++) g.update(1 / 60); };
    g.ui.update(1);
    out.l1 = { level: f.level, workbench: g.isAvailable('workbench'), btnHidden: g.ui.buildBtns.workbench.hidden, light: Math.round(f.light), terr: f.territory, pop: f.popCap };
    // Upgrade auf Stufe 2
    Object.assign(g.stock, { wood: 500, stone: 500, iron: 100, coal: 100, resin: 50, cloth: 50, oil: 20 });
    out.upgraded = f.upgrade(g);
    g.ui.update(1);
    out.l2 = { level: f.level, workbench: g.isAvailable('workbench'), light: Math.round(f.light), terr: f.territory, pop: f.popCap, toast: /Werkbank/.test(document.querySelector('.toasts').innerText) };
    // Bauplan-Freischaltung: Falle nur mit Bauplan, Schmiede braucht Stufe 4 und Bauplan
    out.trapBefore = g.isAvailable('trap');
    g.progress.addBlueprint('trap');
    out.trapAfter = g.isAvailable('trap');
    f.upgrade(g); f.upgrade(g);
    out.level4 = f.level;
    out.forgeNoBp = g.isAvailable('forge');
    g.progress.addBlueprint('forge');
    out.forgeBp = g.isAvailable('forge');
    out.firebowl = g.isAvailable('firebowl');
    // Brennstoff: Stufe 4 braucht Holz und Kohle
    const need = { ...f.def.fuel };
    out.fuel = need;
    g.stock.wood = 0; g.stock.coal = 0;
    const v0 = f.vigor, l0 = f.light;
    f.burnForNight(g);
    out.shrunk = { vigor: Math.round(f.vigor), from: v0, lightLess: f.light < l0 };
    // Nachlegen
    g.stock.coal = 20;
    f.feed(g);
    out.fed = Math.round(f.vigor);
    // Schutzaura: Gegner nahe der Flamme verbrennen
    g.cycle.t = 165; g.enemies.queue = [];
    const c = g.buildings.center;
    const e = g.enemies.spawn('walker', c.x + 30, c.y);
    e.speed = 0; e.retarget = 99;
    const hp0 = e.hp;
    sim(1);
    out.aura = Math.round(hp0 - e.hp);
    e.dead = true;
    g.cycle.t = 60;
    return out;
  });
  // Flammen-Fenster per E
  await page.evaluate(() => { const g = window.__game, c = g.buildings.center; g.player.x = c.x; g.player.y = c.y + 30; g.wildlife.clear(); });
  await page.keyboard.down('KeyE');
  await page.waitForTimeout(250);
  await page.keyboard.up('KeyE');
  await page.waitForTimeout(150);
  r.panel = await page.evaluate(() => window.__game.panel);
  await page.screenshot({ path: 'tools/out/flame-panel.png' });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(100);
  // Erlöschen: Glut fast leer, kein Brennstoff
  const out = await page.evaluate(() => {
    const g = window.__game, f = g.flame;
    for (const k in g.stock) g.stock[k] = 0;
    g.player.inv.clear();
    f.vigor = 10;
    f.burnForNight(g);
    return { over: g.over, reason: g.overReason, vigor: f.vigor };
  });
  r.out = out;
  console.log(JSON.stringify(r));
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'tools/out/flame-out.png' });
  if (r.l1.level !== 1 || r.l1.workbench || !r.l1.btnHidden) throw new Error('Stufe 1 falsch');
  if (!r.upgraded || r.l2.level !== 2 || !r.l2.workbench || !r.l2.toast || !(r.l2.light > r.l1.light) || !(r.l2.pop > r.l1.pop)) throw new Error('Upgrade fehlerhaft');
  if (r.trapBefore || !r.trapAfter) throw new Error('Bauplan-Freischaltung (Falle) fehlerhaft');
  if (r.level4 !== 4 || r.forgeNoBp || !r.forgeBp || !r.firebowl) throw new Error('Stufe + Bauplan (Schmiede) fehlerhaft');
  if (!(r.shrunk.vigor < r.shrunk.from) || !r.shrunk.lightLess) throw new Error('Brennstoffmangel ohne Folgen');
  if (!(r.fed > r.shrunk.vigor)) throw new Error('Nachlegen wirkt nicht');
  if (!(r.aura > 0)) throw new Error('Keine Schutzaura');
  if (r.panel !== 'flame') throw new Error('Flammen-Fenster öffnet nicht');
  if (r.out.over !== 'defeat' || r.out.reason !== 'out') throw new Error('Erlöschen beendet das Spiel nicht');
}
