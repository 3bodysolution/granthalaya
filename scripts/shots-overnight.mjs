// Pictures of the overnight changes (phone and desktop, light and dark) in .shots/overnight/. Needs `npm run dev` running.
//   node scripts/shots-overnight.mjs
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const out = '.shots/overnight';
const base = process.env.BASE || 'http://localhost:4321';
mkdirSync(out, { recursive: true });
const sizes = { phone: { width: 390, height: 844 }, desktop: { width: 1280, height: 800 } };
const themes = ['light', 'dark'];

const browser = await chromium.launch();
for (const [label, viewport] of Object.entries(sizes)) {
  for (const theme of themes) {
    const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1, isMobile: label === 'phone', hasTouch: label === 'phone', colorScheme: theme });
    await ctx.addInitScript((t) => { try { localStorage.setItem('theme', t); } catch (e) { /* storage */ } }, theme);
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const tag = `${label}-${theme}`;
    const go = async (path) => { await page.goto(base + path, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => null); await page.evaluate((t) => { document.documentElement.dataset.theme = t; }, theme); await page.waitForTimeout(600); };
    const shot = (name, opts = {}) => page.screenshot({ path: `${out}/${name}.${tag}.png`, ...opts });

    // home: headline without the line under it; the pencil loop (hover on a computer, drawn on load on a phone)
    await go('/');
    if (label === 'desktop') { await page.hover('.rw').catch(() => null); await page.waitForTimeout(1200); }
    else await page.waitForTimeout(1800);
    await shot('01-home');
    // the top bar's Sponsor button, rest and hover
    if (label === 'desktop') {
      const sp = page.locator('.sponsor').first();
      await shot('02-sponsor-rest', { clip: { x: 760, y: 0, width: 520, height: 80 } });
      await sp.hover(); await page.waitForTimeout(500);
      await shot('03-sponsor-hover', { clip: { x: 760, y: 0, width: 520, height: 80 } });
    } else {
      await shot('02-sponsor-rest', { clip: { x: 0, y: 0, width: 390, height: 76 } });
    }
    // the footer: one credits line
    await go('/about/');
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(500);
    await shot('04-footer-credits');
    // a row: scrolled to its end, the last poster fully showing
    await go('/films/');
    await page.evaluate(() => { document.querySelectorAll('[data-row-list]').forEach((l, i) => { if (i === 1) { l.scrollLeft = l.scrollWidth; l.scrollIntoView({ block: 'center' }); } }); });
    await page.waitForTimeout(900);
    await shot('05-row-end');
    // books front page: no "to try" rows or chips
    await go('/books/');
    await shot('06-books', { fullPage: false });
    // film page: no credit line at the bottom
    await go('/film/603-the-matrix/');
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(600);
    await shot('07-film-bottom');
    // privacy and terms
    await go('/privacy/'); await shot('08-privacy');
    await go('/terms/'); await shot('09-terms');
    // search: a misspelt name offers the closest ones
    await go('/');
    await page.keyboard.press('/').catch(() => null);
    await page.waitForTimeout(500);
    await page.keyboard.type('batatyachi chaal', { delay: 30 });
    await page.waitForTimeout(6000);
    await shot('10-search-did-you-mean');
    if (errors.length) console.log(tag, 'page errors:', errors.slice(0, 3));
    await ctx.close();
  }
}
await browser.close();
console.log('done');
