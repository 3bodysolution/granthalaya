// Which shop covers have a plain white frame, and what they look like trimmed (src/lib/cards/trim.ts). Changes nothing.
//   node scripts/shops/trim-check.mjs              looks at every shop cover we use; prints counts and writes
//                                                  private/catalogues/trim/<n>-before-after.png for a few, plus sheet.png of all that were trimmed
//   node scripts/shops/trim-check.mjs --show=3     how many before/after examples to write (default 3)
// Covers are asked for at 600 pixels wide, one at a time with a short pause, and kept in private/catalogues/raw/covers (git-ignored).
import fs from 'node:fs';
import crypto from 'node:crypto';
import sharp from 'sharp';
import { createClient } from '@supabase/supabase-js';
import { trimFrame } from '../../src/lib/cards/trim.ts';

for (const line of fs.readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z_]+)\s*=\s*"?([^"#]*?)"?\s*(#.*)?$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}
const db = createClient(process.env.PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
const show = Number((process.argv.find((a) => a.startsWith('--show=')) ?? '--show=3').slice(7));
const RAW = 'private/catalogues/raw/covers', OUT = 'private/catalogues/trim';
fs.mkdirSync(RAW, { recursive: true }); fs.mkdirSync(OUT, { recursive: true });

const rows = [];
for (let from = 0; ; from += 1000) {
  const { data, error } = await db.from('shop_books').select('shop, shop_key, cover_src, title, original_title, hidden, cover_hidden').not('cover_src', 'is', null).range(from, from + 999);
  if (error) { console.log(error.message); process.exit(1); }
  rows.push(...data);
  if (data.length < 1000) break;
}
const mine = rows.filter((r) => !r.hidden && !r.cover_hidden && r.shop === 'akshardhara');
console.log(`${mine.length} Akshardhara covers in use (BookGanga's are not framed in the same way and are left alone).`);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function cover(src) {
  const url = `${src}?width=600`;
  const file = `${RAW}/${crypto.createHash('sha1').update(url).digest('hex').slice(0, 16)}.jpg`;
  if (fs.existsSync(file)) return fs.readFileSync(file);
  await sleep(250);
  const r = await fetch(url, { headers: { 'User-Agent': 'Granthalaya/1.0 (book catalogue, with permission; contact kokanesarthak52@gmail.com)' } }).catch(() => null);
  if (!r?.ok) return null;
  const b = Buffer.from(await r.arrayBuffer());
  fs.writeFileSync(file, b);
  return b;
}

const done = [];
let looked = 0;
for (const r of mine) {
  const b = await cover(r.cover_src);
  if (!b) continue;
  looked++;
  const t = await trimFrame(b).catch(() => null);
  if (t) done.push({ r, b, t });
}
console.log(`Looked at ${looked}: ${done.length} have a plain white frame that would be trimmed (${(100 * done.length / Math.max(1, looked)).toFixed(1)}%).`);
const shrink0 = done.map((d) => 1 - (d.t.box.width * d.t.box.height) / (d.t.from.width * d.t.from.height));
const shrink = done.map((d) => 1 - (d.t.box.width * d.t.box.height) / (d.t.from.width * d.t.from.height));
if (done.length) console.log(`Share of the image removed: median ${(100 * shrink.sort((a, b) => a - b)[Math.floor(shrink.length / 2)]).toFixed(0)}%, most ${(100 * Math.max(...shrink)).toFixed(0)}%. New shapes (width / height): ${[...new Set(done.map((d) => (d.t.box.width / d.t.box.height).toFixed(2)))].slice(0, 8).join(', ')} (a tile is 0.67).`);

const H = 520;
const pair = async (d) => {
  const a = await sharp(d.b).resize({ height: H }).toBuffer(), c = await sharp(d.t.body).resize({ height: H }).toBuffer();
  const ma = await sharp(a).metadata(), mc = await sharp(c).metadata();
  return sharp({ create: { width: ma.width + mc.width + 30, height: H, channels: 3, background: '#2a2a2a' } }).composite([{ input: a, left: 0, top: 0 }, { input: c, left: ma.width + 30, top: 0 }]).png().toBuffer();
};
// the examples: the first few in the order of our lists (the shop's best sellers), then a contact sheet of all that were trimmed
const names = [];
for (const [i, d] of done.slice(0, show).entries()) {
  const f = `${OUT}/example-${i + 1}.png`;
  fs.writeFileSync(f, await pair(d));
  names.push(`${f}  ${d.r.original_title || d.r.title} (${d.r.shop_key})`);
}
// the one that lost the most is looked at too
const big = done.map((d, i) => [shrink0[i], d]).sort((a, b) => b[0] - a[0])[0];
if (big) { fs.writeFileSync(`${OUT}/biggest-cut.png`, await pair(big[1])); names.push(`${OUT}/biggest-cut.png  (the biggest cut, ${(100 * big[0]).toFixed(0)}%) ${big[1].r.original_title || big[1].r.title}`); }
console.log(names.join('\n'));
const cell = 150, cols = 10, rowsN = Math.ceil(done.length / cols);
if (done.length) {
  const comp = await Promise.all(done.map(async (d, i) => ({ input: await sharp(d.t.body).resize({ width: cell, height: Math.round(cell * 1.5), fit: 'contain', background: '#2a2a2a' }).toBuffer(), left: (i % cols) * (cell + 6), top: Math.floor(i / cols) * (Math.round(cell * 1.5) + 6) })));
  await sharp({ create: { width: cols * (cell + 6), height: rowsN * (Math.round(cell * 1.5) + 6), channels: 3, background: '#2a2a2a' } }).composite(comp).jpeg({ quality: 80 }).toFile(`${OUT}/sheet.jpg`);
  console.log(`Contact sheet of every trimmed cover: ${OUT}/sheet.jpg`);
}
