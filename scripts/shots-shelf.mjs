// Pictures of the shelf page: desktop and phone, light and dark; at rest, pointed at, pulled out, profile panel, filter open, reduced motion.
// node scripts/shots-shelf.mjs [--base http://localhost:4321] [--user sarthak]
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const arg = (k, d) => process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : d;
const BASE = arg('--base', 'http://localhost:4321'), USER = arg('--user', 'sarthak');
const OUT = '.shots/shelf'; mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
for (const theme of ['light', 'dark']) for (const [dev, vp] of [['desktop', { width: 1280, height: 900 }], ['phone', { width: 390, height: 844 }]]) for (const rm of [false, true]) {
  const ctx = await browser.newContext({ viewport: vp, colorScheme: theme, isMobile: dev === 'phone', hasTouch: dev === 'phone', reducedMotion: rm ? 'reduce' : 'no-preference' });
  await ctx.addInitScript((t) => { try { localStorage.setItem('theme', t); } catch {} }, theme);
  const page = await ctx.newPage();
  const requests = [];
  page.on('request', (r) => { if (/\.(jpe?g|webp|png)|api\/cover/.test(r.url()) && /tmdb|openlibrary|api\/cover|covers/.test(r.url())) requests.push(r.url()); });
  await page.goto(`${BASE}/@${USER}/`, { waitUntil: 'networkidle' });
  const tag = `${dev}-${theme}${rm ? '-reduced' : ''}`;
  const n = await page.locator('.book').count();
  console.log(tag, 'books:', n, '| cover requests before any interaction:', requests.length);
  if (!n) { await ctx.close(); continue; }
  await page.screenshot({ path: `${OUT}/rest-${tag}.png` });
  if (!rm) {
    if (dev === 'desktop') { await page.locator('.book').nth(2).hover(); await page.waitForTimeout(900); await page.screenshot({ path: `${OUT}/point-${tag}.png` }); }
    await page.locator('.book').nth(2).click(); await page.waitForTimeout(1200);
    console.log(tag, 'cover requests after pull-out:', requests.length);
    await page.locator('.stage').scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${OUT}/out-${tag}.png`, fullPage: true });
    await page.keyboard.press('Escape');
  } else {
    await page.locator('.book').nth(2).click(); await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}/out-${tag}.png`, fullPage: true });
  }
  await page.getByRole('button', { name: /view profile/i }).click(); await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/profile-${tag}.png` });
  await page.keyboard.press('Escape');
  if (!rm) {
    const fp = page.locator('.fpart').first();
    if (dev === 'desktop') await fp.hover(); else await fp.locator('.fbtn').click();
    await page.waitForTimeout(400); await page.screenshot({ path: `${OUT}/filter-${tag}.png` }); await page.keyboard.press('Escape'); await page.mouse.click(5, 300);
  }
  await page.mouse.move(0, 0);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)); await page.waitForTimeout(1800);
  await page.screenshot({ path: `${OUT}/bottom-${tag}.png` });
  if (await page.locator('#so-far h2').count()) await page.locator('#so-far').screenshot({ path: `${OUT}/sofar-${tag}.png` });
  await ctx.close();
}
await browser.close();
