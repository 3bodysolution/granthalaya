// Clears one person's shelf data before launch (the owner's test entries), and nothing else.
//
//   node scripts/clear-my-data.mjs                 dry run: counts per table, changes nothing
//   node scripts/clear-my-data.mjs --user=sarthak  another username (default: sarthak, the site's owner)
//   node scripts/clear-my-data.mjs --write         does it, in one transaction (all or nothing), but only if a backup from the
//                                                  last 60 minutes is in private/backups/ (take one first:
//                                                  node scripts/backup-db.mjs --name=before-clear-my-data)
//
// Removed: the person's entries (logs, with their reviews, taglines, spoiler flags and "lines"), the likes and comments on
// them (by anyone) and the person's own likes and comments on other people's reviews, their collections (and what is in
// them), their favourites, and their uploaded profile photos (the files, the upload counter and the photo address if it
// points at an uploaded file).
// Kept: the account, profile (name, bio, links, username, admin rights), a Google photo address, blocks and reports, and
// everything shared: the catalogue (titles and their facts and card lines), shop books and the lists. Nobody else's data is touched.
//
// Needs SUPABASE_DB_URL (and, for the photo files, PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY) in .env: read here, never printed.
import fs from 'node:fs';
import pg from 'pg';
import { createClient } from '@supabase/supabase-js';

for (const line of fs.readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^(["'])(.*)\1$/, '$2');
}
const args = process.argv.slice(2);
const write = args.includes('--write');
const username = (args.find((a) => a.startsWith('--user=')) ?? '--user=sarthak').slice(7).toLowerCase();
const dbUrl = process.env.SUPABASE_DB_URL;
if (!dbUrl) { console.log('Add SUPABASE_DB_URL to .env first.'); process.exit(1); }

// a backup from the last hour has to exist before anything is deleted
if (write) {
  const dir = 'private/backups';
  const newest = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.json.gz')).map((f) => ({ f, t: fs.statSync(`${dir}/${f}`).mtimeMs })).sort((a, b) => b.t - a.t)[0] : null;
  if (!newest || Date.now() - newest.t > 60 * 60_000) {
    console.log('No backup from the last 60 minutes. Take one first:\n  node scripts/backup-db.mjs --name=before-clear-my-data');
    process.exit(1);
  }
  console.log(`Backup found: private/backups/${newest.f} (${Math.round((Date.now() - newest.t) / 60000)} min old)`);
}

// same connection rules as db-apply.mjs: split at the last "@", verify against Supabase's CA
const m = dbUrl.match(/^postgres(?:ql)?:\/\/([^:@/]+):(.*)@([^@/:]+):(\d+)\/([^?]+)/);
if (!m) { console.log('SUPABASE_DB_URL should look like postgresql://user:password@host:5432/postgres'); process.exit(1); }
const [, user, password, host, port, database] = m;
const client = new pg.Client({ user, password, host, port: +port, database, ssl: { ca: fs.readFileSync('supabase/prod-ca-2021.crt', 'utf8'), rejectUnauthorized: true } });
try { await client.connect(); } catch (e) { console.log(`Could not connect: ${e.message}`); process.exit(1); }
const one = async (sql, p = []) => (await client.query(sql, p)).rows;

const [me] = await one('select id, username, is_admin, avatar_url from public.profiles where username = $1', [username]);
if (!me) { console.log(`No account with the username "${username}".`); await client.end(); process.exit(1); }
console.log(`${write ? 'CLEARING' : 'Dry run for'} @${me.username}${me.is_admin ? ' (admin)' : ''}\n`);

// photos: files in avatars/<id>/ (paged, 100 at a time)
const sb = process.env.PUBLIC_SUPABASE_URL && process.env.SUPABASE_SECRET_KEY
  ? createClient(process.env.PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } }) : null;
const photoFiles = async () => {
  if (!sb) return null;
  const names = [];
  for (let offset = 0; offset < 5000; offset += 100) {
    const { data, error } = await sb.storage.from('avatars').list(me.id, { limit: 100, offset });
    if (error || !data?.length) break;
    names.push(...data.filter((f) => f.id !== null).map((f) => f.name));
    if (data.length < 100) break;
  }
  return names;
};

