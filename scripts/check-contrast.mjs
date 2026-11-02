// Checks text contrast (WCAG: 4.5:1, or 3:1 for large text) against what is really drawn behind each piece of text, in light and dark,
// phone and desktop. The text is hidden, the page is photographed, and the pixels where each word was are compared with its colour (the
// 2nd lightest and darkest percentile, so one speck of paper fibre doesn't count). Text on covers and paintings (busy pixels) is listed apart.
//   npm run dev   (another window)
//   node scripts/check-contrast.mjs [--theme light|dark] [--base http://localhost:4321] /path /path ...
import { chromium } from 'playwright';
import sharp from 'sharp';

const args = process.argv.slice(2);
const take = (f, d) => { const i = args.indexOf(f); return i < 0 ? d : args.splice(i, 2)[1]; };
const base = take('--base', 'http://localhost:4321');
const only = take('--theme', '');
const verbose = args.includes('-v') ? (args.splice(args.indexOf('-v'), 1), true) : false;
const pages = args.length ? args : ['/', '/books/', '/films/', '/about/', '/sponsor/'];

const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

const browser = await chromium.launch();
let bad = 0, checked = 0, busy = 0;
for (const [size, viewport] of [['desktop', { width: 1280, height: 800 }], ['phone', { width: 390, height: 844 }]]) {
  for (const theme of only ? [only] : ['light', 'dark']) {
    const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1, isMobile: size === 'phone', reducedMotion: 'reduce', colorScheme: theme });
    await ctx.addInitScript((t) => { try { localStorage.setItem('theme', t); } catch {} }, theme);
    const page = await ctx.newPage();
    for (const path of pages) {
      await page.goto(base + path, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
      await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
      await page.waitForTimeout(800);
      const total = await page.evaluate(() => document.documentElement.scrollHeight);
      const seen = new Set();
      for (let y = 0; y < total; y += viewport.height - 100) {
        await page.evaluate((v) => window.scrollTo(0, v), y);
        await page.waitForTimeout(250);
        const items = await page.evaluate(() => {
          const out = [];
          const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
          for (let n; (n = w.nextNode());) {
            const el = n.parentElement;
            if (!el || !n.textContent.trim() || ['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(el.tagName)) continue;
            const cs = getComputedStyle(el);
            if (cs.visibility === 'hidden' || cs.display === 'none' || +cs.opacity === 0 || el.closest('[aria-hidden="true"],[hidden],.sr,footer,.valley')) continue;
            const rg = document.createRange(); rg.selectNodeContents(n);
            const r = rg.getBoundingClientRect();
            if (r.width < 2 || r.height < 2 || r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) continue;
            const size = parseFloat(cs.fontSize), bold = +cs.fontWeight >= 700;
            out.push({ t: n.textContent.trim().slice(0, 28), c: cs.color, big: size >= 24 || (size >= 18.66 && bold), x: Math.max(0, r.left), y: Math.max(0, r.top), w: Math.min(r.width, innerWidth - Math.max(0, r.left)), h: Math.min(r.height, innerHeight - Math.max(0, r.top)), sy: scrollY });
          }
          return out;
        });
        const style = await page.addStyleTag({ content: '*, *::before, *::after { color: transparent !important; text-shadow: none !important; -webkit-text-fill-color: transparent !important; caret-color: transparent !important; } img, svg, video { visibility: hidden !important; } ' });
        await page.waitForTimeout(150);
        const { data, info } = await sharp(await page.screenshot()).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
        await style.evaluate((e) => e.remove());
        for (const it of items) {
          const key = `${it.t}|${Math.round(it.x)}|${Math.round(it.y + it.sy)}`;
          if (seen.has(key)) continue;
          seen.add(key);
          const ls = [];
          for (let py = Math.floor(it.y); py < Math.min(info.height, Math.ceil(it.y + it.h)); py++) for (let px = Math.floor(it.x); px < Math.min(info.width, Math.ceil(it.x + it.w)); px++) {
            const i = (py * info.width + px) * 4; ls.push([lum([data[i], data[i + 1], data[i + 2]]), [data[i], data[i + 1], data[i + 2]]]);
          }
          if (!ls.length) continue;
          ls.sort((a, b) => a[0] - b[0]);
          const lo = ls[Math.floor(ls.length * 0.02)][1], hi = ls[Math.floor(ls.length * 0.98)][1];
          const m = it.c.match(/[\d.]+/g).map(Number), a = m[3] ?? 1;
          const blend = (bg) => [0, 1, 2].map((k) => m[k] * a + bg[k] * (1 - a));
          const worst = Math.min(ratio(blend(lo), lo), ratio(blend(hi), hi));
          const need = it.big ? 3 : 4.5;
          // pixels that differ a lot from each other behind one word are a picture, not paper
          if (ratio(lo, hi) > 2.2) { busy++; if (verbose) console.log(`  (over a picture) ${size} ${theme} ${path} "${it.t}"`); continue; }
          checked++;
          if (worst < need) { bad++; console.log(`LOW ${worst.toFixed(2)}:1 (need ${need}) ${size} ${theme} ${path}  "${it.t}"  ${it.c}`); }
        }
      }
    }
    await ctx.close();
  }
}
await browser.close();
console.log(`${checked} pieces of text checked, ${busy} over pictures skipped, ${bad} below the mark`);
process.exit(bad ? 1 : 0);
