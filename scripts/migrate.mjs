// One-time move: copies the old markdown library (src/content/library and src/content/threads)
// into the database, onto the shelf of the person with username "sarthak".
//
//   npm run migrate              do it (safe to run again: it replaces that shelf with the files' version)
//   npm run migrate -- --dry     only show what it would do
//   npm run migrate -- --user someone   copy onto a different username
//
// Needs PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY in the .env file in this folder,
// and the person must have signed in on the site and picked their username first.
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { createClient } from '@supabase/supabase-js';

try {
  for (const line of fs.readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*"?([^"#]*?)"?\s*(#.*)?$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
} catch {}

const args = process.argv.slice(2);
const dry = args.includes('--dry');
const username = args.includes('--user') ? args[args.indexOf('--user') + 1] : 'sarthak';
const url = process.env.PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SECRET_KEY;
if (!url || !key) { console.log('Add PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY to .env first.'); process.exit(1); }
const db = createClient(url, key, { auth: { persistSession: false } });

// What site.ts used to hold for Sarthak, before it moved into the profile.
const OLD_PROFILE = {
  bio: 'Books, films and everything I’ve spent time with.',
  season_line: 'Monsoon 2026',
  lotw_text: 'Clouds come floating into my life, no longer to carry rain or usher storm, but to add color to my sunset sky.',
  lotw_by: 'Rabindranath Tagore',
  lotw_source: 'Stray Birds',
  goal_books: 30,
};

const LIB = 'src/content/library', THREADS = 'src/content/threads';
function read(file) {
  const text = fs.readFileSync(file, 'utf8');
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) throw new Error(`No front matter in ${file}`);
  return { fm: yaml.load(m[1]) ?? {}, body: m[2].trim() };
}
const iso = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : typeof d === 'string' ? d.slice(0, 10) : null);
const coverFor = (slug, fm) => {
  if (fm.cover && fm.cover !== 'painted') return fm.cover;
  for (const ext of ['jpg', 'webp', 'png']) if (fs.existsSync(path.join('public', 'covers', `${slug}.${ext}`))) return `/covers/${slug}.${ext}`;
  return null;
};
const tmdbId = (link) => +(String(link ?? '').match(/themoviedb\.org\/movie\/(\d+)/)?.[1] ?? 0) || null;

const { data: who, error: whoErr } = await db.from('profiles').select('id, username').eq('username', username).maybeSingle();
if (whoErr) { console.log('Couldn’t reach the database:', whoErr.message); process.exit(1); }
if (!who) { console.log(`Nobody has the username "${username}" yet. Sign in on the site and pick it first.`); process.exit(1); }
console.log(`Copying the library onto @${who.username}${dry ? ' (dry run)' : ''}…\n`);

const entries = fs.readdirSync(LIB).filter((f) => f.endsWith('.md')).map((f) => ({ slug: f.replace(/\.md$/, ''), ...read(path.join(LIB, f)) }));
const titleIds = new Map();

if (!dry) {
  // start this shelf afresh, so running the script twice doesn't double anything
  for (const table of ['threads', 'logs']) {
    const { error } = await db.from(table).delete().eq('user_id', who.id);
    if (error) { console.log(`Couldn’t clear the old ${table} first (${error.message}), so nothing was copied.`); process.exit(1); }
  }
}

for (const { slug, fm, body } of entries) {
  const kind = fm.type;
  const t = {
    kind, slug, title: fm.title, creator: fm.creator ?? '', year: fm.year ?? null,
    runtime: fm.runtime ?? null, pages: fm.pages ?? null, words: fm.words ?? null,
    cover_url: kind === 'essay' ? null : coverFor(slug, fm),
    link: fm.link ?? null, source: fm.source ?? null, tmdb_id: kind === 'film' ? tmdbId(fm.link) : null,
    trivia: fm.trivia ?? [], trivia_source: fm.triviaSource ?? null, color: fm.color ?? null,
  };
  // status: the old reading / watching / done become tags; films have no "watching", so a rewatch is Watched + Again
  const status = fm.status === 'reading' ? 'reading' : fm.status === 'watching' ? (kind === 'film' ? 'done' : 'watching') : 'done';
  const date = iso(fm.date);
  const log = {
    user_id: who.id, status, rating: fm.rating ?? null, loved: !!fm.loved,
    started_on: status === 'reading' ? date : null, finished_on: status === 'done' ? date : null, logged_on: date,
    again: (fm.times ?? 1) > 1, notes: body, where_seen: fm.where ?? '', only_me: !!fm.private,
  };
  console.log(`  ${kind.padEnd(5)} ${slug.padEnd(32)} ${status}${log.again ? ' · again' : ''}${t.cover_url ? ' · cover' : ''}${t.trivia.length ? ' · facts' : ''}`);
  if (dry) continue;

  const { data: title, error } = await db.from('titles').upsert(t, { onConflict: 'slug' }).select('id').single();
  if (error) { console.log(`    ✗ title: ${error.message}`); continue; }
  titleIds.set(slug, title.id);
  const { data: row, error: e2 } = await db.from('logs').insert({ ...log, title_id: title.id }).select('id').single();
  if (e2) { console.log(`    ✗ entry: ${e2.message}`); continue; }
  const hl = (fm.highlights ?? []).map((h, i) => ({ log_id: row.id, user_id: who.id, body: h.text, where_at: h.where ?? '', note: h.note ?? '', mine: !!h.mine, position: i }));
  if (hl.length) {
    const { error: e3 } = await db.from('highlights').insert(hl);
    if (e3) console.log(`    ✗ lines: ${e3.message}`);
  }
}

// threads, in the same order with the same "why" lines
const threads = fs.readdirSync(THREADS).filter((f) => f.endsWith('.md')).map((f) => ({ slug: f.replace(/\.md$/, ''), ...read(path.join(THREADS, f)) }));
console.log('');
for (const { slug, fm, body } of threads) {
  console.log(`  thread ${slug} (${(fm.items ?? []).length} things)`);
  if (dry) continue;
  const { data: th, error } = await db.from('threads').insert({ user_id: who.id, slug, name: fm.title, intro: body, position: fm.order ?? 99 }).select('id').single();
  if (error) { console.log(`    ✗ ${error.message}`); continue; }
  const items = (fm.items ?? []).filter((i) => titleIds.has(i.slug)).map((i, n) => ({ thread_id: th.id, title_id: titleIds.get(i.slug), user_id: who.id, position: n, why: i.why ?? '' }));
  if (items.length) {
    const { error: e2 } = await db.from('thread_items').insert(items);
    if (e2) console.log(`    ✗ ${e2.message}`);
  }
}

// profile: the old settings, and the "Start here" picks as favourites
const favourites = entries.filter((e) => e.fm.startHere).sort((a, b) => a.fm.startHere - b.fm.startHere).slice(0, 4).map((e) => titleIds.get(e.slug)).filter(Boolean);
if (!dry) {
  const { error } = await db.from('profile_details').upsert({ id: who.id, ...OLD_PROFILE, favourites });
  if (error) console.log(`  ✗ profile: ${error.message}`);
  const { error: e4 } = await db.from('profiles').update({ featured: true }).eq('id', who.id);
  if (e4) console.log(`  ✗ feature my shelf: ${e4.message}`);
}
console.log(`\nDone: ${entries.length} entries and ${threads.length} threads${dry ? ' would be copied' : ' copied'} to @${who.username}.`);