const q = {
  'logs (entries, with reviews, taglines, spoiler flags)': ['select count(*)::int n from public.logs where user_id = $1', 'delete from public.logs where user_id = $1'],
  'highlights (old lines) on those entries': ['select count(*)::int n from public.highlights where user_id = $1', null],
  'likes on those entries (by anyone)': ['select count(*)::int n from public.review_likes k join public.logs l on l.id = k.log_id where l.user_id = $1', null],
  'comments on those entries (by anyone)': ['select count(*)::int n from public.review_comments c join public.logs l on l.id = c.log_id where l.user_id = $1', null],
  'their likes on other people\'s reviews': ['select count(*)::int n from public.review_likes k join public.logs l on l.id = k.log_id where k.user_id = $1 and l.user_id <> $1', 'delete from public.review_likes where user_id = $1'],
  'their comments on other people\'s reviews': ['select count(*)::int n from public.review_comments c join public.logs l on l.id = c.log_id where c.user_id = $1 and l.user_id <> $1', 'delete from public.review_comments where user_id = $1'],
  'collections': ['select count(*)::int n from public.threads where user_id = $1', 'delete from public.threads where user_id = $1'],
  'items in those collections': ['select count(*)::int n from public.thread_items where user_id = $1', null],
  'favourites': ['select coalesce(cardinality(favourites), 0)::int n from public.profile_details where id = $1', "update public.profile_details set favourites = '{}' where id = $1"],
  'photo upload counter rows (avatar_uploads)': ['select count(*)::int n from public.avatar_uploads where user_id = $1', 'delete from public.avatar_uploads where user_id = $1'],
};
const kept = {
  'account, profile, username, admin rights': 'kept',
  'titles (the catalogue), shop books, lists': 'not touched',
};

const counts = {};
for (const [label, [count]] of Object.entries(q)) counts[label] = (await one(count, [me.id]))[0]?.n ?? 0;
const files = await photoFiles();
const uploaded = typeof me.avatar_url === 'string' && me.avatar_url.includes('/storage/v1/object/public/avatars/');
const w = Math.max(...Object.keys(q).map((k) => k.length)) + 2;
for (const [label, n] of Object.entries(counts)) console.log(`  ${label.padEnd(w)} ${n}`);
console.log(`  ${'uploaded photo files'.padEnd(w)} ${files ? files.length : 'not counted (PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY missing)'}`);
console.log(`  ${'photo address points at an upload'.padEnd(w)} ${uploaded ? 'yes (will be cleared)' : 'no (a Google photo or none: kept)'}`);
console.log('');
for (const [label, v] of Object.entries(kept)) console.log(`  ${label.padEnd(w)} ${v}`);

if (!write) {
  console.log('\nDry run: nothing was changed. Take a backup, then run again with --write.');
  await client.end();
  process.exit(0);
}

try {
  await client.query('begin');
  for (const [, [, del]] of Object.entries(q)) if (del) await client.query(del, [me.id]);
  if (uploaded) await client.query('update public.profiles set avatar_url = null where id = $1', [me.id]);
  await client.query('commit');
} catch (e) {
  await client.query('rollback').catch(() => null);
  console.log(`\nNothing was changed (rolled back): ${e.message}`);
  await client.end();
  process.exit(1);
}
// the photo files last (they are outside the database transaction); repeated until the folder is empty
let removed = 0;
if (sb) {
  for (let round = 0; round < 100; round++) {
    const names = await photoFiles();
    if (!names?.length) break;
    const { data, error } = await sb.storage.from('avatars').remove(names.map((n) => `${me.id}/${n}`));
    if (error || !data?.length) { console.log(`Could not remove some photo files: ${error?.message ?? 'none removed'}`); break; }
    removed += data.length;
  }
}
console.log(`\nDone. Rows removed as listed above; ${removed} photo file(s) removed.`);
await client.end();
