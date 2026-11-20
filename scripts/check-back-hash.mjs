// Back to a page whose address has a # (like /settings/#data or /@sarthak/#profile) shows that page again, with its tab or panel.
// Reaches the page three ways: opened with the # in the address, a # added to an open page (the browser makes the history entry itself,
// the case the router used to ignore), and a # link clicked. Then goes to /about/ and presses Back. Desktop and Pixel 7.
// Usage: node scripts/check-back-hash.mjs [baseUrl] [path=/@sarthak/] [hash=#profile] [selectorThatMustBeVisibleAfterBack]
import { chromium, devices } from 'playwright';
const [base = 'http://localhost:4321', path = '/@sarthak/', hash = '#profile', must = '#profile.is-open'] = process.argv.slice(2);
const b = await chromium.launch();
let bad = 0;
for (const [label, opts] of [['desktop', { viewport: { width: 1280, height: 900 } }], ['Pixel 7', devices['Pixel 7']]]) {
  for (const how of ['opened with #', 'added # to open page', 'clicked # link']) {
    const page = await (await b.newContext(opts)).newPage();
    await page.goto(base + path + (how === 'opened with #' ? hash : ''), { waitUntil: 'load' }); await page.waitForTimeout(800);
    if (how === 'added # to open page') { await page.goto(base + path + hash, { waitUntil: 'load' }); await page.waitForTimeout(500); }
    if (how === 'clicked # link') { await page.evaluate((h) => { const a = document.createElement('a'); a.href = location.pathname + h; a.id = 'zz-hash'; a.textContent = 'x'; document.body.prepend(a); }, hash); await page.evaluate(() => document.getElementById('zz-hash').click()); await page.waitForTimeout(500); }
    await page.evaluate(() => (document.querySelector('a[href="/about/"]')).click()); await page.waitForTimeout(1200);
    const away = await page.evaluate(() => document.title);
    await page.goBack();
    let ok = false, info = '';
    for (let i = 0; i < 40 && !ok; i++) { await page.waitForTimeout(150); info = await page.evaluate((m) => `${location.pathname}${location.hash} | ${document.title} | ${m ? !!document.querySelector(m) : ''}`, must); ok = !info.includes('About |') && (!must || info.endsWith('true')); }
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}, ${how}: (was on "${away.split(' |')[0]}") after Back: ${info}`); if (!ok) bad++;
    await page.close();
  }
}
await b.close();
console.log(bad ? `\n${bad} problem(s)` : '\nAll good.');
process.exit(bad ? 1 : 0);
