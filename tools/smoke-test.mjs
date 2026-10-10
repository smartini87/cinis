// smoke-test.mjs – lädt das Spiel headless (Playwright/Chromium), spielt kurz an und
// schlägt fehl, sobald Konsolenfehler oder unbehandelte Exceptions auftreten.
// Aufruf: node tools/smoke-test.mjs [szenario.mjs]   (Screenshot -> tools/out/)
// Chromium: Playwright-Browser oder Pfad über CHROMIUM_PATH (z. B. /usr/bin/chromium).
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { startServer } from './serve.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, 'out');
fs.mkdirSync(outDir, { recursive: true });
const port = 8000 + Math.floor(Math.random() * 900);
const server = await startServer(port);
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`[console.${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}\n${e.stack || ''}`));
page.on('requestfailed', (r) => errors.push(`[requestfailed] ${r.url()}`));

// Szenarien können zusätzliche URL-Parameter verlangen: export const query = 'skiptut&…'
const scenario = process.argv[2];
const mod = scenario ? await import(pathToFileURL(path.resolve(scenario)).href) : null;
const extra = mod && mod.query ? `&${mod.query}` : '';
await page.goto(`http://localhost:${port}/?seed=${process.env.SEED || 4242}&play${extra}`);
await page.waitForTimeout(1500);
// Standardablauf: ein wenig herumlaufen
for (const k of ['KeyD', 'KeyS', 'KeyA', 'KeyW']) {
  await page.keyboard.down(k); await page.waitForTimeout(300); await page.keyboard.up(k);
}
if (mod) {
  try {
    await mod.default(page, { outDir, errors });
  } catch (e) {
    errors.push(`[szenario] ${e.message}`);
  }
}
await page.screenshot({ path: path.join(outDir, 'screenshot.png') });
const fps = await page.evaluate(() => window.__game && Math.round(window.__game.fps));
console.log(`FPS (headless, Richtwert): ${fps}`);
await browser.close();
server.close();
if (errors.length) { console.error('FEHLER:\n' + errors.join('\n')); process.exit(1); }
console.log('OK – keine Konsolenfehler.');
