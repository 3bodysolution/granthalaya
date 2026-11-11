// Page-width check for phones. A page whose content is wider than the screen makes a real phone (Chrome on Android)
// zoom the whole page out. A cropping test browser never shows that, so this uses a real device profile
// (isMobile + hasTouch) and measures instead of looking.
//   import { checkWidth, phoneContext } from './lib/widthcheck.mjs'
import { chromium, webkit, devices } from 'playwright';

export const PHONE_WIDTHS = [360, 390];
export const PHONE_DEVICES = ['Pixel 7', 'iPhone 13'];

// Opens a browser per device: Pixel 7 in chromium, iPhone 13 in webkit (Safari's engine). If webkit can't run here
// (npx playwright install webkit), the iPhone 13 falls back to chromium with its user agent and says so.
// Returns [{ name, browser, note, make(width, extra) }]; close every browser when done (closeAll).
export async function launchDevices(names = PHONE_DEVICES) {
  const out = [];
  for (const name of names) {
    const d = devices[name]; let browser, note = '';
    if (d.defaultBrowserType === 'webkit') {
      try { browser = await webkit.launch(); } catch (e) {
        browser = await chromium.launch(); note = `webkit can't run here (${String(e.message).slice(0, 160)}), so ${name} is checked in chromium with its user agent. Run: npx playwright install webkit`;
      }
    } else browser = await chromium.launch();
    // the device's own profile (isMobile, hasTouch, user agent) with the width swapped
    const make = (width, extra = {}) => browser.newContext({ ...d, ...(note ? { defaultBrowserType: undefined } : {}), viewport: { width, height: 800 }, screen: { width, height: 800 }, ...extra });
    out.push({ name, browser, note, make });
  }
  return out;
}
export const closeAll = (devs) => Promise.all(devs.map((d) => d.browser.close().catch(() => {})));

// kept for the picture scripts: Pixel 7's profile with the width swapped
export const phoneContext = (browser, width = 360, extra = {}) => {
  const d = devices['Pixel 7'];
  return browser.newContext({ ...d, viewport: { width, height: 800 }, screen: { width, height: 800 }, ...extra });
};

// Returns { scrollWidth, innerWidth, visualWidth, over, offenders: [{ el, right, width }] }.
// Offenders are elements whose right edge is past the screen and which no ancestor clips (overflow-x clip/hidden/auto/scroll).
export async function measure(page, width) {
  return page.evaluate((WANT) => {
    const W = WANT, de = document.documentElement;
    // contained = some ancestor clips (or scrolls) its contents AND that ancestor itself ends inside the screen.
    // An ancestor that clips but is itself too wide (or body, which a phone zooms out for anyway) doesn't count.
    const clipped = (el) => {
      for (let p = el.parentElement; p && p !== document.documentElement && p !== document.body; p = p.parentElement) {
        if (getComputedStyle(p).overflowX !== 'visible' && p.getBoundingClientRect().right <= W + 1) return true;
      }
      return false;
    };
    const name = (el) => el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + [...el.classList].slice(0, 3).map((c) => '.' + c).join('');
    const offenders = [];
    for (const el of document.body.querySelectorAll('*')) {
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.position === 'fixed') continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.right <= W + 1) continue;
      if (clipped(el)) continue;
      // only the outermost: skip an element whose parent is also sticking out
      const pr = el.parentElement?.getBoundingClientRect(); if (el.parentElement && el.parentElement !== document.body && pr.right > W + 1 && getComputedStyle(el.parentElement).display !== 'none') continue;
      offenders.push({ el: name(el), right: Math.round(r.right), width: Math.round(r.width) });
    }
    offenders.sort((a, b) => b.right - a.right);
    return { scrollWidth: de.scrollWidth, bodyScrollWidth: document.body.scrollWidth, innerWidth: window.innerWidth, screenWidth: W, visualWidth: Math.round(window.visualViewport?.width ?? W), over: Math.max(de.scrollWidth, document.body.scrollWidth, window.innerWidth) > W + 1, offenders: offenders.slice(0, 15) };
  }, width);
}

// Loads each path at each width with the Pixel 7 profile. Returns [{ path, width, ...measure }]
export async function checkWidth(base, paths, { widths = PHONE_WIDTHS, devices: names = PHONE_DEVICES } = {}) {
  const devs = await launchDevices(names), out = [];
  for (const dev of devs) {
    for (const width of widths) {
      const ctx = await dev.make(width); const page = await ctx.newPage();
      for (const path of paths) {
        try {
          await page.goto(base + path, { waitUntil: 'load', timeout: 45000 });
          await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
          await page.waitForTimeout(400);
          out.push({ device: dev.name, note: dev.note, path, width, ...(await measure(page, width)) });
        } catch (e) { out.push({ device: dev.name, note: dev.note, path, width, error: String(e.message).slice(0, 160) }); }
      }
      await ctx.close();
    }
  }
  await closeAll(devs);
  return out;
}

// The pages every phone check covers: front pages, a title page of each kind, the shelf, an entry, collections and reviews.
export async function phonePages(base, user = 'sarthak') {
  const first = async (path, re) => { try { const h = await (await fetch(base + path, { signal: AbortSignal.timeout(30000) })).text(); return h.match(re)?.[1]; } catch { return undefined; } };
  const film = await first('/films/', /href="(\/film\/[^"]+)"/), book = await first('/books/', /href="(\/book\/[^"]+)"/);
  const entry = await first(`/@${user}/`, new RegExp(`href="(/@${user}/library/[^"]+)"`));
  return ['/', '/films/', '/books/', '/essays/', film, book, `/@${user}/`, entry, `/@${user}/collections/`, `/@${user}/reviews/`].filter(Boolean);
}

// Prints one line per page and, for a page that is too wide, the elements that stick out. Returns the failures.
export function reportWidth(results, log = console.log) {
  const bad = [], notes = new Set(results.map((r) => r.note).filter(Boolean));
  for (const n of notes) log(`  NOTE    ${n}`);
  for (const r of results) {
    const at = `${r.device} ${r.width}px`;
    if (r.error) { log(`  FAIL    ${r.path} on ${at}: could not load (${r.error})`); bad.push(r); continue; }
    if (r.over) {
      const names = r.offenders.slice(0, 4).map((o) => `${o.el} (right edge ${o.right}px, ${o.width}px wide)`).join('; ') || 'no single element found (check overflow on html/body)';
      log(`  FAIL    ${r.path} on ${at}: page is ${Math.max(r.scrollWidth, r.innerWidth)}px wide, screen is ${r.width}px. A phone would zoom out. Sticking out: ${names}`);
      bad.push(r);
    } else log(`  ok      ${r.path} on ${at}: ${r.scrollWidth}px wide`);
  }
  return bad;
}
