// Pictures of the home page's wall of covers, and a check that the words read (WCAG 4.5:1), light and dark, phone and desktop.
//   npm run dev     (another window)
//   node scripts/shots-wall.mjs [--out .shots/home-wall] [--base http://localhost:4321] [--both-phone]
// --both-phone also takes the phone with ?wall=fade (the words over a stronger fade), to compare.
// Contrast: the words are hidden, the pixels where they were are read from the picture, and each word's colour is compared with the
// lightest and the darkest of those pixels (the worst case).
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import sharp from 'sharp';

const args = process.argv.slice(2);
const take = (f, d) => { const i = args.indexOf(f); return i < 0 ? d : args.splice(i, 2)[1]; };
const out = take('--out', '.shots/home-wall');
const base = take('--base', 'http://localhost:4321');
const both = args.includes('--both-phone');
mkdirSync(out, { recursive: true });

const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const rgb = (s) => s.match(/[\d.]+/g).slice(0, 3).map(Number);


const browser = await chromium.launch();
let bad = 0;
for (const [size, viewport] of [['desktop', { width: 1440, height: 900 }], ['phone', { width: 390, height: 844 }]]) {
  for (const theme of ['light', 'dark']) {
    for (const variant of size === 'phone' && both ? ['above', 'fade'] : ['above']) {
      const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1, isMobile: size === 'phone', reducedMotion: 'reduce', colorScheme: theme });
      await ctx.addInitScript((t) => { try { localStorage.setItem('theme', t); } catch {} }, theme);
      const page = await ctx.newPage();
      await page.goto(base + (variant === 'fade' ? '/?wall=fade' : '/'), { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
      await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
            await page.waitForFunction(() => document.querySelectorAll('[data-wall] img.in').length > 5, null, { timeout: 30000 }).catch(() => console.log('wall did not fill'));
      await page.waitForTimeout(1500);
      const hero = page.locator('[data-wall]');
      const name = `${size}-${theme}${variant === 'fade' ? '-fade' : ''}`;
      await hero.screenshot({ path: `${out}/${name}.png` });
      // contrast
      const words = await page.evaluate(() => [...document.querySelectorAll('[data-wall] .words h1, [data-wall] .words .sub, [data-wall] .words .free, [data-wall] .credit:not([hidden])')].map((e) => {
        const rg = document.createRange(); rg.selectNodeContents(e); const r = rg.getBoundingClientRect(), h = document.querySelector('[data-wall]').getBoundingClientRect();
        return { name: e.className || e.tagName, color: getComputedStyle(e).color, x: r.left - h.left, y: r.top - h.top, w: r.width, h: r.height };
      }));
      await page.addStyleTag({ content: '[data-wall] .words > *, [data-wall] .credit { visibility: hidden !important; }' });
      await page.waitForTimeout(200);
      const { data: pix, info } = await sharp(await hero.screenshot()).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      const png = { data: pix, width: info.width, height: info.height };
      for (const w of words) {
        let lo = [255, 255, 255], hi = [0, 0, 0];
        const x1 = Math.min(png.width, Math.ceil(w.x + w.w)), y1 = Math.min(png.height, Math.ceil(w.y + w.h));
        for (let y = Math.max(0, Math.floor(w.y)); y < y1; y++) for (let x = Math.max(0, Math.floor(w.x)); x < x1; x++) {
          const i = (y * png.width + x) * 4, p = [png.data[i], png.data[i + 1], png.data[i + 2]];
          if (lum(p) < lum(lo)) lo = p;
          if (lum(p) > lum(hi)) hi = p;
        }
        if (x1 <= w.x || y1 <= w.y) console.log('  (no pixels)', w, png.width, png.height);
        const c = rgb(w.color), worst = Math.min(ratio(c, lo), ratio(c, hi));
        if (worst < 4.5) bad++;
        console.log(`${name.padEnd(18)} ${String(w.name).slice(0, 14).padEnd(14)} worst ${worst.toFixed(1)}:1 ${worst < 4.5 ? 'TOO LOW' : 'ok'}`);
      }
      await ctx.close();
    }
  }
}
await browser.close();
console.log(bad ? `${bad} below 4.5:1` : 'all words 4.5:1 or better');
process.exit(bad ? 1 : 0);
