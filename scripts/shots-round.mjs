// Pictures of this round's changes (phone and desktop, light and dark) in .shots/round/. Needs `npm run dev` running.
//   node scripts/shots-round.mjs [username]
// Public pages only (no sign-in): stats shelf, library, essays, films row, home, join, footer.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const out = '.shots/round';
const base = process.env.BASE || 'http://localhost:4321';
const user = process.argv[2] || 'sarthak';
mkdirSync(out, { recursive: true });
const sizes = { phone: { width: 390, height: 844 }, desktop: { width: 1280, height: 800 } };

const browser = await chromium.launch();
for (const [label, viewport] of Object.entries(sizes)) {
  for (const theme of ['light', 'dark']) {
    const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1, isMobile: label === 'phone', hasTouch: label === 'phone', colorScheme: theme });
    await ctx.addInitScript((t) => { try { localStorage.setItem('theme', t); } catch (e) { /* storage */ } }, theme);
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const tag = `${label}-${theme}`;
    const go = async (path) => {
      await page.goto(base + path, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => null);
      await page.evaluate((t) => { document.documentElement.dataset.theme = t; }, theme);
      await page.waitForTimeout(500);
    };
    const shot = (name, opts = {}) => page.screenshot({ path: `${out}/${name}.${tag}.png`, ...opts });

    await go(`/@${user}/stats/`);
    await shot('01-stats-top');
    await go(`/@${user}/library/`);
    await shot('02-library');
    await go('/essays/');
    await shot('03-essays');
    if (label === 'desktop') { await page.hover('.eb').catch(() => null); await page.waitForTimeout(700); await shot('03b-essay-hover'); }
    await go('/books/');
    await shot('04-books-row');
    await go('/join/');
    await shot('05-join');
    await go('/about/');
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(500);
    await shot('06-footer');
    if (errors.length) console.log(tag, 'page errors:', errors.join(' | '));
    await ctx.close();
  }
}
await browser.close();
console.log('done');
