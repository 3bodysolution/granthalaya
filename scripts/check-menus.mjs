// Phone filter menus: each list must open right under its own button and stay inside the screen.
//   node scripts/check-menus.mjs [--base http://localhost:4321] [--user sarthak]
// Pixel 7 (chromium) and iPhone 13 (webkit) at 390px, on the shelf, /films/, /books/ and /essays/, with the filter bar not scrolled
// and scrolled to its end. For every part: tap its button, then check the list is under the button (not more than 14px below it),
// inside the screen (12px from each side) and not behind the bottom bar. Pictures go to .shots/filter-menus/.
import { mkdirSync } from 'node:fs';
import { launchDevices, closeAll } from './lib/widthcheck.mjs';

const arg = (k, d) => process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : d;
const BASE = arg('--base', 'http://localhost:4321'), USER = arg('--user', 'sarthak');
const OUT = '.shots/filter-menus'; mkdirSync(OUT, { recursive: true });
const pages = [`/@${USER}/`, '/films/', '/books/', '/essays/'];

const devs = await launchDevices();
let bad = 0, checked = 0;
for (const dev of devs) {
  if (dev.note) console.log(`  NOTE    ${dev.note}`);
  const ctx = await dev.make(390); const page = await ctx.newPage();
  for (const path of pages) {
    await page.goto(BASE + path, { waitUntil: 'load', timeout: 45000 });
    await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
    const n = await page.locator('[data-fpart]').count();
    if (!n) { console.log(`  note    ${dev.name} ${path}: no filter parts on this page`); continue; }
    for (const scrolled of [false, true]) {
      for (let i = 0; i < n; i++) {
        await page.evaluate((s) => { const f = document.querySelector('.filters'); if (f) f.scrollLeft = s ? f.scrollWidth : 0; scrollTo(0, 0); }, scrolled);
        await page.waitForTimeout(200);
        const part = page.locator('[data-fpart]').nth(i);
        await part.locator('.fbtn').tap();
        await page.waitForTimeout(350);
        const m = await page.evaluate((idx) => {
          const part = document.querySelectorAll('[data-fpart]')[idx], b = part.querySelector('.fbtn').getBoundingClientRect(), mn = part.querySelector('.fmenu').getBoundingClientRect();
          const nav = document.querySelector('.bottombar, .tabbar, nav.nav'); const nr = nav ? nav.getBoundingClientRect() : null;
          return { label: part.querySelector('.fbtn').textContent.trim().slice(0, 20), btn: { l: Math.round(b.left), b: Math.round(b.bottom), r: Math.round(b.right) }, menu: { l: Math.round(mn.left), t: Math.round(mn.top), r: Math.round(mn.right), b: Math.round(mn.bottom) }, vw: document.documentElement.clientWidth, vh: innerHeight, navTop: nr ? Math.round(nr.top) : null, visible: getComputedStyle(part.querySelector('.fmenu')).visibility === 'visible' };
        }, i);
        checked++;
        const why = [];
        if (!m.visible) why.push('list did not open');
        if (m.menu.l < 11) why.push(`left edge ${m.menu.l}px is off the screen`);
        if (m.menu.r > m.vw - 11) why.push(`right edge ${m.menu.r}px passes the screen (${m.vw}px)`);
        if (m.menu.t < m.btn.b - 1 || m.menu.t > m.btn.b + 14) why.push(`top ${m.menu.t}px is not under its button (button bottom ${m.btn.b}px)`);
        if (m.menu.l > m.btn.r || m.menu.r < m.btn.l) why.push('list does not sit under its button sideways');
        if (m.navTop && m.menu.b > m.navTop + 2 && m.menu.t < m.navTop) why.push(`list runs behind the bottom bar (${m.menu.b}px > ${m.navTop}px)`);
        const tag = `${dev.name.replace(' ', '')}-${path.replace(/[^a-z0-9]+/gi, '-').slice(1, 20) || 'home'}-${m.label.replace(/\W+/g, '').toLowerCase()}-${scrolled ? 'scrolled' : 'start'}`;
        await page.screenshot({ path: `${OUT}/${tag}.png` });
        console.log(`  ${why.length ? 'FAIL   ' : 'ok     '} ${dev.name} ${path} ${m.label} (bar ${scrolled ? 'scrolled' : 'at start'}): button x ${m.btn.l}-${m.btn.r}, list x ${m.menu.l}-${m.menu.r}, y ${m.menu.t}-${m.menu.b}${why.length ? ' <- ' + why.join('; ') : ''}`);
        if (why.length) bad++;
        await page.mouse.click(5, 5).catch(() => {}); await page.keyboard.press('Escape'); await page.waitForTimeout(150);
        await page.evaluate(() => document.querySelectorAll('[data-fpart].open').forEach((p) => p.classList.remove('open')));
      }
    }
  }
  await ctx.close();
}
await closeAll(devs);
console.log(bad ? `\n${bad} of ${checked} menus are in the wrong place.` : `\nAll ${checked} menus open under their own button and inside the screen.`);
process.exit(bad ? 1 : 0);
