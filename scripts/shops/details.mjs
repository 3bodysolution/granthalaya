// The shops' own details for the books we already have from them: the page count of the shop's edition, and Akshardhara's back cover.
// Reads only what fetch.mjs already kept (private/catalogues/raw and candidates.json): no new requests to the shops.
//
//   node scripts/shops/details.mjs           dry run: what would be filled, nothing saved
//   node scripts/shops/details.mjs --write   saves it (only when Sarthak asks, and only after 012 is applied)
//
// Pages: Akshardhara's product text says "Pages :742"; BookGanga's book page was read by fetch.mjs. Back cover: Akshardhara's product
// has a second image whose name ends in -b (or B, bb) next to a front image with the same name ending in -f (F, ff). A back cover is
// only taken when both are there; the front picture is not touched. Only empty fields are filled; hidden books and hidden covers are left alone.
// Needs PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY in .env (read here, never printed).
import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';

for (const line of fs.readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z_]+)\s*=\s*"?([^"#]*?)"?\s*(#.*)?$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}
const db = createClient(process.env.PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
const write = process.argv.includes('--write');
const RAW = 'private/catalogues/raw';
const COVER_OK = /^https:\/\/cdn\.shopify\.com\/s\/files\/1\/0800\/1214\/9058\/[\w./%-]+$/;

/* ——— what the shops said ——— */
const strip = (s) => (s ?? '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const pagesOf = (text) => {
  const n = Number((text.match(/(?:\bPages|पृष्ठ(?:ों)?(?:\s*संख्या)?|पाने|पृष्ठे)\s*[:：]\s*(\d{1,5})\b/i) ?? [])[1]);
  return n >= 8 && n <= 5000 ? n : null;
};
const nameOf = (src) => src.split('/').pop().split('?')[0].replace(/\.(jpe?g|png|webp)$/i, '')
  .replace(/_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, '');
const side = (n) => { const m = n.match(/^(.*?)(ff|f|bb|b)$/i); return m && m[1] ? { base: m[1].replace(/[-_ ]+$/, '').toLowerCase(), back: /b$/i.test(m[2]) } : null; };
/** the back cover and whether the pictures come in the wrong order (back first) */
function backOf(images) {
  const named = images.map((src) => ({ src: src.split('?')[0], s: side(nameOf(src)) })).filter((x) => x.s);
  const back = named.find((x) => x.s.back && named.some((y) => !y.s.back && y.s.base === x.s.base));
  if (!back || !COVER_OK.test(back.src)) return null;
  // the shop lists the back first (4 books: two were labelled the wrong way round, one has the same picture twice): looked at by hand, not guessed
  return images[0]?.split('?')[0] === back.src ? { src: null, swapped: true } : { src: back.src, swapped: false };
}

const ak = new Map();   // handle → { pages, back, swapped }
const seen = new Set();
for (const f of fs.readdirSync(RAW).filter((x) => x.endsWith('.json'))) {
  let j; try { j = JSON.parse(fs.readFileSync(`${RAW}/${f}`, 'utf8')); } catch { continue; }
  for (const p of j.products ?? []) {
    if (seen.has(p.handle)) continue;
    seen.add(p.handle);
    const b = backOf((p.images ?? []).map((i) => i.src));
    ak.set(p.handle, { pages: pagesOf(strip(p.body_html)), back: b?.src ?? null, swapped: !!b?.swapped });
  }
}
const bg = new Map();   // book id → pages
for (const r of JSON.parse(fs.readFileSync('private/catalogues/candidates.json', 'utf8'))) if (r.shop === 'bookganga' && r.pages >= 8 && r.pages <= 5000) bg.set(String(r.key), r.pages);
console.log(`Read from the cache: ${ak.size} Akshardhara products (${[...ak.values()].filter((v) => v.pages).length} with pages, ${[...ak.values()].filter((v) => v.back).length} with a back cover), ${bg.size} BookGanga books with pages.`);

/* ——— our shop rows ——— */
let cols = 'id, shop, shop_key, title_id, hidden, cover_hidden, pages, back_src';
let ready = true;
const rows = [];
for (let from = 0; ; from += 1000) {
  let r = await db.from('shop_books').select(cols).range(from, from + 999);
  if (r.error && ready) { ready = false; cols = 'id, shop, shop_key, title_id, hidden, cover_hidden'; r = await db.from('shop_books').select(cols).range(from, from + 999); }
  if (r.error) { console.log('Could not read shop_books:', r.error.message); process.exit(1); }
  rows.push(...r.data);
  if (r.data.length < 1000) break;
}
console.log(`${rows.length} shop rows in the database. ${ready ? '012 is applied.' : '012 is NOT applied yet (pages and back_src do not exist), so this is a plan only.'}`);

const plan = [];
for (const r of rows) {
  if (r.hidden) continue;
  const src = r.shop === 'akshardhara' ? ak.get(r.shop_key) : null;
  const upd = {};
  const pages = r.shop === 'akshardhara' ? src?.pages : bg.get(r.shop_key);
  if (pages && !r.pages) upd.pages = pages;
  if (src?.back && !r.back_src && !r.cover_hidden) upd.back_src = src.back;
  if (Object.keys(upd).length) plan.push({ id: r.id, shop: r.shop, key: r.shop_key, swapped: !!src?.swapped && !!upd.back_src, ...upd });
}
const withPages = plan.filter((p) => p.pages), withBack = plan.filter((p) => p.back_src), swapped = plan.filter((p) => p.swapped);
console.log(`\nWould fill: page counts for ${withPages.length} books (${withPages.filter((p) => p.shop === 'akshardhara').length} Akshardhara, ${withPages.filter((p) => p.shop === 'bookganga').length} BookGanga), back covers for ${withBack.length} books.`);
if (swapped.length) console.log(`${swapped.length} of the back covers are listed first on the shop (the stored front picture may be the back; not changed here): ${swapped.slice(0, 8).map((p) => p.key).join(', ')}`);
console.log('A few back covers:'); withBack.slice(0, 5).forEach((p) => console.log(`  ${p.key}  ${p.back_src}`));
console.log('A few page counts:'); withPages.slice(0, 5).forEach((p) => console.log(`  ${p.shop} ${p.key}: ${p.pages} pages`));
fs.mkdirSync('private/catalogues', { recursive: true });
fs.writeFileSync('private/catalogues/details-plan.json', JSON.stringify(plan, null, 1));
console.log('Plan written to private/catalogues/details-plan.json.');

if (!write) { console.log('\nNothing was changed (dry run; --write saves it).'); process.exit(0); }
if (!ready) { console.log('\nApply supabase/changes/012 first.'); process.exit(1); }
let done = 0, errors = 0;
for (const p of plan) {
  const { id, shop, key, swapped: _s, ...upd } = p;
  const { error } = await db.from('shop_books').update(upd).eq('id', id);
  if (error) { errors++; console.log(`  ${shop} ${key}: ${error.message}`); } else done++;
}
console.log(`\nSaved: ${done} rows updated, ${errors} errors.`);
