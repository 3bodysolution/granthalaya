// Pictures and checks for the spoiler line, text-field colours and in-place comments.
//   node scripts/shots-reviews.mjs [--base http://localhost:4321] [--path /zz-demo/] [--out .shots/reviews]
// Needs a page with a spoiler review and a comment box (a temporary demo page works). The comment API is faked here,
// so nothing is written to the database.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const BASE = opt('--base', 'http://localhost:4321'), PATH = opt('--path', '/zz-demo/'), OUT = opt('--out', '.shots/reviews');
mkdirSync(OUT, { recursive: true });

const lum = (rgb) => { const [r, g, b] = rgb.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const parse = (c) => c.match(/[\d.]+/g).slice(0, 3).map(Number);

const browser = await chromium.launch();
let bad = 0;
const check = (ok, what) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${what}`); if (!ok) bad++; };

for (const theme of ['light', 'dark']) {
  for (const [dev, vp] of [['desktop', { width: 1280, height: 900 }], ['phone', { width: 390, height: 844 }]]) {
    console.log(`\n${theme} ${dev}`);
    const ctx = await browser.newContext({ viewport: vp, colorScheme: theme, isMobile: dev === 'phone', hasTouch: dev === 'phone' });
    await ctx.addInitScript((t) => { try { localStorage.setItem('theme', t); } catch {} }, theme);
    const page = await ctx.newPage();
    let mode = 'ok';
    await page.route('**/api/review', async (route) => {
      if (route.request().method() === 'POST') {
        await new Promise((r) => setTimeout(r, 400));
        if (mode === 'fail') return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Couldn’t post that comment.' }) });
        return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, comment: { id: 'c-new', date: new Date().toISOString(), body: 'x' } }) });
      }
      return route.fulfill({ contentType: 'application/json', body: '{"ok":true}' });
    });
    await page.goto(BASE + PATH, { waitUntil: 'networkidle' });
    await page.evaluate((t) => { document.documentElement.dataset.theme = t; }, theme);

    // 1. spoilers
    const visible = await page.evaluate(() => document.body.innerText);
    check(!visible.includes('butler did it') && !visible.includes('Contains spoilers'), 'review text is not on the page, no "Contains spoilers" label');
    check(visible.includes('This review gives away the story.') && visible.includes('Read it anyway'), 'quiet line and button shown');
    check(await page.locator('.review, #r1').first().locator('[aria-label*="Like"], [data-like]').count() > 0, 'like button still visible');
    await page.screenshot({ path: `${OUT}/${theme}-${dev}-1-hidden.png` });
    const btn = page.locator('[data-spoiler-open]');
    check((await btn.getAttribute('aria-expanded')) === 'false', 'button starts aria-expanded=false');
    await btn.focus(); await page.keyboard.press('Enter');
    const after = await page.evaluate(() => document.body.innerText);
    check(after.includes('butler did it') && !after.includes('Read it anyway'), 'keyboard opens it in place');
    check(page.url().includes(PATH), 'no navigation');
    await page.screenshot({ path: `${OUT}/${theme}-${dev}-2-revealed.png` });

    // 2. colours
    const ta = page.locator('form[data-comment] textarea');
    const plain = page.locator('input.plain');
    for (const [name, el] of [['comment box', ta], ['plain input', plain]]) {
      const c = await el.evaluate((e) => { const s = getComputedStyle(e), p = getComputedStyle(e, '::placeholder'); return { bg: s.backgroundColor, fg: s.color, ph: p.color, caret: s.caretColor, border: s.borderTopColor }; });
      const bg = parse(c.bg);
      check(ratio(parse(c.fg), bg) >= 7, `${name}: text ${c.fg} on ${c.bg} = ${ratio(parse(c.fg), bg).toFixed(1)}:1`);
      check(ratio(parse(c.ph), bg) >= 4.5, `${name}: placeholder ${c.ph} = ${ratio(parse(c.ph), bg).toFixed(1)}:1`);
      check(ratio(parse(c.caret), bg) >= 4.5, `${name}: caret ${c.caret} = ${ratio(parse(c.caret), bg).toFixed(1)}:1`);
      await el.focus();
      const f = await el.evaluate((e) => getComputedStyle(e).borderTopColor);
      check(ratio(parse(f), bg) >= 3, `${name}: focus border ${f} = ${ratio(parse(f), bg).toFixed(1)}:1`);
    }
    await ta.focus();
    await page.screenshot({ path: `${OUT}/${theme}-${dev}-3-fields.png` });

    // 3. comments in place
    await page.evaluate(() => { window.__same = 1; });
    await ta.fill('A first comment from the test');
    await ta.scrollIntoViewIfNeeded();
    const y0 = await page.evaluate(() => scrollY);
    mode = 'fail';
    await page.locator('form[data-comment] button[type=submit]').click();
    check((await page.locator('form[data-comment] button[type=submit]').innerText()).includes('Posting'), 'button says Posting… and is disabled');
    check(await page.locator('form[data-comment] button[type=submit]').isDisabled(), 'Post disabled while sending');
    await page.waitForSelector('.cerr:not([hidden])');
    check((await ta.inputValue()) === 'A first comment from the test', 'on failure the text stays in the field');
    await page.screenshot({ path: `${OUT}/${theme}-${dev}-4-error.png` });
    mode = 'ok';
    const count0 = await page.locator('.clist > li').count();
    await page.locator('form[data-comment] button[type=submit]').click();
    await page.waitForFunction((n) => document.querySelectorAll('.clist > li').length === n + 1, count0);
    const y1 = await page.evaluate(() => scrollY);
    check(await page.evaluate(() => window.__same === 1), 'page not reloaded');
    check(Math.abs(y1 - y0) < 4, `scroll kept (${y0} -> ${y1})`);
    check((await ta.inputValue()) === '', 'field cleared');
    const last = page.locator('.clist > li').last();
    check((await last.innerText()).includes('Test Reader') && (await last.innerText()).includes('just now') && (await last.innerText()).includes('A first comment'), 'new comment shows name, "just now" and text');
    check((await page.locator('details.cmt > summary .num').innerText()) === '2', 'comment count is 2');
    check(await last.locator('.face-l').innerText() === 'T', 'photo letter shown');
    check(await page.evaluate(() => document.activeElement?.matches('button[type=submit]')), 'focus stays on Post');
    await page.screenshot({ path: `${OUT}/${theme}-${dev}-5-posted.png` });
    // delete it
    await last.locator('[data-uncomment]').click();
    await page.locator('#confirm-ok').click();
    await page.waitForFunction((n) => document.querySelectorAll('.clist > li').length === n, count0);
    check((await page.locator('details.cmt > summary .num').innerText()) === '1', 'delete: count back to 1, no reload');
    check(await page.evaluate(() => window.__same === 1), 'page still not reloaded');
    await ctx.close();
  }
}
await browser.close();
console.log(bad ? `\n${bad} check(s) failed.` : '\nAll checks passed.');
process.exit(bad ? 1 : 0);
