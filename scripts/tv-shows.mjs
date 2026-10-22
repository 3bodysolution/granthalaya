// TV by show (supabase/changes/008): gives every show in the catalogue its own row above its seasons, from TMDB,
// and points each season at it (`show_id`). Favourites and collection items that name a season move to the show
// (a collection that already has the show keeps one item, with the season's line if the show's was empty).
// No log moves: dates, ratings, notes, "Only me" and re-watches stay on their seasons.
//
//   node scripts/tv-shows.mjs            dry run (the default): asks TMDB, prints what it would do, writes nothing
//   node scripts/tv-shows.mjs --write    does it (only when Sarthak asks for it in that message, after 008 is applied)
//
// Safe to repeat: a show that already has its row is reused, and only seasons without a show_id are pointed at it.
// Needs PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY and TMDB_API_KEY in .env. Nothing from .env is printed.
// The dry run also works before 008 is applied.
import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';

try {
  for (const line of fs.readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*"?([^"#]*?)"?\s*(#.*)?$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
} catch { /* no .env */ }
const need = ['PUBLIC_SUPABASE_URL', 'SUPABASE_SECRET_KEY', 'TMDB_API_KEY'].filter((k) => !process.env[k]);
if (need.length) { console.log(`Add ${need.join(', ')} to .env first.`); process.exit(1); }
const write = process.argv.includes('--write');
const db = createClient(process.env.PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
const tmdbBase = process.env.TMDB_API_BASE || 'https://api.themoviedb.org/3';

// the same as slugify in src/lib/titles.ts
const slugify = (s) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/['’]/g, '').replace(/&/g, ' and ')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 70).replace(/-+$/, '') || 'untitled';

const { data: probe, error: pe } = await db.from('titles').select('*').eq('kind', 'tv').limit(1);
if (pe) { console.log('Could not read the catalogue:', pe.message); process.exit(1); }
const applied = !probe.length || 'show_id' in probe[0];
if (write && !applied) { console.log('supabase/changes/008 is not applied yet. Apply it first.'); process.exit(1); }

const { data: tv, error } = await db.from('titles').select(applied ? 'id, slug, title, season, tmdb_id, show_id' : 'id, slug, title, season, tmdb_id').eq('kind', 'tv');
if (error) { console.log('Could not read the catalogue:', error.message); process.exit(1); }
const shows = new Map();   // tmdb id → { row, seasons[] }
const loose = [];
for (const t of tv) {
  if (!t.tmdb_id) { loose.push(t); continue; }
  const s = shows.get(t.tmdb_id) ?? { row: null, seasons: [] };
  if (t.season == null) s.row = t; else s.seasons.push(t);
  shows.set(t.tmdb_id, s);
}
console.log(`${applied ? '' : '(008 is not applied yet: a dry run only.)\n'}TV rows in the catalogue: ${tv.length}, from ${shows.size} show(s) on TMDB.`);
if (loose.length) console.log(`Without a TMDB id (left as they are): ${loose.map((t) => t.slug).join(', ')}`);

const { data: taken } = await db.from('titles').select('slug');
const slugs = new Set((taken ?? []).map((r) => r.slug));
const freeSlug = (base, year) => {
  const tries = [base, year ? `${base}-${year}` : null, ...Array.from({ length: 20 }, (_, i) => `${base}-${i + 2}`)].filter(Boolean);
  const s = tries.find((x) => !slugs.has(x)) ?? `${base}-${Date.now().toString(36)}`;
  slugs.add(s);
  return s;
};

const { data: details } = await db.from('profile_details').select('id, favourites');
const { data: items } = await db.from('thread_items').select('thread_id, title_id, user_id, position, why');
const moves = { favourites: 0, items: 0, merged: 0 };

for (const [tmdbId, s] of shows) {
  let t = null, why = '';
  for (let i = 0; i < 3 && !t; i++) {
    try {
      const r = await fetch(`${tmdbBase}/tv/${tmdbId}?api_key=${process.env.TMDB_API_KEY}`, { signal: AbortSignal.timeout(20000) });
      if (r.ok) t = await r.json(); else why = `status ${r.status}`;
    } catch (e) { why = e.cause?.code ?? e.message; await new Promise((ok) => setTimeout(ok, 1500)); }
  }
  if (!t?.id) { console.log(`\n${tmdbId}: TMDB did not answer (${why}); left for another run.`); continue; }
  const seasons = (t.seasons ?? []).filter((x) => x.season_number > 0);
  const year = Number(String(t.first_air_date ?? '').slice(0, 4)) || null;
  let show = s.row;
  const fields = {
    title: t.name, creator: (t.created_by ?? []).map((c) => c.name).slice(0, 3).join(', ').slice(0, 200), year,
    episodes: seasons.reduce((n, x) => n + (x.episode_count || 0), 0) || null, seasons: seasons.filter((x) => x.air_date && x.air_date <= new Date().toISOString().slice(0, 10)).length || null,   // released only
    cover_url: t.poster_path ? `https://image.tmdb.org/t/p/w500${t.poster_path}` : null,
    language: /^[a-z]{2,3}$/.test(t.original_language ?? '') ? t.original_language : null,
    link: `https://www.themoviedb.org/tv/${tmdbId}`,
  };
  const point = s.seasons.filter((x) => !show || x.show_id !== show.id);
  console.log(`\n${t.name} (TMDB ${tmdbId}, ${seasons.length} season${seasons.length === 1 ? '' : 's'} on TMDB)`);
  if (show) console.log(`  show row already there: ${show.slug}`);
  else {
    const slug = freeSlug(slugify(t.name), year);
    console.log(`  new show row: /${slug}/, ${[year, fields.creator && `by ${fields.creator}`, fields.cover_url ? 'with poster' : 'no poster', fields.language].filter(Boolean).join(', ')}`);
    if (write) {
      const { data, error: e } = await db.from('titles').insert({ kind: 'tv', slug, season: null, tmdb_id: tmdbId, ...fields }).select('id, slug').single();
      if (e) { console.log(`  could not add it: ${e.message}`); continue; }
      show = data;
    } else show = { id: `(new ${slug})`, slug };
  }
  if (write && s.row) await db.from('titles').update({ seasons: fields.seasons }).eq('id', show.id);
  console.log(`  seasons pointed at it: ${point.length ? point.map((x) => x.season).sort((a, b) => a - b).join(', ') : 'none needed'}`);
  if (write && point.length) {
    const { error: e } = await db.from('titles').update({ show_id: show.id }).in('id', point.map((x) => x.id));
    if (e) console.log(`  could not point the seasons: ${e.message}`);
  }

  // favourites naming a season → the show, once
  const ids = new Set(s.seasons.map((x) => x.id));
  for (const d of details ?? []) {
    if (!d.favourites.some((id) => ids.has(id))) continue;
    const next = [...new Set(d.favourites.map((id) => (ids.has(id) ? show.id : id)))];
    console.log(`  favourites of one person: ${d.favourites.filter((id) => ids.has(id)).length} season(s) become the show`);
    moves.favourites++;
    if (write) await db.from('profile_details').update({ favourites: next }).eq('id', d.id);
  }
  // collection items naming a season → the show; a collection that already has the show keeps that item
  for (const it of (items ?? []).filter((i) => ids.has(i.title_id))) {
    const has = (items ?? []).find((i) => i.thread_id === it.thread_id && i.title_id === show.id);
    if (has) {
      console.log(`  collection item: this collection already has the show; the season item goes${it.why && !has.why ? ' (its line moves to the show)' : ''}`);
      moves.merged++;
      if (write) {
        if (it.why && !has.why) await db.from('thread_items').update({ why: it.why }).eq('thread_id', it.thread_id).eq('title_id', show.id);
        await db.from('thread_items').delete().eq('thread_id', it.thread_id).eq('title_id', it.title_id);
      }
      if (it.why && !has.why) has.why = it.why;
    } else {
      console.log(`  collection item: season ${s.seasons.find((x) => x.id === it.title_id)?.season} becomes the show${it.why ? ' (line kept)' : ''}`);
      moves.items++;
      if (write) await db.from('thread_items').update({ title_id: show.id }).eq('thread_id', it.thread_id).eq('title_id', it.title_id);
      it.title_id = show.id;
    }
  }
}
console.log(`\nFavourites changed for ${moves.favourites} person(s); collection items moved: ${moves.items}, folded into an existing show item: ${moves.merged}.`);
console.log(write ? 'Done.' : '(dry run: nothing was written)');
