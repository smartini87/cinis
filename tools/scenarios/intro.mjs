// Szenario Intro: Sequenz läuft komplett fehlerfrei durch (Text → Kamerafahrt → Ankunft), danach Spielstart mit
// aktivem Questpfad; zweiter Durchlauf: jede Taste überspringt sofort.
export const query = 'intro';
export const noWalk = true;
export default async function (page) {
  const st = () => page.evaluate(() => { const g = window.__game; return { state: g.state, phase: g.intro.phase, active: g.intro.active, hidden: !!g.player.introHidden, quest: g.progress.quest, banner: !g.ui.quest.hidden && !g.ui.hud.hidden, text: document.querySelector('.intro-lines')?.innerText.trim().slice(0, 40) || '' }; });
  await page.waitForTimeout(3000);
  const a = await st();
  await page.screenshot({ path: 'tools/out/intro-text.png' });
  console.log('Text', JSON.stringify(a));
  if (a.state !== 'intro' || a.phase !== 'text' || !a.text) throw new Error('Intro-Text läuft nicht');
  await page.waitForFunction(() => window.__game.intro.phase === 'flight', null, { timeout: 20000 });
  await page.waitForTimeout(3000);
  await page.screenshot({ path: 'tools/out/intro-flight.png' });
  await page.waitForFunction(() => window.__game.intro.phase === 'arrive', null, { timeout: 12000 });
  await page.waitForTimeout(1300);
  await page.screenshot({ path: 'tools/out/intro-arrive.png' });
  await page.waitForFunction(() => window.__game.state === 'playing', null, { timeout: 8000 });
  await page.waitForTimeout(400);
  const b = await st();
  console.log('Danach', JSON.stringify(b));
  await page.screenshot({ path: 'tools/out/intro-end.png' });
  if (b.hidden || !b.banner) throw new Error('Nach dem Intro kein Spielstart mit Ziel-Banner');
  // Zweiter Durchlauf: überspringen
  await page.reload();
  await page.waitForTimeout(1200);
  await page.keyboard.press('Space');
  await page.waitForTimeout(400);
  const c = await st();
  console.log('Übersprungen', JSON.stringify(c));
  if (c.state !== 'playing' || c.hidden || c.active) throw new Error('Intro lässt sich nicht überspringen');
}
