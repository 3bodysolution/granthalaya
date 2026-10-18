// Times the main pages on a running copy of the site and lists the images each one loads.
//   npm run dev            (in another window)
//   npm run time           (or: npm run time -- http://localhost:4321)
// Each page is asked for three times: the first is "cold" (the server's memory of catalogue answers is empty
// if the server was just started), the next two are "warm". Signed out only. Server-Timing lines are printed
// when the server sends them.
const base = (process.argv[2] || 'http://localhost:4321').replace(/\/$/, '');
const pages = [
  ['Home', '/'],
  ['Films', '/films/'],
  ['Books', '/books/'],
  ['A film', '/film/27205-inception/'],
];
const kb = (n) => (n == null ? '?' : n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`);
const ms = (n) => `${Math.round(n)} ms`;

async function visit(path) {
  const t = performance.now();
  const r = await fetch(base + path, { headers: { 'User-Agent': 'granthalaya-time-pages' } });
  const first = performance.now() - t; // headers arrived
  const html = await r.text();
  return { status: r.status, first, total: performance.now() - t, bytes: Buffer.byteLength(html), html, timing: r.headers.get('server-timing') };
}

/** every image on the page: <img> (at once, or lazy) and the day paintings set as CSS backgrounds */
function images(html) {
  const found = new Map();
  for (const m of html.matchAll(/<img\b[^>]*>/g)) {
    const src = m[0].match(/\bsrc="([^"]+)"/)?.[1];
    if (src && !src.startsWith('data:')) found.set(src.replace(/&amp;/g, '&'), /loading="lazy"/.test(m[0]) ? 'lazy' : 'at once');
  }
  for (const m of html.matchAll(/--day:\s*url\(([^)]+)\)/g)) found.set(m[1].replace(/['"]/g, ''), 'at once');
  return [...found].map(([src, when]) => ({ src, when }));
}

async function size(src) {
  try {
    const url = new URL(src, base).href;
    const r = await fetch(url, { method: 'HEAD', redirect: 'follow' });
    const n = Number(r.headers.get('content-length'));
    return n > 0 ? n : null;
  } catch { return null; }
}

for (const [name, path] of pages) {
  console.log(`\n== ${name}  ${path}`);
  let last;
  for (const label of ['cold', 'warm', 'warm']) {
    try {
      last = await visit(path);
      console.log(`${label.padEnd(5)} first byte ${ms(last.first).padStart(8)}   done ${ms(last.total).padStart(8)}   page ${kb(last.bytes)}   status ${last.status}`);
      if (last.timing && label === 'cold') console.log(`      server: ${last.timing}`);
    } catch (e) {
      console.log(`${label.padEnd(5)} failed: ${e.message}`);
    }
  }
  if (!last) continue;
  const list = images(last.html);
  const sized = await Promise.all(list.map(async (i) => ({ ...i, bytes: await size(i.src) })));
  const sum = (w) => sized.filter((i) => i.when === w).reduce((a, i) => a + (i.bytes ?? 0), 0);
  console.log(`images: ${sized.length}   at once ${kb(sum('at once'))}   lazy ${kb(sum('lazy'))}   (sizes the server reports; compressed images may not say)`);
  for (const i of sized.sort((a, b) => (b.bytes ?? 0) - (a.bytes ?? 0)).slice(0, 5)) console.log(`   ${kb(i.bytes).padStart(8)}  ${i.when.padEnd(8)} ${i.src.slice(0, 90)}`);
  const unknown = sized.filter((i) => i.bytes == null).length;
  if (unknown) console.log(`   (${unknown} without a reported size)`);
}
