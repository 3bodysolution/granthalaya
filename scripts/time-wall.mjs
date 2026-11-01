// How long until the home page's wall shows covers, on a phone with a Fast 4G connection (DevTools' setting:
// 9 Mbps down, 1.5 Mbps up, 165 ms to the server). Times are from the start of the visit.
//   npm run dev     (another window)
//   node scripts/time-wall.mjs [--base http://localhost:4321] [--runs 3] [--tag after]
// Reports: first cover (one picture in the first screen has loaded), 10 covers, and all covers in the first screen.
import { chromium } from 'playwright';
import { mkdirSync, appendFileSync } from 'node:fs';

const args = process.argv.slice(2);
const take = (f, d) => { const i = args.indexOf(f); return i < 0 ? d : args.splice(i, 2)[1]; };
const base = take('--base', 'http://localhost:4321');
const runs = Number(take('--runs', 3));
const tag = take('--tag', '');

const browser = await chromium.launch();
const rows = [];
for (let r = 0; r < runs; r++) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2.6, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (Linux; Android 13; Pixel 6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36' });
  await ctx.addInitScript(() => {
    window.__t = { first: null, ten: null, all: null, words: null };
    const tick = () => {
      const now = performance.now();
      const h1 = document.querySelector('[data-wall] h1');
      if (h1 && window.__t.words == null && h1.getBoundingClientRect().height > 0) window.__t.words = now;
      const imgs = [...document.querySelectorAll('[data-wall] .wt img')].filter((i) => { const b = i.getBoundingClientRect(); return b.width > 0 && b.right > 0 && b.left < innerWidth && b.top < innerHeight && b.bottom > 0; });
      const done = imgs.filter((i) => i.complete && i.naturalWidth > 0).length;
      if (done >= 1 && window.__t.first == null) window.__t.first = now;
      if (done >= 10 && window.__t.ten == null) window.__t.ten = now;
      if (imgs.length >= 10 && done === imgs.length && window.__t.all == null) { window.__t.all = now; window.__t.count = imgs.length; }
      if (window.__t.all == null) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 165, downloadThroughput: (9 * 1024 * 1024) / 8, uploadThroughput: (1.5 * 1024 * 1024) / 8 });
  let bytes = 0;
  cdp.on('Network.loadingFinished', (e) => { bytes += e.encodedDataLength; });
  await page.goto(base + '/', { waitUntil: 'commit', timeout: 60000 });
  await page.waitForFunction(() => window.__t?.all != null, null, { timeout: 40000 }).catch(() => {});
  const t = await page.evaluate(() => window.__t);
  rows.push({ words: Math.round(t.words ?? NaN), first: Math.round(t.first ?? NaN), ten: Math.round(t.ten ?? NaN), all: Math.round(t.all ?? NaN), count: t.count, kb: Math.round(bytes / 1024) });
  await ctx.close();
}
await browser.close();
const med = (k) => { const v = rows.map((x) => x[k]).filter(Number.isFinite).sort((a, b) => a - b); return v.length ? v[Math.floor(v.length / 2)] : NaN; };
const line = `${tag || 'run'}: words ${med('words')} ms, first cover ${med('first')} ms, 10 covers ${med('ten')} ms, whole first screen (${rows[0]?.count} covers) ${med('all')} ms, ${med('kb')} KB so far (median of ${runs})`;
console.log(rows.map((x) => JSON.stringify(x)).join('\n'));
console.log(line);
mkdirSync('.shots/home-wall', { recursive: true });
appendFileSync('.shots/home-wall/time-wall.txt', line + '\n');
