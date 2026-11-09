// Finds doubled comments and doubled entries (logs) and, only with --write, removes the extra ones.
//
//   node scripts/dedupe.mjs            dry run: lists every group, changes nothing
//   node scripts/dedupe.mjs --write    deletes the extras (needs a backup from the last 60 minutes:
//                                      node scripts/backup-db.mjs --name=before-dedupe)
//
// Comments: the same member, the same review and the same text, created within a minute of each other. The first is kept.
// Entries: the same member, the same title, the same status and the same day, created within a minute of each other. The one
// with the most in it (rating, review, dates) is kept, the earliest if they are equal. Likes on a removed entry are moved
// to the kept one first. Needs SUPABASE_DB_URL in .env: read here, never printed.
import fs from 'node:fs';
import pg from 'pg';

for (const line of fs.readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^(["'])(.*)\1$/, '$2');
}
const write = process.argv.includes('--write');
if (!process.env.SUPABASE_DB_URL) { console.log('Add SUPABASE_DB_URL to .env first.'); process.exit(1); }
if (write) {
  const dir = 'private/backups';
  const newest = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.json.gz')).map((f) => ({ f, t: fs.statSync(`${dir}/${f}`).mtimeMs })).sort((a, b) => b.t - a.t)[0] : null;
  if (!newest || Date.now() - newest.t > 60 * 60_000) { console.log('No backup from the last 60 minutes. Take one first:\n  node scripts/backup-db.mjs --name=before-dedupe'); process.exit(1); }
  console.log(`Backup found: private/backups/${newest.f}`);
}

const db = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await db.connect();
const who = new Map((await db.query('select id, username from profiles')).rows.map((r) => [r.id, r.username]));
const at = (d) => new Date(d).toISOString().replace('T', ' ').slice(0, 23);
const WINDOW = 60_000;

// group rows by key, then split each group where two neighbours are more than a minute apart
function groups(rows, key) {
  const by = new Map();
  for (const r of rows) { const k = key(r); (by.get(k) ?? by.set(k, []).get(k)).push(r); }
  const out = [];
  for (const list of by.values()) {
    list.sort((a, b) => a.created_at - b.created_at);
    let cur = [list[0]];
    for (const r of list.slice(1)) { if (r.created_at - cur[cur.length - 1].created_at <= WINDOW) cur.push(r); else { if (cur.length > 1) out.push(cur); cur = [r]; } }
    if (cur.length > 1) out.push(cur);
  }
  return out;
}

const comments = (await db.query('select id, log_id, user_id, body, created_at from review_comments')).rows;
const cGroups = groups(comments, (c) => `${c.user_id}|${c.log_id}|${c.body.trim()}`);
const logs = (await db.query(`select l.id, l.user_id, l.title_id, l.status, l.rating, l.notes, l.tagline, l.logged_on, l.started_on, l.finished_on, l.created_at, t.title
  from logs l join titles t on t.id = l.title_id`)).rows;
const day = (l) => (l.finished_on ?? l.started_on ?? l.logged_on)?.toISOString?.().slice(0, 10) ?? String(l.finished_on ?? l.started_on ?? l.logged_on);
const lGroups = groups(logs, (l) => `${l.user_id}|${l.title_id}|${l.status}|${day(l)}`);
const weight = (l) => (l.rating != null ? 4 : 0) + (l.notes ? 2 : 0) + (l.tagline ? 1 : 0);

const dropComments = [], dropLogs = [];
console.log(`Duplicate comments: ${cGroups.length} group(s)`);
for (const g of cGroups) {
  console.log(`  @${who.get(g[0].user_id)} on review ${g[0].log_id.slice(0, 8)}: "${g[0].body.slice(0, 60)}"`);
  g.forEach((c, i) => { console.log(`    ${i === 0 ? 'keep  ' : 'delete'} ${c.id.slice(0, 8)}  ${at(c.created_at)}`); if (i) dropComments.push(c.id); });
}
console.log(`\nDuplicate entries: ${lGroups.length} group(s)`);
for (const g of lGroups) {
  const keep = [...g].sort((a, b) => weight(b) - weight(a) || a.created_at - b.created_at)[0];
  console.log(`  @${who.get(g[0].user_id)}: ${g[0].title} (${g[0].status}, ${day(g[0])})`);
  for (const l of g) { const k = l === keep; console.log(`    ${k ? 'keep  ' : 'delete'} ${l.id.slice(0, 8)}  ${at(l.created_at)}  rating ${l.rating ?? '-'}${l.notes ? ', review' : ''}`); if (!k) dropLogs.push({ id: l.id, into: keep.id }); }
}
console.log(`\nWould delete ${dropComments.length} comment(s) and ${dropLogs.length} entr${dropLogs.length === 1 ? 'y' : 'ies'}.`);

if (!write) { console.log('Dry run: nothing was changed.'); await db.end(); process.exit(0); }
await db.query('begin');
try {
  for (const d of dropLogs) {
    await db.query('update review_likes set log_id = $2 where log_id = $1 and user_id not in (select user_id from review_likes where log_id = $2)', [d.id, d.into]);
    await db.query('update review_comments set log_id = $2 where log_id = $1', [d.id, d.into]);
    await db.query('delete from logs where id = $1', [d.id]);
  }
  if (dropComments.length) await db.query('delete from review_comments where id = any($1)', [dropComments]);
  await db.query('commit');
  console.log('Done.');
} catch (e) { await db.query('rollback'); console.log('Rolled back:', e.message); process.exitCode = 1; }
await db.end();
