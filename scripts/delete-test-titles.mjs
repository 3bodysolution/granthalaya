// Takes the rows the test accounts left in the shared catalogue out of `titles`: the six "zztest ..." rows.
//   node scripts/delete-test-titles.mjs              dry run: shows each row and what points at it, changes nothing
//   node scripts/delete-test-titles.mjs --rehearse   deletes inside a transaction and rolls it back (proves it works)
//   node scripts/delete-test-titles.mjs --write      deletes (only when Sarthak asks; take a backup first: node scripts/backup-db.mjs --name=before-013)
// A row is only deleted if it is one of these six (slug starts with "zztest") and nothing points at it:
// no logs, collection items, favourites, shop rows, suggestions or seasons. Anything else is left and reported.
// Needs SUPABASE_DB_URL in .env (read here, never printed).
import fs from 'node:fs';
import pg from 'pg';

let dbUrl = process.env.SUPABASE_DB_URL;
try {
  const line = fs.readFileSync('.env', 'utf8').split(/\r?\n/).map((l) => l.trim()).find((l) => l.startsWith('SUPABASE_DB_URL='));
  if (line) dbUrl = line.slice('SUPABASE_DB_URL='.length).trim().replace(/^(["'])(.*)\1$/, '$2');
} catch { /* environment */ }
if (!dbUrl) { console.log('Add SUPABASE_DB_URL to .env first.'); process.exit(1); }
const m = dbUrl.match(/^postgres(?:ql)?:\/\/([^:@/]+):(.*)@([^@/:]+):(\d+)\/([^?]+)/);
const client = new pg.Client({ user: m[1], password: m[2], host: m[3], port: +m[4], database: m[5], ssl: { ca: fs.readFileSync('supabase/prod-ca-2021.crt', 'utf8'), rejectUnauthorized: true } });
await client.connect();
const write = process.argv.includes('--write'), rehearse = process.argv.includes('--rehearse');
const q = async (sql, args) => (await client.query(sql, args)).rows;

const rows = await q(`select id, slug, kind, title, year, source, created_by from public.titles where slug like 'zztest%' order by slug`);
const refs = async (id) => ({
  logs: +(await q('select count(*) n from public.logs where title_id = $1', [id]))[0].n,
  items: +(await q('select count(*) n from public.thread_items where title_id = $1', [id]))[0].n,
  favourites: +(await q('select count(*) n from public.profile_details where $1::uuid = any(favourites)', [id]))[0].n,
  shops: +(await q('select count(*) n from public.shop_books where title_id = $1', [id]))[0].n,
  suggestions: +(await q('select count(*) n from public.book_suggestions where title_id = $1', [id]))[0].n,
  seasons: +(await q('select count(*) n from public.titles where show_id = $1', [id]))[0].n,
});
const safe = [];
console.log(`${rows.length} rows with a slug starting "zztest":`);
for (const r of rows) {
  const n = await refs(r.id);
  const used = Object.entries(n).filter(([, v]) => v > 0);
  console.log(`  ${r.slug}  (${r.kind}, ${r.title}${r.year ? ', ' + r.year : ''}) ${used.length ? 'IN USE, left alone: ' + used.map(([k, v]) => `${v} ${k}`).join(', ') : 'nothing points at it'}`);
  if (!used.length) safe.push(r);
}
console.log(`${safe.length} would be deleted.`);
if (!write && !rehearse) { console.log('Nothing was changed (dry run).'); await client.end(); process.exit(0); }

await client.query('begin');
for (const r of safe) await client.query('delete from public.titles where id = $1', [r.id]);
const left = (await q(`select count(*) n from public.titles where slug like 'zztest%'`))[0].n;
await client.query(rehearse ? 'rollback' : 'commit');
console.log(`${rehearse ? 'Rehearsed (rolled back)' : 'Deleted'}: ${safe.length} rows. zztest rows left inside the transaction: ${left}.`);
await client.end();
