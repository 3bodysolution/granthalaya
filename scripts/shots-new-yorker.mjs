// Pictures of the Best of The New Yorker row (Essays page) and its See all page, light and dark, phone and desktop, into .shots/new-yorker/.
//   npm run dev (another window), then: node scripts/shots-new-yorker.mjs [base url]
import { chromium } from 'playwright';
import fs from 'node:fs';
const base = process.argv[2] || 'http://localhost:4321';
fs.mkdirSync('.shots/new-yorker', { recursive: true });
const browser = await chromium.launch();
for (const [size, viewport] of [['desktop', { width: 1280, height: 900 }], ['phone', { width: 390, height: 844 }]]) {
  for (const theme of ['light', 'dark']) {
    const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1, isMobile: size === 'phone', reducedMotion: 'reduce', colorScheme: theme });
    await ctx.addInitScript((t) => { try { localStorage.setItem('theme', t); } catch {} }, theme);
    const page = await ctx.newPage();
    await page.goto(`${base}/essays/`, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
    await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
    const row = page.locator('section.rows > *').last();
    await row.scrollIntoViewIfNeeded();
    await page.waitForTimeout(800);
    await row.screenshot({ path: `.shots/new-yorker/row-${size}-${theme}.png` });
    await page.goto(`${base}/essays/?collection=new-yorker`, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
    await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
    await page.waitForTimeout(800);
    await page.screenshot({ path: `.shots/new-yorker/seeall-${size}-${theme}.png` });
    await ctx.close();
  }
}
await browser.close();
console.log('saved to .shots/new-yorker/');
