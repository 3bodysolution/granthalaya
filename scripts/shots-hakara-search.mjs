// Pictures for the Hakara essays and the request search, light and dark, phone and desktop, into .shots/hakara-search/:
//   the Essays page's From Hakara row, the Marathi filter page, and a few typed requests in the search box.
//   npm run dev (another window), then: node scripts/shots-hakara-search.mjs [base url]
import { chromium } from 'playwright';
import fs from 'node:fs';
const base = process.argv[2] || 'http://localhost:4321';
fs.mkdirSync('.shots/hakara-search', { recursive: true });
const QUERIES = ['best sports movies', 'essays on writing', 'उत्तम मराठी कादंबऱ्या', 'best philosophy books'];
const browser = await chromium.launch();
for (const [size, viewport] of [['desktop', { width: 1280, height: 900 }], ['phone', { width: 390, height: 844 }]]) {
  for (const theme of ['light', 'dark']) {
    const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1, isMobile: size === 'phone', reducedMotion: 'reduce', colorScheme: theme });
    await ctx.addInitScript((t) => { try { localStorage.setItem('theme', t); } catch {} }, theme);
    const page = await ctx.newPage();
    const settle = async () => { await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme); await page.waitForTimeout(900); };
    const tag = `${size}-${theme}`;
    await page.goto(`${base}/essays/`, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
    await settle();
    const row = page.locator('section.rows > *').last();
    await row.scrollIntoViewIfNeeded(); await page.waitForTimeout(600);
    await row.screenshot({ path: `.shots/hakara-search/hakara-row-${tag}.png` });
    await page.goto(`${base}/essays/?language=mr`, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
    await settle();
    await page.screenshot({ path: `.shots/hakara-search/marathi-filter-${tag}.png` });
    await page.goto(`${base}/essays/?collection=hakara`, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
    await settle();
    await page.screenshot({ path: `.shots/hakara-search/hakara-seeall-${tag}.png` });
    for (const [i, q] of QUERIES.entries()) {
      await page.goto(`${base}/films/`, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
      await settle();
      await page.keyboard.press('/');
      await page.waitForTimeout(500);
      await page.keyboard.type(q, { delay: 20 });
      await page.waitForTimeout(5000);   // the normal results, then the request block when the model answers
      await page.locator('#search').screenshot({ path: `.shots/hakara-search/search-${i + 1}-${tag}.png` }).catch(async () => page.screenshot({ path: `.shots/hakara-search/search-${i + 1}-${tag}.png` }));
    }
    await ctx.close();
  }
}
await browser.close();
console.log('saved to .shots/hakara-search/');
