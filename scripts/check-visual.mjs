// npm run check:visual: before-and-after pictures, so a change can't quietly alter pages it wasn't meant to touch.
//   npm run check:visual -- --before     takes the pictures and keeps them as the baseline (.shots/baseline/)
//   npm run check:visual                 takes them again (.shots/after/), compares with the baseline and lists the pages that
//                                        changed: the percentage of pixels that differ, and a difference image (.shots/diff/)
// Pages: home, /films/, /books/, /essays/, one title page, one entry page and /@sarthak/ (the title and entry are chosen once, in
// --before, and kept in .shots/baseline/pages.json so both runs look at the same ones). Phone (Pixel 7 profile, 390 wide) and
// desktop (1280), light and dark. npm run dev must be running.
// Pages with changing content (the home wall, trending rows) always differ a little; the list says which are over the line
// (--limit 0.5 means 0.5% of pixels) and you decide whether each difference was meant. Exit code 1 when a page is over the line
// or changed size, 0 otherwise.
import { chromium, devices } from 'playwright';
import { PNG } from 'pngjs';
import fs from 'node:fs';
import { phonePages } from './lib/widthcheck.mjs';

const args = process.argv.slice(2);
const opt = (f, d) => { const i = args.indexOf(f); return i < 0 ? d : args[i + 1]; };
const BEFORE = args.includes('--before');
const BASE = opt('--base', 'http://localhost:4321'), USER = opt('--user', 'sarthak');
const LIMIT = parseFloat(opt('--limit', '0.5'));
const BASELINE = '.shots/baseline', AFTER = '.shots/after', DIFF = '.shots/diff';
const OUT = BEFORE ? BASELINE : AFTER;

try { await fetch(BASE + '/', { signal: AbortSignal.timeout(30000) }); } catch { console.log(`Cannot reach ${BASE}. Start it with npm run dev.`); process.exit(1); }

// the seven pages
let pages;
if (BEFORE) {
  const p = await phonePages(BASE, USER); // home, films, books, essays, a film page, a book page, shelf, entry, collections, reviews
  const title = p.find((x) => /^\/(film|tv|book)\//.test(x)), entry = p.find((x) => x.includes('/library/'));
  pages = ['/', '/films/', '/books/', '/essays/', title, entry, `/@${USER}/`].filter(Boolean);
  fs.rmSync(BASELINE, { recursive: true, force: true }); fs.mkdirSync(BASELINE, { recursive: true });
  fs.writeFileSync(`${BASELINE}/pages.json`, JSON.stringify(pages));
} else {
  try { pages = JSON.parse(fs.readFileSync(`${BASELINE}/pages.json`, 'utf8')); } catch { console.log('No baseline yet. Run: npm run check:visual -- --before'); process.exit(1); }
  fs.rmSync(AFTER, { recursive: true, force: true }); fs.rmSync(DIFF, { recursive: true, force: true });
  fs.mkdirSync(AFTER, { recursive: true }); fs.mkdirSync(DIFF, { recursive: true });
}
const slug = (p) => (p === '/' ? 'home' : p.replace(/^\/|\/$/g, '').replace(/[^a-z0-9]+/gi, '-').slice(0, 50));

const browser = await chromium.launch();
const shots = [];
for (const theme of ['light', 'dark']) for (const [dev, ctxOpts] of [
  ['phone', { ...devices['Pixel 7'], viewport: { width: 390, height: 800 }, screen: { width: 390, height: 800 } }],
  ['desktop', { viewport: { width: 1280, height: 900 } }],
]) {
  const ctx = await browser.newContext({ ...ctxOpts, colorScheme: theme, reducedMotion: 'reduce' });
  await ctx.addInitScript((t) => { try { localStorage.setItem('theme', t); } catch {} }, theme);
  const page = await ctx.newPage();
  for (const p of pages) {
    const file = `${dev}-${theme}-${slug(p)}.png`;
    try {
      await page.goto(BASE + p, { waitUntil: 'load', timeout: 45000 });
      await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
      await page.addStyleTag({ content: '*,*::before,*::after{caret-color:transparent!important;animation:none!important;transition:none!important}' });
      // lazy pictures load as the page is scrolled: go down and back, then wait for them
      await page.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 700) { scrollTo(0, y); await new Promise((r) => setTimeout(r, 60)); } scrollTo(0, 0); });
      await page.waitForLoadState('networkidle', { timeout: 6000 }).catch(() => {});
      // settled = every picture finished (or failed) and the page height unchanged for about a second; otherwise two runs of the
      // same page differ only by how much had loaded when the picture was taken
      await page.evaluate(async () => {
        document.querySelectorAll('img[loading=lazy]').forEach((i) => { i.loading = 'eager'; });
        const done = () => [...document.images].every((i) => i.complete);
        let last = -1, still = 0;
        for (let n = 0; n < 60 && still < 4; n++) {
          await new Promise((r) => setTimeout(r, 250));
          const h = document.documentElement.scrollHeight;
          still = h === last && done() ? still + 1 : 0; last = h;
        }
      });
      await page.waitForTimeout(300);
      await page.screenshot({ path: `${OUT}/${file}`, fullPage: true });
      shots.push({ file, p, dev, theme });
    } catch (e) { console.log(`  FAIL    ${file}: ${String(e.message).slice(0, 120)}`); shots.push({ file, p, dev, theme, error: true }); }
  }
  await ctx.close();
}
await browser.close();

