// Put-back returns a book to exactly its resting look. Shows the shelf at rest, pulls three books out and puts each back,
// shows it again, and requires the two pictures to be the same pixel for pixel (the caption line is hidden, it is meant to differ).
// Three ways: desktop with a mouse, desktop with the keyboard (Enter, then Escape), and the Pixel 7 profile (taps).
// Usage: node scripts/check-shelf-putback.mjs [baseUrl] [/@user/]     Pictures of any difference go to .shots/putback/
import { chromium, devices } from 'playwright';
import { PNG } from 'pngjs';
import fs from 'node:fs';
const base = process.argv[2] || 'http://localhost:4321', path = process.argv[3] || '/@sarthak/';
fs.mkdirSync('.shots/putback', { recursive: true });
const b = await chromium.launch();
let bad = 0;
const hideCaption = '[data-shelf-caption]{visibility:hidden!important} *{caret-color:transparent!important} img{visibility:hidden!important}';
async function shot(page, sl = 0) {
  await page.evaluate((sl) => { document.querySelector('[data-shelf-list]').scrollLeft = sl; }, sl);
  await page.waitForTimeout(1600);   // longer than the slowest fade (the faces' 0.8s wait, 0.3s fade, the turn back)
  return page.locator('.stage').screenshot({ animations: 'disabled' });
}
// tol: the largest colour difference one pixel may have (0 = identical). A pointer resting on a book makes the browser paint its text edges a little differently, so that one check allows edge-sized differences.
function compare(a, c, name, tol = 0) {
  const A = PNG.sync.read(a), C = PNG.sync.read(c);
  if (A.width !== C.width || A.height !== C.height) return `size ${A.width}x${A.height} vs ${C.width}x${C.height}`;
  let n = 0, x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
  const D = new PNG({ width: A.width, height: A.height });
  for (let y = 0; y < A.height; y++) for (let x = 0; x < A.width; x++) {
    const i = (y * A.width + x) * 4;
    const d = Math.max(Math.abs(A.data[i] - C.data[i]), Math.abs(A.data[i + 1] - C.data[i + 1]), Math.abs(A.data[i + 2] - C.data[i + 2]), Math.abs(A.data[i + 3] - C.data[i + 3])) > tol;
    D.data[i] = d ? 255 : A.data[i] >> 2; D.data[i + 1] = d ? 0 : A.data[i + 1] >> 2; D.data[i + 2] = d ? 0 : A.data[i + 2] >> 2; D.data[i + 3] = 255;
    if (d) { n++; x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  }
  if (!n) return '';
  fs.writeFileSync(`.shots/putback/${name}-before.png`, a); fs.writeFileSync(`.shots/putback/${name}-after.png`, c); fs.writeFileSync(`.shots/putback/${name}-diff.png`, PNG.sync.write(D));
  return `${n} pixels differ, in x ${x0}-${x1}, y ${y0}-${y1}`;
}
const state = (page, i) => page.evaluate((i) => {
  const bk = document.querySelectorAll('.book')[i], cs = (e) => e && getComputedStyle(e);
  return { cls: bk.className, li: bk.parentElement.className, sx: bk.style.getPropertyValue('--sx'), transform: cs(bk).transform, filter: cs(bk).filter,
    faces: ['top', 'left', 'right'].map((f) => cs(bk.querySelector('.' + f)).display + '/' + cs(bk.querySelector('.' + f)).opacity).join(' '),
    focus: document.activeElement === bk };
}, i);
async function suite(label, ctxOpts, mode) {
  const ctx = await b.newContext(ctxOpts), page = await ctx.newPage();
  await page.goto(base + path, { waitUntil: 'networkidle' });
  await page.addStyleTag({ content: hideCaption });
  const count = await page.locator('.book').count();
  const picks = [Math.floor(count * 0.15), Math.floor(count * 0.5), Math.floor(count * 0.8)];
  await page.locator('.stage').scrollIntoViewIfNeeded(); await page.waitForTimeout(500);
  const y = await page.evaluate(() => scrollY);
  const sl = await page.evaluate(() => document.querySelector('[data-shelf-list]').scrollLeft);   // where the shelf is scrolled to (phones) is not part of a book's state
  const rest = await shot(page, sl);
  const restStates = [];
  for (const i of picks) restStates.push(await state(page, i));
  for (const i of picks) {
    const bk = page.locator('.book').nth(i);
    await page.evaluate((y) => scrollTo(0, y), y);
    let before = null;
    if (mode === 'keyboard') {
      await bk.focus(); await page.keyboard.press('Shift+Tab'); await page.keyboard.press('Tab');   // reach it by keyboard so the frame shows
      before = await shot(page, sl);   // the book as it looks with keyboard focus on it
      await page.keyboard.press('Enter'); await page.waitForTimeout(1200);
      await page.keyboard.press('Escape');
      await page.evaluate((y) => scrollTo(0, y), y);
      const after = await shot(page, sl);
      const diff = compare(before, after, `${label}-book${i}-vs-focused`);
      console.log(`${diff ? 'FAIL' : 'ok  '} ${label} book ${i}: after Escape it looks as it did with focus on it${diff ? ': ' + diff : ''}`); if (diff) bad++;
      await page.evaluate(() => document.activeElement.blur()); await page.mouse.move(2, 2);
    } else if (mode === 'mouse') {
      await bk.hover(); await page.waitForTimeout(400);
      await bk.click(); await page.waitForTimeout(1200);
      if (i === picks[1]) {
        // put back by clicking the book itself: the pointer is still over it, and it must not look lifted or 3D
        await page.evaluate((y) => scrollTo(0, y), y);
        await bk.click();
        const parked = await shot(page, sl);
        const diff = compare(rest, parked, `${label}-book${i}-pointer-parked`, 96);
        console.log(`${diff ? 'FAIL' : 'ok  '} ${label} book ${i}: put back by clicking it, pointer left over it, looks like rest (edges of text may differ slightly)${diff ? ': ' + diff : ''}`); if (diff) bad++;
      } else await page.locator('[data-d-back]').click();   // the mouse stays over the button, as a person's would
    } else {
      await bk.tap(); await page.waitForTimeout(1200);
      await page.locator('[data-d-back]').tap();
    }
    await page.evaluate((y) => scrollTo(0, y), y);
  }
  // put the pointer and focus away, then it must be the resting picture
  await page.mouse.move(2, 2); await page.evaluate(() => document.activeElement?.blur?.());
  await page.evaluate((y) => scrollTo(0, y), y);
  const after = await shot(page, sl);
  const diff = compare(rest, after, `${label}-shelf`);
  console.log(`${diff ? 'FAIL' : 'ok  '} ${label}: shelf after three put-backs equals the shelf at rest${diff ? ': ' + diff : ''}`); if (diff) bad++;
  for (let k = 0; k < picks.length; k++) {
    const s = await state(page, picks[k]), r = restStates[k];
    const same = JSON.stringify(s) === JSON.stringify(r);
    if (!same) { bad++; console.log(`FAIL ${label} book ${picks[k]}: state differs\n   rest  ${JSON.stringify(r)}\n   after ${JSON.stringify(s)}`); }
  }
  await ctx.close();
}
await suite('desktop-mouse', { viewport: { width: 1280, height: 900 } }, 'mouse');
await suite('desktop-keyboard', { viewport: { width: 1280, height: 900 } }, 'keyboard');
await suite('pixel7', { ...devices['Pixel 7'] }, 'touch');
await b.close();
console.log(bad ? `\n${bad} problem(s)` : '\nAll good.');
process.exit(bad ? 1 : 0);
