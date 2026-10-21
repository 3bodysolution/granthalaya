// Screenshots of the share window on a phone and a computer: node scripts/shots-share.mjs [port] [path]
import { chromium, devices } from 'playwright';
const port = process.argv[2] || '4321', path = process.argv[3] || '/film/603-the-matrix/';
const b = await chromium.launch();
for (const [name, ctx] of [['phone', { ...devices['Pixel 7'] }], ['desktop', { viewport: { width: 1280, height: 860 } }]]) {
  const c = await b.newContext(ctx); const p = await c.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(`http://localhost:${port}${path}`, { waitUntil: 'networkidle' });
  await p.locator('[data-share]').first().click();
  await p.waitForSelector('.sh-slide.ready', { timeout: 30000 });
  await p.waitForTimeout(1500);
  await p.screenshot({ path: `.shots/batch4/share-window-${name}.png` });
  // swipe/next to another background
  if (name === 'desktop') { await p.click('#sh-next'); await p.waitForSelector('.sh-slide.ready:nth-child(n+2)'); await p.waitForTimeout(600); await p.screenshot({ path: `.shots/batch4/share-window-${name}-next.png` }); }
  console.log(name, 'errors:', errs, 'wa:', await p.getAttribute('#sh-wa', 'href'));
  await c.close();
}
await b.close();