if (BEFORE) {
  console.log(`Baseline saved: ${shots.filter((s) => !s.error).length} pictures in ${BASELINE}/ for ${pages.join(', ')}`);
  process.exit(shots.some((s) => s.error) ? 1 : 0);
}

// compare: a pixel counts as different when any colour channel is more than 24 apart (ignores smoothing noise)
let bad = 0, same = 0;
const rows = [];
for (const s of shots) {
  if (s.error) { bad++; continue; }
  const a = `${BASELINE}/${s.file}`;
  if (!fs.existsSync(a)) { rows.push({ ...s, note: 'no baseline picture' }); bad++; continue; }
  const A = PNG.sync.read(fs.readFileSync(a)), B = PNG.sync.read(fs.readFileSync(`${AFTER}/${s.file}`));
  const W = Math.max(A.width, B.width), H = Math.max(A.height, B.height);
  const D = new PNG({ width: W, height: H });
  let diff = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const o = (y * W + x) * 4, inA = x < A.width && y < A.height, inB = x < B.width && y < B.height;
    const ia = inA ? (y * A.width + x) * 4 : -1, ib = inB ? (y * B.width + x) * 4 : -1;
    let d = !(inA && inB);
    if (!d) for (let c = 0; c < 3; c++) if (Math.abs(A.data[ia + c] - B.data[ib + c]) > 24) { d = true; break; }
    if (d) { diff++; D.data[o] = 230; D.data[o + 1] = 30; D.data[o + 2] = 30; D.data[o + 3] = 255; }
    else { const g = inA ? Math.round((A.data[ia] + A.data[ia + 1] + A.data[ia + 2]) / 3) : 255; const v = 255 - (255 - g) * 0.35; D.data[o] = D.data[o + 1] = D.data[o + 2] = v; D.data[o + 3] = 255; }
  }
  const pct = (diff / (W * H)) * 100, resized = A.width !== B.width || A.height !== B.height;
  const over = pct > LIMIT || resized;
  if (diff) fs.writeFileSync(`${DIFF}/${s.file}`, PNG.sync.write(D));
  if (over) bad++; else same++;
  rows.push({ ...s, pct, resized, size: resized ? `${A.width}x${A.height} -> ${B.width}x${B.height}` : '', over });
}
console.log(`\nCompared with ${BASELINE}/ (a page is listed as changed above ${LIMIT}% of pixels, or when its size changed):\n`);
for (const r of rows) {
  if (r.note) { console.log(`  CHANGED ${r.file}: ${r.note}`); continue; }
  console.log(`  ${r.over ? 'CHANGED' : 'same   '} ${r.dev.padEnd(7)} ${r.theme.padEnd(5)} ${r.p.padEnd(44)} ${r.pct.toFixed(2)}%${r.resized ? `  size ${r.size}` : ''}${r.over ? `  -> ${DIFF}/${r.file}` : ''}`);
}
console.log(bad ? `\n${bad} picture(s) changed or missing. Look at each difference image and report every one you did not intend. (Pages with a rotating wall or trending rows differ a little on their own.)` : `\nNo page changed beyond ${LIMIT}%. ${same} compared.`);
process.exit(bad ? 1 : 0);
