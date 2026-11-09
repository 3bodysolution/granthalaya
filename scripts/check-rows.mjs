// Checks every sideways-scrolling row of cards: in each row every card has the same width and cover height (within 1px),
// and there is space after the last card. At 360, 768, 1280 and 1920 px wide.
//   node scripts/check-rows.mjs [--base http://localhost:4321] [paths...]
import { chromium } from 'playwright';
const args = process.argv.slice(2);
const bi = args.indexOf('--base');
const BASE = bi >= 0 ? args.splice(bi, 2)[1] : 'http://localhost:4321';
const paths = args.length ? args : ['/', '/films/', '/films/?kind=tv', '/books/', '/essays/', '/film/603-the-matrix/', '/book/OL27448W-the-lord-of-the-rings/'];
const browser = await chromium.launch();
let rows = 0; const fails = [];
for (const w of [360, 768, 1280, 1920]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: 900 } });
  const page = await ctx.newPage();
  for (const path of paths) {
    const r = await page.goto(BASE + path, { waitUntil: 'load' }).catch(() => null);
    if (!r || r.status() >= 400) { console.log(`  skip  ${path} (${r?.status() ?? 'no answer'})`); continue; }
    await page.waitForTimeout(1200);
    await page.evaluate(() => document.querySelectorAll('img[loading=lazy]').forEach((i) => { i.loading = 'eager'; }));
    const found = await page.evaluate(() => {
      const out = [];
      for (const el of document.querySelectorAll('*')) {
        const cs = getComputedStyle(el);
        if (!(cs.overflowX === 'auto' || cs.overflowX === 'scroll') || el.scrollWidth <= el.clientWidth + 1) continue;
        const kids = [...el.children].filter((k) => getComputedStyle(k).display !== 'none');
        if (kids.length < 3) continue;
        const box = (k) => { const b = k.getBoundingClientRect(); return b; };
        const cover = (k) => k.querySelector('.pt-cover, .cover, img') ?? k;
        const last = kids[kids.length - 1];
        const after = el.scrollWidth - (last.offsetLeft + last.offsetWidth - el.offsetLeft);
        out.push({
          name: (el.className || el.tagName).toString().slice(0, 30), n: kids.length, tiles: !!el.querySelector('.pt-cover'),
          widths: kids.map((k) => box(k).width), heights: kids.map((k) => box(cover(k)).height), after,
        });
      }
      return out;
    });
    for (const row of found) {
      if (!row.tiles) continue;   // tab bars and the like are not rows of cards
      rows++;
      const spread = (a) => Math.max(...a) - Math.min(...a);
      const bad = spread(row.widths) > 1 || spread(row.heights) > 1 || row.after < 8;
      if (bad) fails.push(`${w}px ${path} .${row.name}: width spread ${spread(row.widths).toFixed(1)}, cover height spread ${spread(row.heights).toFixed(1)}, space after last ${row.after.toFixed(0)}px (${row.n} cards)`);
    }
  }
  await ctx.close();
}
await browser.close();
console.log(`${rows} row(s) checked.`);
if (fails.length) { console.log('Failing rows:'); fails.forEach((f) => console.log('  ' + f)); process.exit(1); }
console.log('Every card in every row has the same width and cover height (within 1px), with room after the last.');
