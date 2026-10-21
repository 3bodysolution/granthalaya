// Takes phone (390px) and desktop (1280px) screenshots of pages on the local copy, for looking at layout.
//   npm run shots -- / /films/ /books/ "/books/?list=booker"
//   npm run shots -- --fold /essays/      only the first screen (long pages shrink to nothing when shown whole)
//   npm run shots -- --out .shots/after --base http://localhost:4321 /essays/
// Pictures go in .shots/ (not committed), named after the page, like books-list-booker.phone.png.
// In Git Bash put MSYS_NO_PATHCONV=1 in front, or "/" turns into a Windows path.
// Needs `npm run dev` running and `npx playwright install chromium` done once.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const args = process.argv.slice(2);
const take = (flag, fallback) => {
  const i = args.indexOf(flag);
  return i < 0 ? fallback : args.splice(i, 2)[1];
};
const out = take('--out', '.shots');
const base = take('--base', 'http://localhost:4321');
const fold = args.includes('--fold') ? (args.splice(args.indexOf('--fold'), 1), true) : false; // only the first screen, not the whole page
const pages = args.length ? args : ['/'];
mkdirSync(out, { recursive: true });

const sizes = { phone: { width: 390, height: 844 }, desktop: { width: 1280, height: 800 } };
const nameOf = (p) => p.replace(/^\/|\/$/g, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'home';

const browser = await chromium.launch();
for (const [label, viewport] of Object.entries(sizes)) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1, isMobile: label === 'phone', reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  for (const p of pages) {
    errors.length = 0;
    await page.goto(base + p, { waitUntil: 'networkidle', timeout: 45000 }).catch(() => { /* timeout: take the picture of what loaded */ });
    await page.waitForTimeout(600);
    // the paper texture is fixed to the screen (so visitors never see an edge); a whole-page picture only has one screen of it,
    // so for the picture only, stretch it over the whole page
    if (!fold) await page.addStyleTag({ content: 'html[data-theme="light"] body { position: relative; } html[data-theme="light"] body::before { position: absolute !important; }' });
    const file = `${out}/${nameOf(p)}.${label}.png`;
    await page.screenshot({ path: file, fullPage: !fold });
    // sideways scroll on the page itself is a layout bug on a phone
    const wide = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    console.log(`${file}${wide ? '  (page scrolls sideways)' : ''}${errors.length ? `  errors: ${errors.join(' | ')}` : ''}`);
  }
  await ctx.close();
}
await browser.close();
