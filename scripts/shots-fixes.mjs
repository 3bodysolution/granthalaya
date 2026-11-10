// Pictures for the 2026-11-10 fixes: shelf (status filter, essay cards), a review list. node scripts/shots-fixes.mjs [--base ...]
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const BASE = process.argv.includes('--base') ? process.argv[process.argv.indexOf('--base') + 1] : 'http://localhost:4321';
const OUT = '.shots/fixes-1110'; mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
for (const theme of ['light', 'dark']) for (const [dev, vp] of [['desktop', { width: 1280, height: 900 }], ['phone', { width: 390, height: 844 }]]) {
  const ctx = await browser.newContext({ viewport: vp, colorScheme: theme, isMobile: dev === 'phone', hasTouch: dev === 'phone' });
  await ctx.addInitScript((t) => { try { localStorage.setItem('theme', t); } catch {} }, theme);
  const page = await ctx.newPage();
  await page.goto(`${BASE}/@sarthak/library/`, { waitUntil: 'networkidle' });
  const opt = await page.evaluate(() => { const o = document.querySelector('#status-sel option:nth-child(2)'); const c = getComputedStyle(o); return [c.color, c.backgroundColor]; }).catch(() => null);
  console.log(theme, dev, 'option colours (text, background):', opt);
  await page.screenshot({ path: `${OUT}/library-${dev}-${theme}.png` });
  await page.evaluate(() => document.querySelector('#lib')?.setAttribute('data-type', 'essay'));
  const t = page.locator('.tabs button', { hasText: /essays/i }).first();
  if (await t.count()) { await t.click(); await page.waitForTimeout(500); const bb = await page.locator('.cell-essay').first().boundingBox(); await page.screenshot({ fullPage: true, clip: { x: Math.max(0, bb.x - 10), y: bb.y - 10, width: bb.width + 20, height: bb.height + 50 }, path: `${OUT}/library-essays-${dev}-${theme}.png` }); } else console.log('  no Essays tab on this shelf');
  await ctx.close();
}
await browser.close();
