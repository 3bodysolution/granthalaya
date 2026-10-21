// Fills in missing runtimes (films from TMDB, TV seasons from TMDB's episode lengths) and page counts
// (books from Open Library) on the shared `titles` rows, so the Stats page can count real hours and pages.
//
//   node scripts/fill-runtimes.mjs            dry run: looks everything up, prints what it would change, writes nothing
//   node scripts/fill-runtimes.mjs --write    saves the changes (only when Sarthak asks for it in that message)
//
// Only empty `runtime` / `pages` are filled; a number already there is never replaced. Needs PUBLIC_SUPABASE_URL,
// SUPABASE_SECRET_KEY and TMDB_API_KEY in .env. Nothing from .env is printed.
import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';

try {
  for (const line of fs.readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*"?([^"#]*?)"?\s*(#.*)?$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
} catch { /* no .env */ }
if (!process.env.PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SECRET_KEY) { console.log('Add PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY to .env first.'); process.exit(1); }
const write = process.argv.includes('--write');
const tmdb = process.env.TMDB_API_KEY;
const db = createClient(process.env.PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJSON(url) {
  for (let t = 0; t < 3; t++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'Granthalaya/1.0 (runtime fill)' }, signal: AbortSignal.timeout(20000) });
      if (r.ok) return await r.json();
      if (r.status === 404) return null;
    } catch { /* try again */ }
    await sleep(1200);
  }
  return null;
}

const filmRuntime = async (id) => (await getJSON(`https://api.themoviedb.org/3/movie/${id}?api_key=${tmdb}`))?.runtime || null;
async function seasonRuntime(id, n) {
  const s = await getJSON(`https://api.themoviedb.org/3/tv/${id}/season/${n}?api_key=${tmdb}`);
  const eps = s?.episodes ?? [];
  const sum = eps.reduce((m, e) => m + (e.runtime || 0), 0);
  // a season is only counted when every episode has a length, so a half-known season isn't passed off as whole
  return sum && eps.every((e) => e.runtime) ? { runtime: sum, episodes: eps.length } : null;
}
async function bookPages(olKey) {
  const w = String(olKey).replace(/^\/?works\//, '');
  if (!/^OL\d+W$/.test(w)) return null;
  const j = await getJSON(`https://openlibrary.org/search.json?q=key:/works/${w}&fields=key,number_of_pages_median&limit=1`);
  return j?.docs?.[0]?.number_of_pages_median || null;
}

const { data: rows, error } = await db.from('titles').select('id, slug, kind, title, season, runtime, pages, tmdb_id, ol_key, source').order('created_at');
if (error) { console.log('Couldn’t read the titles:', error.message); process.exit(1); }

const need = rows.filter((t) => (t.kind === 'book' ? t.pages == null : t.kind === 'film' || t.kind === 'tv' ? t.runtime == null : false));
const out = { film: 0, tv: 0, book: 0, noId: 0, notFound: 0 };
const would = [];
for (const t of need) {
  let patch = null;
  if (t.kind === 'film') {
    if (!t.tmdb_id || !tmdb) { out.noId++; continue; }
    const runtime = await filmRuntime(t.tmdb_id);
    if (runtime) patch = { runtime };
  } else if (t.kind === 'tv') {
    if (!t.tmdb_id || !t.season || !tmdb) { out.noId++; continue; }
    const s = await seasonRuntime(t.tmdb_id, t.season);
    if (s) patch = { runtime: s.runtime };
  } else {
    if (!t.ol_key) { out.noId++; continue; }
    const pages = await bookPages(t.ol_key);
    if (pages) patch = { pages };
  }
  if (!patch) { out.notFound++; console.log(`–  ${t.slug}: nothing found`); continue; }
  out[t.kind]++;
  would.push({ id: t.id, slug: t.slug, ...patch });
  console.log(`${write ? '✓' : '·'}  ${t.slug}: ${Object.entries(patch).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  await sleep(120);
}

console.log(`\n${rows.length} titles in the catalogue, ${need.length} missing a runtime or page count.`);
console.log(`${write ? 'Changed' : 'Would change'} ${would.length}: ${out.film} films, ${out.tv} TV seasons, ${out.book} books.`);
console.log(`Left alone: ${out.noId} with no TMDB or Open Library id, ${out.notFound} the source has no number for.`);

if (write) {
  for (const w of would) {
    const { id, slug, ...patch } = w;
    const { error: e } = await db.from('titles').update(patch).eq('id', id);
    if (e) console.log(`✗  ${slug}: ${e.message}`);
  }
} else if (would.length) console.log('Dry run: nothing was written. Add --write to save.');
