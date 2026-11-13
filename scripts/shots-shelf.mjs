// Pictures of the shelf page: desktop and phone, light and dark; at rest, pointed at, pulled out, profile panel, filter open, reduced motion.
// node scripts/shots-shelf.mjs [--base http://localhost:4321] [--user sarthak]
import { chromium, devices } from 'playwright';
import { mkdirSync } from 'node:fs';
import { checkWidth, phonePages, reportWidth } from './lib/widthcheck.mjs';
const arg = (k, d) => process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : d;
const BASE = arg('--base', 'http://localhost:4321'), USER = arg('--user', 'sarthak');
const OUT = arg('--out', '.shots/shelf'); mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
// Phone width check first: real device profile (Pixel 7), 360px. A page wider than the screen makes a phone zoom out,
// and a screenshot can't show that. Fails loudly, naming the element.
console.log('Phone width check (Pixel 7 and iPhone 13, 360 and 390px):');
const widthBad = reportWidth(await checkWidth(BASE, await phonePages(BASE, USER), { widths: [360, 390] }));
if (widthBad.length) { console.error('\nPAGE TOO WIDE FOR A PHONE. Fix this before looking at pictures.'); await browser.close(); process.exit(1); }
for (const theme of ['light', 'dark']) for (const [dev, vp] of [['desktop', { width: 1280, height: 900 }], ['phone', { width: 390, height: 844 }]]) for (const rm of [false, true]) {
  // the phone is a real device profile (Pixel 7: isMobile, hasTouch, touch user agent), so it zooms out like a phone would
  const ctx = await browser.newContext({ ...(dev === 'phone' ? devices['Pixel 7'] : {}), viewport: vp, colorScheme: theme, reducedMotion: rm ? 'reduce' : 'no-preference' });
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
    // the first book pulled out: its cover must stay inside the shelf
    await page.locator('.book').first().click(); await page.waitForTimeout(1200);
    const inside = await page.evaluate(() => { const st = document.querySelector('.stage').getBoundingClientRect(); const r = document.querySelector('.book.out .right').getBoundingClientRect(); return [Math.round(r.left - st.left), Math.round(st.right - r.right)]; });
    console.log(tag, 'pulled-out cover gap to shelf edges (left, right):', inside);
    await page.screenshot({ path: `${OUT}/out-left-${tag}.png` });
    await page.keyboard.press('Escape'); await page.waitForTimeout(900);
  }
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
  if (!rm) {
    // many books: copy the shelf up to about 400 and check every spine's text reads at 4.5:1 or better
    const bad = await page.evaluate(() => {
      const ul = document.querySelector('[data-shelf-list]'); const li = [...ul.children]; for (let i = 0; i < 400; i++) ul.append(li[i % li.length].cloneNode(true));
      const lum = (c) => { const v = c.match(/\d+/g).slice(0, 3).map((x) => x / 255).map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4)); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; };
      const out = []; document.querySelectorAll('.book').forEach((b) => { const bg = getComputedStyle(b.querySelector('.front')).backgroundColor, fg = getComputedStyle(b).color; const a = lum(bg), z = lum(fg); const r = (Math.max(a, z) + 0.05) / (Math.min(a, z) + 0.05); if (r < 4.5) out.push(b.dataset.title + ' ' + r.toFixed(2)); const h = b.style.getPropertyValue('--c2').trim(); if (/^#[0-9a-f]{6}$/i.test(h)) { const a2 = lum('rgb(' + [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)).join(',') + ')'); const r2 = (Math.max(a2, z) + 0.05) / (Math.min(a2, z) + 0.05); if (r2 < 4.5) out.push(b.dataset.title + ' (wash) ' + r2.toFixed(2)); } }); return [...new Set(out)];
    });
    console.log(tag, 'spines below 4.5:1:', bad.length ? bad : 'none');
    await page.waitForTimeout(500); await page.screenshot({ path: `${OUT}/many-${tag}.png` });
    await page.reload({ waitUntil: 'networkidle' });
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
