// Screenshots of the share window on a phone and a computer: node scripts/shots-share.mjs [port] [path] [out folder]
// Waits until the card has been drawn (the window's own "ready" state) and stops with an error if it says "Couldn't draw the card".
// Needs `npm run dev` running. Pictures go in .shots/share/ (not committed) unless a folder is given.
import { chromium, devices } from 'playwright';
import { mkdirSync } from 'node:fs';
const port = process.argv[2] || '4321', path = process.argv[3] || '/film/603-the-matrix/', out = process.argv[4] || '.shots/share';
mkdirSync(out, { recursive: true });
const b = await chromium.launch();
let bad = false;
for (const [name, ctx] of [['phone', { ...devices['Pixel 7'] }], ['desktop', { viewport: { width: 1280, height: 860 } }]]) {
  const c = await b.newContext(ctx); const p = await c.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  await p.goto(`http://localhost:${port}${path}`, { waitUntil: 'networkidle' });
  await p.locator('[data-share]').first().click();
  const state = await p.waitForFunction(() => { const s = document.getElementById('sh-stage')?.dataset.state; return s === 'ready' || s === 'failed' ? s : false; }, null, { timeout: 30000 }).then((h) => h.jsonValue());
  await p.waitForTimeout(600);
  await p.screenshot({ path: `${out}/share-window-${name}.png` });
  console.log(name, state, 'errors:', errs, 'wa:', await p.getAttribute('#sh-wa', 'href'));
  if (state !== 'ready' || errs.length) bad = true;
  await c.close();
}
await b.close();
if (bad) process.exit(1);
