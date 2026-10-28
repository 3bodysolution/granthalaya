// Garbled book titles from the shops ("Natsamrat) By V. V. Shirwadkar (Kusumagraj", "Firaq Gorakhpuri )", "Varyane Halate Ran ( ‍ )"):
// a stray bracket, an empty bracket, or "By <author>" written inside the title. Dry run by default.
//   node scripts/clean-titles.mjs            lists every title it would change and what it would become; writes private/catalogues/clean-titles.md
//   node scripts/clean-titles.mjs --write    saves it (only when Sarthak asks; backup first)
// A tail "By <name>" is taken off only when the name is the book's author (its surname is in the title's own creator) or the title also
// has an unmatched bracket; "Stand by Me" and the like are left alone. Slugs are not changed (addresses stay the same).
// Looks at titles.title and shop_books.title. Needs PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY in .env (read here, never printed).
import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';
for (const line of fs.readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z_]+)\s*=\s*"?([^"#]*?)"?\s*(#.*)?$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}
const db = createClient(process.env.PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
const write = process.argv.includes('--write');
const fold = (s) => String(s ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const count = (s, c) => s.split(c).length - 1;
const INVISIBLE = /[​-‍⁠﻿]/g;

/** the cleaned title, or the same one when nothing is wrong */
function clean(title, creator = '') {
  let t = String(title ?? '').replace(INVISIBLE, ' ').replace(/\s+/g, ' ').trim();
  const open = count(t, '('), close = count(t, ')');
  const unmatched = open !== close;
  // "… By V. V. Shirwadkar (Kusumagraj": the tail names the author (or the title is already broken)
  const by = t.match(/\s+by\s+(.+)$/i);
  if (by) {
    const names = fold(by[1]).split(' ').filter((w) => w.length > 2);
    const own = fold(creator).split(' ').filter((w) => w.length > 2);
    if (unmatched || names.some((w) => own.includes(w))) t = t.slice(0, by.index).trim();
  }
  t = t.replace(/\(\s*\)/g, ' ');                       // an empty bracket
  while (count(t, ')') > count(t, '(')) t = t.replace(/\s*\)(?=[^)]*$)/, '');   // a ")" with nothing to close
  while (count(t, '(') > count(t, ')')) t = t.replace(/\s*\((?=[^(]*$)/, ' ');   // a "(" never closed
  t = t.replace(/\s+/g, ' ').replace(/[\s:–-]+$/, '').trim();
  const wrapped = t.match(/^\(([^()]+)\)$/);            // a whole title in brackets: "(Mrudgandh)"
  return wrapped ? wrapped[1].trim() : t;
}
{
  const rows = [];
  for (let f = 0; ; f += 1000) {
    const { data, error } = await db.from('titles').select('id, slug, title, creator').eq('kind', 'book').range(f, f + 999);
    if (error) { console.log(error.message); process.exit(1); }
    rows.push(...data);
    if (data.length < 1000) break;
  }
  const shop = [];
  for (let f = 0; ; f += 1000) {
    const { data } = await db.from('shop_books').select('id, shop, shop_key, title, author').range(f, f + 999);
    shop.push(...(data ?? []));
    if ((data ?? []).length < 1000) break;
  }
  const changes = [
    ...rows.map((r) => ({ table: 'titles', id: r.id, ref: r.slug, was: r.title, now: clean(r.title, r.creator) })),
    ...shop.map((r) => ({ table: 'shop_books', id: r.id, ref: `${r.shop}:${r.shop_key.slice(0, 40)}`, was: r.title, now: clean(r.title, r.author) })),
  ].filter((c) => c.now !== c.was && c.now.length >= 2);
  const kind = (c) => (/\s+by\s+/i.test(c.was) && !/\s+by\s+/i.test(c.now) ? 'by <author> inside' : 'stray or empty bracket');
  const lines = [`# Garbled titles (dry run ${new Date().toLocaleDateString('en-CA')})`, '',
    `${rows.length} book titles and ${shop.length} shop rows looked at. ${changes.length} would change: ${changes.filter((c) => c.table === 'titles').length} in titles, ${changes.filter((c) => c.table === 'shop_books').length} in shop_books.`,
    `By kind: ${['by <author> inside', 'stray or empty bracket'].map((k) => `${changes.filter((c) => kind(c) === k).length} ${k}`).join(', ')}.`, '',
    ...changes.map((c) => `- [${c.table}] ${c.ref}: "${c.was}" → "${c.now}"`)];
  fs.writeFileSync('private/catalogues/clean-titles.md', lines.join('\n'));
  console.log(lines.slice(0, 4).join('\n'));
  console.log(changes.slice(0, 40).map((c) => `[${c.table}] "${c.was}" → "${c.now}"`).join('\n'));
  if (!write) { console.log('\nWritten: private/catalogues/clean-titles.md. Nothing was changed (dry run).'); process.exit(0); }
  let done = 0, errors = 0;
  for (const c of changes) {
    const { error } = await db.from(c.table).update({ title: c.now }).eq('id', c.id);
    if (error) { errors++; console.log(`  ${c.ref}: ${error.message}`); } else done++;
  }
  console.log(`\nSaved: ${done} titles cleaned, ${errors} errors.`);
}
