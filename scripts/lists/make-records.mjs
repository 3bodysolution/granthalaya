// Makes our own catalogue record (a row in `titles`) for every book in src/data/lists/*.json that Open Library
// and Google Books don't have, so its tile opens a real page that can be saved. Writes `slug` onto each item
// (or `ol` when the book is already in our catalogue with an Open Library key).
//
//   node scripts/lists/make-records.mjs          do it
//   node scripts/lists/make-records.mjs --dry    only show what it would do
//
// Needs PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY in .env (the same admin access as scripts/migrate.mjs), and
// supabase/changes/002-title-original-and-note.sql run once. Safe to run again: items with a slug are skipped,
// and a record with the same title and author is reused, never duplicated. The records are marked
// source = 'Granthalaya lists', so the book page never searches Open Library for them.
import fs from 'node:fs';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createClient } from '@supabase/supabase-js';

try {
  for (const line of fs.readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*"?([^"#]*?)"?\s*(#.*)?$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
} catch {}
const dry = process.argv.includes('--dry');
const url = process.env.PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SECRET_KEY;
if (!url || !key) { console.log('Add PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY to .env first.'); process.exit(1); }
const db = createClient(url, key, { auth: { persistSession: false } });
const LIST_SOURCE = 'Granthalaya lists';
const DIR = 'src/data/lists';
const COVER_HOSTS = /^https:\/\/(image\.tmdb\.org\/|covers\.openlibrary\.org\/|books\.google\.com\/books\/content\?)/;

for (const c of ['original_title', 'language', 'note']) {
  const { error } = await db.from('titles').select(c).limit(1);
  if (error) { console.log(`The titles table has no "${c}" column yet. Run supabase/changes/002-title-original-and-note.sql in Supabase → SQL Editor, then run this again.`); process.exit(1); }
}

const slugify = (s) =>
  s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/['’]/g, '').replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 70).replace(/-+$/, '') || 'untitled';
const norm = (s) => (s ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/&/g, ' and ').replace(/^(the|a|an)\s+/, '').replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ').trim();
const surname = (c) => norm(c).split(' ').filter((w) => w.length > 2).pop() ?? '';
const sameAuthor = (a, b) => !!a && !!b && (norm(a) === norm(b) || (surname(a) && surname(a) === surname(b)));

const { data: books, error: readErr } = await db.from('titles').select('id, slug, title, creator, ol_key').eq('kind', 'book');
if (readErr) { console.log('Could not read the catalogue:', readErr.message); process.exit(1); }
const known = [...books];
const slugs = new Set((await db.from('titles').select('slug')).data?.map((r) => r.slug));
const findKnown = (it) => known.find((r) => norm(r.title) === norm(it.title) && (!it.creator || sameAuthor(r.creator, it.creator)));

function freeSlug(it) {
  const base = slugify(it.title), by = surname(it.creator).replace(/\s+/g, '-');
  const tries = [base, by ? `${base}-${slugify(by)}` : null, ...Array.from({ length: 20 }, (_, i) => `${base}-${i + 2}`)].filter(Boolean);
  return tries.find((s) => !slugs.has(s)) ?? `${base}-${Date.now().toString(36)}`;
}

let created = 0, reused = 0, failed = 0;
for (const f of readdirSync(DIR).filter((f) => f.endsWith('.json'))) {
  const path = join(DIR, f);
  const list = JSON.parse(fs.readFileSync(path, 'utf8'));
  if (list.kind !== 'book') continue;
  let changed = false;
  for (const it of list.items) {
    if (it.ol || it.gb || it.slug) continue;
    const have = findKnown(it);
    if (have) {
      if (have.ol_key) it.ol = have.ol_key; else it.slug = have.slug;
      reused++; changed = true; continue;
    }
    const row = {
      kind: 'book', slug: freeSlug(it), title: it.title, original_title: it.original_title ?? null, creator: it.creator ?? '',
      // a prize list's year is the prize's, not the year the book came out; only the classics lists know that
      year: list.slug.endsWith('-classics') && it.year >= 0 && it.year <= 2100 ? it.year : null,
      language: it.language ?? null, note: it.note ?? null,
      cover_url: it.cover && COVER_HOSTS.test(it.cover) ? it.cover : null,
      source: LIST_SOURCE, created_by: null,
    };
    if (dry) { console.log(`would add: ${row.slug}`); slugs.add(row.slug); known.push({ ...row, id: null, ol_key: null }); created++; it.slug = row.slug; changed = true; continue; }
    const { data, error } = await db.from('titles').insert(row).select('id, slug, title, creator, ol_key').single();
    if (error || !data) { failed++; console.log(`failed: ${it.title} (${error?.message})`); continue; }
    slugs.add(data.slug); known.push(data);
    it.slug = data.slug; created++; changed = true;
  }
  if (changed && !dry) fs.writeFileSync(path, JSON.stringify(list, null, 2) + '\n');
}
console.log(`${dry ? 'Would create' : 'Created'} ${created} records, reused ${reused} that were already in the catalogue${failed ? `, ${failed} failed` : ''}.`);
