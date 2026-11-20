// Poster rows show whole posters only: at several widths, every poster that is visible in a row is fully inside it,
// at the start, after each press of the forward arrow, and at the end (the last set sits against the right edge).
// Usage: node scripts/check-rows-fit.mjs [baseUrl]   (needs the site running)
import { chromium, devices } from 'playwright';
const base = process.argv[2] || 'http://localhost:4321';
const pages = ['/', '/films/', '/books/', '/essays/', '/film/656908-ramayana-rise-of-a-legend/', '/book/ol17930368w-atomic-habits/'];
const widths = [360, 390, 768, 1024, 1280, 1600];
const b = await chromium.launch();
let bad = 0, rows = 0;
const probe = () => [...document.querySelectorAll('[data-row-list]')].map((l, ri) => {
  const lr = l.getBoundingClientRect(), pl = lr.left + 2, pr = lr.right - 2, out = [];
  let vis = 0;
  for (const li of l.children) {
    const r = li.getBoundingClientRect();
    if (r.right > lr.left + 0.5 && r.left < lr.right - 0.5) { vis++; if (r.left < pl - 0.6 || r.right > pr + 0.6) out.push(`poster ${[...l.children].indexOf(li)} at ${r.left.toFixed(1)}..${r.right.toFixed(1)} outside ${pl.toFixed(1)}..${pr.toFixed(1)}`); }
  }
  return { ri, vis, total: l.children.length, out, left: l.scrollLeft, max: l.scrollWidth - l.clientWidth };
});
for (const w of widths) {
  const phone = w <= 390;
  const ctx = await b.newContext(phone ? { ...devices['Pixel 7'], viewport: { width: w, height: 800 }, screen: { width: w, height: 800 } } : { viewport: { width: w, height: 900 } });
  const page = await ctx.newPage();
  for (const p of pages) {
    await page.goto(base + p, { waitUntil: 'networkidle' }).catch(() => {});
    await page.waitForTimeout(600);
    const n = await page.evaluate(() => document.querySelectorAll('[data-row-list]').length);
    if (!n) { console.log(`  -     ${w} ${p}: no rows`); continue; }
    const settle = async () => { let last = ''; for (let i = 0; i < 40; i++) { await page.waitForTimeout(120); const now = await page.evaluate(() => [...document.querySelectorAll('[data-row-list]')].map((l) => l.scrollLeft).join()); if (now === last) return; last = now; } };
    const check = async (stage) => {
      for (const r of await page.evaluate(probe)) { if (r.out.length) { bad++; console.log(`FAIL ${w} ${p} row ${r.ri} ${stage}: ${r.out.join('; ')}`); } }
    };
    await check('start'); rows += n;
    for (let step = 0; step < 40; step++) {
      // forward by the arrow (a click, as a mouse would) on each row that can still move; on phones a swipe-like jump of one screen
      const moved = await page.evaluate(() => { let m = 0; document.querySelectorAll('[data-row-list]').forEach((l) => { const f = l.closest('.prow').querySelector('[data-row="1"]'); if (f && !f.disabled) { f.click(); m++; } else if (f && l.scrollLeft + l.clientWidth < l.scrollWidth - 4) { l.scrollBy({ left: l.clientWidth * 0.95 }); m++; } }); return m; });
      if (!moved) break;
      await settle();
      await check(`after arrow ${step + 1}`);
    }
    const ends = await page.evaluate(probe);
    for (const r of ends) if (r.max > 4 && r.left < r.max - 1.5) { bad++; console.log(`FAIL ${w} ${p} row ${r.ri}: did not reach the end (${r.left} of ${r.max})`); }
    const sizes = await page.evaluate(() => { const l = document.querySelector('[data-row-list]'); return l ? `${getComputedStyle(l).getPropertyValue('--col')} / ${getComputedStyle(l).getPropertyValue('--gap')}` : ''; });
    console.log(`  ok?   ${w} ${p}: ${n} rows, first row col/gap ${sizes}`);
  }
  await ctx.close();
}
await b.close();
console.log(bad ? `\n${bad} problem(s)` : `\nAll good: ${rows} rows at ${widths.join(', ')} px, every visible poster whole.`);
process.exit(bad ? 1 : 0);
