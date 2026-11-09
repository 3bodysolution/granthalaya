// Tries the full search results page in a real browser and takes pictures into .shots/search-page/:
//   keyboard only: "/" opens the search, typing, Enter opens /search/?q=..., an arrow-key pick opens that result directly, Esc closes, Tab reaches the page;
//   then /search/?q=best%20animated%20movies, ?q=paterson and ?q=मराठी कथा in light and dark, on a phone and a computer.
//   npm run dev (another window), then: node scripts/shots-search-page.mjs [base url]
import { chromium } from 'playwright';
import fs from 'node:fs';
const base = process.argv[2] || 'http://localhost:4321';
fs.mkdirSync('.shots/search-page', { recursive: true });
const browser = await chromium.launch();
let failed = 0;
const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failed++; };

// 1. keyboard only
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  await page.goto(`${base}/films/`, { waitUntil: 'networkidle' }); await page.waitForTimeout(600);
  await page.keyboard.press('/');
  await page.keyboard.type('paterson', { delay: 30 });
  await page.waitForSelector('#search-list .search-all', { timeout: 20000 });
  check(await page.locator('#search-list .search-all').innerText().then((t) => /See all results for “paterson”/.test(t)), 'the last row says See all results for “paterson”');
  check((await page.locator('#search-list [aria-selected="true"]').count()) === 0, 'nothing is highlighted until an arrow key is used');
  await page.keyboard.press('Enter');
  await page.waitForURL(/\/search\/\?q=paterson/, { timeout: 15000 }).catch(() => {});
  check(/\/search\/\?q=paterson/.test(page.url()), 'Enter opens /search/?q=paterson');
  check((await page.locator('input[name=q]').inputValue()) === 'paterson', 'the page search box is filled with the query');
  // Back and refresh keep the page
  await page.goBack(); await page.goForward();
  check(/\/search\/\?q=paterson/.test(page.url()) && (await page.locator('h1, h2').count()) > 0, 'Back then Forward still shows the results');
  await page.reload({ waitUntil: 'domcontentloaded' });
  check((await page.locator('input[name=q]').inputValue()) === 'paterson', 'a refresh keeps the query');
  // an arrow-key pick opens that result directly
  await page.goto(`${base}/films/`, { waitUntil: 'networkidle' }); await page.waitForTimeout(600);
  await page.keyboard.press('/');
  await page.keyboard.type('paterson', { delay: 30 });
  await page.waitForSelector('#search-list [role=option]', { timeout: 20000 });
  await page.keyboard.press('ArrowDown');
  check((await page.locator('#search-list [aria-selected="true"]').count()) === 1, 'ArrowDown picks one result');
  await page.keyboard.press('Enter');
  await page.waitForURL((u) => !/\/films\/$/.test(u.pathname) && !/^\/search\//.test(u.pathname), { timeout: 15000 }).catch(() => {});
  check(!/\/search\//.test(page.url()) && !/\/films\/$/.test(page.url()), `an arrow-key pick opens the result directly (${new URL(page.url()).pathname})`);
  // Esc closes
  await page.goto(`${base}/films/`, { waitUntil: 'networkidle' }); await page.waitForTimeout(600);
  await page.keyboard.press('/');
  await page.keyboard.type('pater', { delay: 30 });
  await page.keyboard.press('Escape');
  check(!(await page.locator('#search').evaluate((d) => d.open)), 'Esc closes the search');
  // Tab on the results page: the box, the button, then the quick links and results
  await page.goto(`${base}/search/?q=paterson`, { waitUntil: 'domcontentloaded' });
  const order = [];
  for (let i = 0; i < 12; i++) { await page.keyboard.press('Tab'); order.push(await page.evaluate(() => document.activeElement?.tagName + ':' + (document.activeElement?.getAttribute('name') || document.activeElement?.textContent?.trim().slice(0, 18) || ''))); }
  console.log('     Tab order:', order.join(' > '));
  check(order.some((o) => o.startsWith('INPUT:q')) || order.some((o) => o.startsWith('BUTTON')), 'Tab reaches the search box or its button');
  check(order.some((o) => o.startsWith('A:')), 'Tab reaches links in the results');
  await page.goto(`${base}/search/?q=paterson`, { waitUntil: 'domcontentloaded' });
  check(await page.locator('meta[name=robots][content=noindex]').count() === 1, 'the page is marked noindex');
  await ctx.close();
}

// 2. pictures
const PAGES = [['best-animated-movies', 'best animated movies'], ['paterson', 'paterson'], ['marathi-stories', 'मराठी कथा']];
for (const [size, viewport] of [['desktop', { width: 1280, height: 900 }], ['phone', { width: 390, height: 844 }]]) {
  for (const theme of ['light', 'dark']) {
    const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1, isMobile: size === 'phone', reducedMotion: 'reduce', colorScheme: theme });
    await ctx.addInitScript((t) => { try { localStorage.setItem('theme', t); } catch {} }, theme);
    const page = await ctx.newPage();
    for (const [name, q] of PAGES) {
      await page.goto(`${base}/search/?q=${encodeURIComponent(q)}`, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
      await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
      await page.waitForFunction(() => [...document.images].filter((im) => im.loading !== 'lazy' || im.getBoundingClientRect().top < innerHeight).every((im) => im.complete), null, { timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(1200);
      await page.screenshot({ path: `.shots/search-page/${name}-${size}-${theme}.png` });
    }
    await ctx.close();
  }
}
await browser.close();
console.log(failed ? `${failed} check(s) failed` : 'all checks passed');
process.exit(failed ? 1 : 0);
