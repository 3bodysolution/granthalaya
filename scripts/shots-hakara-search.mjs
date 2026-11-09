// Pictures for the Hakara essays and stories and the request search, light and dark, phone and desktop, into .shots/hakara-search/:
//   the From Hakara and Stories from Hakara rows, the Stories See all page, one story card, the Marathi filter, and four typed requests.
//   npm run dev (another window), then: node scripts/shots-hakara-search.mjs [base url]
import { chromium } from 'playwright';
import fs from 'node:fs';
const base = process.argv[2] || 'http://localhost:4321';
fs.mkdirSync('.shots/hakara-search', { recursive: true });
const QUERIES = ['best sports movies', 'essays on writing', 'मराठी कथा', 'best philosophy books'];
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
    const rows = page.locator('section.rows > *');
    const n = await rows.count();
    for (const [name, at] of [['stories-row', n - 1], ['hakara-row', n - 2]]) {
      await rows.nth(at).scrollIntoViewIfNeeded(); await page.waitForTimeout(600);
      await rows.nth(at).screenshot({ path: `.shots/hakara-search/${name}-${tag}.png` });
    }
    await page.goto(`${base}/essays/?collection=hakara-stories`, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
    await settle();
    await page.screenshot({ path: `.shots/hakara-search/stories-seeall-${tag}.png` });
    // a story card that has a translator (the credit line) and a gist
    const card = page.locator('.eb', { has: page.locator('.eb-credit') }).first();
    await card.scrollIntoViewIfNeeded(); await page.waitForTimeout(500);
    await card.screenshot({ path: `.shots/hakara-search/story-card-${tag}.png` });
    await page.goto(`${base}/essays/?language=mr`, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
    await settle();
    await page.screenshot({ path: `.shots/hakara-search/marathi-filter-${tag}.png` });
    for (const [i, q] of QUERIES.entries()) {
      await page.goto(`${base}/films/`, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
      await settle();
      await page.keyboard.press('/');
      await page.waitForTimeout(500);
      await page.keyboard.type(q, { delay: 20 });
      // wait until the request block (its heading) is there, then until its pictures have loaded
      await page.waitForFunction(() => document.querySelectorAll('#search-list .sgroup').length >= 2, null, { timeout: 15000 }).catch(() => {});
      await page.waitForFunction(() => [...document.querySelectorAll('#search-list img')].every((im) => im.complete), null, { timeout: 10000 }).catch(() => {});
      await page.waitForTimeout(1200);
      await page.locator('#search').screenshot({ path: `.shots/hakara-search/search-${i + 1}-${tag}.png` }).catch(async () => page.screenshot({ path: `.shots/hakara-search/search-${i + 1}-${tag}.png` }));
    }
    await ctx.close();
  }
}
await browser.close();
console.log('saved to .shots/hakara-search/');
