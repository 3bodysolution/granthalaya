// Pictures of the dropdown (TV season picker): closed and open, light and dark, desktop and phone. node scripts/shots-dropdown.mjs [--base ...] [--path /tv/...]
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const arg = (k, d) => process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : d;
const BASE = arg('--base', 'http://localhost:4321'), PATH = arg('--path', '/tv/1396-breaking-bad/');
const OUT = '.shots/dropdown'; mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
for (const theme of ['light', 'dark']) for (const [dev, vp] of [['desktop', { width: 1280, height: 900 }], ['phone', { width: 390, height: 844 }]]) {
  const ctx = await browser.newContext({ viewport: vp, colorScheme: theme, isMobile: dev === 'phone', hasTouch: dev === 'phone' });
  await ctx.addInitScript((t) => { try { localStorage.setItem('theme', t); } catch {} }, theme);
  const page = await ctx.newPage();
  await page.goto(BASE + PATH, { waitUntil: 'networkidle' });
  const dd = page.locator('[data-dd]').first();
  if (!(await dd.count())) { console.log(theme, dev, 'no dropdown on this page'); await ctx.close(); continue; }
  await dd.scrollIntoViewIfNeeded();
  const clip = async (name) => { await page.waitForTimeout(250); await page.screenshot({ path: `${OUT}/${name}-${dev}-${theme}.png` }); };
  await clip('closed');
  await dd.locator('[data-dd-btn]').click();
  await clip('open');
  if (dev === 'desktop' && theme === 'light') {
    // keyboard: Escape returns focus, arrows + Enter pick, change fires
    await page.keyboard.press('Escape');
    console.log('after Escape: focus on trigger =', await page.evaluate(() => document.activeElement?.matches('[data-dd-btn]')));
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
    console.log('picked:', await page.evaluate(() => [document.querySelector('[data-season-pick]').value, document.querySelector('[data-dd-cur]').textContent, [...document.querySelectorAll('[data-season-panel]')].filter(p => !p.hidden).length]));
  }
  await ctx.close();
}
await browser.close();
