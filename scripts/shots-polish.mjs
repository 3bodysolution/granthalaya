// Pictures for the look-and-feel changes: phone (390) and desktop (1280), light and dark, first screen of each page.
//   npm run dev   (another window)
//   node scripts/shots-polish.mjs [--out .shots/polish] [--tag after] [--base http://localhost:4321] [home books book settings sponsor]
// "book" is the first book linked from /books/. Settings needs a sign-in, so signed out it shows where it sends you (the sign-in page).
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const args = process.argv.slice(2);
const take = (f, d) => { const i = args.indexOf(f); return i < 0 ? d : args.splice(i, 2)[1]; };
const out = take('--out', '.shots/polish');
const tag = take('--tag', 'after');
const base = take('--base', 'http://localhost:4321');
const names = args.length ? args : ['home', 'books', 'book', 'settings', 'sponsor'];
mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
const probe = await (await browser.newContext()).newPage();
await probe.goto(base + '/books/', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
const book = await probe.evaluate(() => [...document.querySelectorAll('a[href^="/book/"]')].map((a) => a.getAttribute('href')).find((h) => /^\/book\/[^/]+\/$/.test(h || '')) || '/books/');
const paths = { home: '/', books: '/books/', book, settings: '/settings/', sponsor: tag === 'before' ? '/support/' : '/sponsor/' };

for (const [size, viewport] of [['phone', { width: 390, height: 844 }], ['desktop', { width: 1280, height: 800 }]]) {
  for (const theme of ['light', 'dark']) {
    const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1, isMobile: size === 'phone', hasTouch: size === 'phone', reducedMotion: 'reduce', colorScheme: theme });
    await ctx.addInitScript((t) => { try { localStorage.setItem('theme', t); } catch {} }, theme);
    const page = await ctx.newPage();
    // a phone is a touch screen: a finger, no hover (the Sponsor page shows its amount buttons only then)
    if (size === 'phone') await (await ctx.newCDPSession(page)).send('Emulation.setEmulatedMedia', { features: [{ name: 'pointer', value: 'coarse' }, { name: 'hover', value: 'none' }, { name: 'prefers-reduced-motion', value: 'reduce' }, { name: 'prefers-color-scheme', value: theme }] });
    for (const n of names) {
      await page.goto(base + paths[n], { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
      await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
      await page.waitForTimeout(1200);
      // the paper is fixed to the screen; for a whole-page picture only, stretch it over the whole page
      if (n === 'sponsor') await page.addStyleTag({ content: 'html[data-theme="light"] body { position: relative; } html[data-theme="light"] body::before { position: absolute !important; }' });
      const file = `${out}/${n}-${size}-${theme}${n === 'home' ? '-' + tag : ''}.png`;
      // a whole-page picture of the phone is taken by making the window as tall as the page (a full-page capture would drop the touch screen setting)
      if (n === 'sponsor') { await page.setViewportSize({ width: viewport.width, height: await page.evaluate(() => document.documentElement.scrollHeight) }); await page.waitForTimeout(300); }
      await page.screenshot({ path: file });
      if (n === 'sponsor') await page.setViewportSize(viewport);
      console.log(file);
    }
    await ctx.close();
  }
}
await browser.close();
