// Szenario: schmaler Bildschirm (Smartphone hochkant) – Layout-Screenshot und Touch-Joystick.
export default async function (page) {
  await page.setViewportSize({ width: 390, height: 800 });
  await page.waitForTimeout(300);
  const box = await page.evaluate(() => ({ w: innerWidth, h: innerHeight }));
  const cdp = await page.context().newCDPSession(page);
  const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }] });
  await touch('touchStart', 60, 600);
  await touch('touchMove', 110, 600);
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'tools/out/mobile.png' });
  await touch('touchEnd');
  const moved = await page.evaluate(() => window.__game.input.usingTouch);
  console.log('Viewport', JSON.stringify(box), 'Touch erkannt:', moved);
  if (!moved) throw new Error('Touch-Eingabe nicht erkannt');
}
