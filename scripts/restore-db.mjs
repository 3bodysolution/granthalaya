// Puts the rows from a backup (made by backup-db.mjs) back into the live database's public tables.
//
//   node scripts/restore-db.mjs                          dry run with the newest backup: compares it with the live database, changes nothing
//   node scripts/restore-db.mjs --file=private/backups/2026-10-22-15-01-before-009.json.gz
//   node scripts/restore-db.mjs --tables=logs,highlights only these tables (default: every public table in the backup)
//   node scripts/restore-db.mjs --rehearse               does the whole restore inside a transaction, then undoes it
//   node scripts/restore-db.mjs --write                  the real restore (takes a fresh backup named before-restore first)
//
// What it does on --write, in one transaction (all or nothing): empties the chosen tables, inserts the backup's rows
// with the tables' own triggers switched off (so rate limits and "updated at" don't fire), then sets sequences past
// the restored ids. It restores rows, not structure: a column or table added after the backup keeps its default or
// is left alone (the dry run names them), and undoing a change to the structure is done by hand from schema.sql in git.
// auth and storage are never touched (people's sign-in accounts live there; our changes never alter them).
// Needs SUPABASE_DB_URL in .env (read here, never printed). Only run --write when Sarthak asks (see CLAUDE.md).
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawnSync } from 'node:child_process';
import pg from 'pg';

const args = process.argv.slice(2);
const opt = (k) => (args.find((a) => a.startsWith(`--${k}=`)) ?? '').slice(k.length + 3);
const write = args.includes('--write');
const rehearse = args.includes('--rehearse');
if (write && rehearse) { console.log('Choose one: --write or --rehearse.'); process.exit(1); }

const DIR = 'private/backups';
const file = opt('file') || (fs.existsSync(DIR) ? fs.readdirSync(DIR).filter((f) => f.endsWith('.json.gz')).sort().map((f) => path.join(DIR, f)).pop() : '');
if (!file || !fs.existsSync(file)) { console.log(`No backup found${file ? ` at ${file}` : ` in ${DIR}`}.`); process.exit(1); }
const backup = JSON.parse(zlib.gunzipSync(fs.readFileSync(file)).toString('utf8'));

let dbUrl = process.env.SUPABASE_DB_URL;
try {
  const line = fs.readFileSync('.env', 'utf8').split(/\r?\n/).find((l) => l.startsWith('SUPABASE_DB_URL='));
  if (line) dbUrl = line.slice('SUPABASE_DB_URL='.length).trim().replace(/^(["'])(.*)\1$/, '$2');
} catch { /* no .env: fall back to the environment */ }
if (!dbUrl) { console.log('Add SUPABASE_DB_URL to .env first.'); process.exit(1); }
// same connection rules as db-apply.mjs: split at the last "@", verify against Supabase's CA
const m = dbUrl.match(/^postgres(?:ql)?:\/\/([^:@/]+):(.*)@([^@/:]+):(\d+)\/([^?]+)/);
if (!m) { console.log('SUPABASE_DB_URL should look like postgresql://user:password@host:5432/postgres'); process.exit(1); }
const [, user, password, host, port, database] = m;
const client = new pg.Client({ user, password, host, port: +port, database, ssl: { ca: fs.readFileSync('supabase/prod-ca-2021.crt', 'utf8'), rejectUnauthorized: true } });
try { await client.connect(); } catch (e) { console.log(`Could not connect: ${e.message}`); process.exit(1); }
const rows = async (sql, p) => (await client.query(sql, p)).rows;
const q = (t) => `"public"."${t}"`;
const qc = (c) => `"${c.replace(/"/g, '""')}"`;

// what the live database looks like now
const liveTables = (await rows(`select table_name t from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'`)).map((r) => r.t);
const liveCols = {};
for (const r of await rows(`select table_name t, column_name c, is_generated g, is_nullable n from information_schema.columns where table_schema = 'public'`)) {
  (liveCols[r.t] ??= []).push({ c: r.c, generated: r.g === 'ALWAYS', nullable: r.n === 'YES' });
}
// foreign keys between public tables: [table, column, referenced table]
const fks = (await rows(`select c.conrelid::regclass::text as t, a.attname as c, c.confrelid::regclass::text as r
  from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
  where c.contype = 'f' and c.connamespace = 'public'::regnamespace`)).map((r) => ({ t: r.t.replace(/^public\./, ''), c: r.c, r: r.r.replace(/^public\./, '') }));

// which tables to restore
const inBackup = Object.keys(backup.tables).filter((k) => k.startsWith('public.')).map((k) => k.slice(7));
const wanted = opt('tables') ? opt('tables').split(',').map((s) => s.trim()).filter(Boolean) : inBackup.filter((t) => t !== 'applied_changes');
const unknown = wanted.filter((t) => !inBackup.includes(t) || !liveTables.includes(t));
if (unknown.length) { console.log(`Not in both the backup and the live database: ${unknown.join(', ')}`); await client.end(); process.exit(1); }
const set = new Set(wanted);

// order: a table after the tables it points at. A column pointing at its own table, or caught in a loop
// (profile_details.pinned_line → highlights → logs → profiles), is filled in afterwards with an update.
const order = []; const later = []; // later: { t, c }
{
  const left = new Set(wanted);
  const deps = (t) => fks.filter((f) => f.t === t && f.r !== t && left.has(f.r));
  while (left.size) {
    const ready = [...left].filter((t) => !deps(t).length).sort();
    if (ready.length) { for (const t of ready) { order.push(t); left.delete(t); } continue; }
    const t = [...left].sort()[0]; // a loop: break it at this table
    for (const f of deps(t)) later.push({ t, c: f.c });
    order.push(t); left.delete(t);
  }
  for (const f of fks) if (f.t === f.r && set.has(f.t)) later.push({ t: f.t, c: f.c });
}
const blocked = later.filter(({ t, c }) => !liveCols[t].find((x) => x.c === c)?.nullable);
// tables outside the restore that point at one inside it are emptied too (truncate … cascade)
const cascade = new Set();
for (let grew = true; grew;) {
  grew = false;
  for (const f of fks) if ((set.has(f.r) || cascade.has(f.r)) && !set.has(f.t) && !cascade.has(f.t)) { cascade.add(f.t); grew = true; }
}

console.log(`Backup ${file}, taken ${backup.taken_at}.`);
console.log(`\n${'table'.padEnd(20)} ${'backup'.padStart(7)} ${'live now'.padStart(9)}  notes`);
const plan = {};
for (const t of order) {
  const data = backup.tables[`public.${t}`];
  const live = (await rows(`select count(*)::int n from ${q(t)}`))[0].n;
  const backupCols = new Set(data.length ? Object.keys(data[0]) : backup.structure.columns.filter((c) => c.table_schema === 'public' && c.table_name === t).map((c) => c.column_name));
  const cols = liveCols[t].filter((x) => !x.generated && backupCols.has(x.c)).map((x) => x.c);
  const added = liveCols[t].filter((x) => !backupCols.has(x.c)).map((x) => x.c);
  const gone = [...backupCols].filter((c) => !liveCols[t].find((x) => x.c === c));
  plan[t] = { data, cols };
  const notes = [added.length && `new since the backup, gets its default: ${added.join(', ')}`, gone.length && `no longer live, its values are skipped: ${gone.join(', ')}`].filter(Boolean).join('; ');
  console.log(`${t.padEnd(20)} ${String(data.length).padStart(7)} ${String(live).padStart(9)}  ${notes}`);
}
const notInBackup = liveTables.filter((t) => !inBackup.includes(t));
if (notInBackup.length) console.log(`\nLive tables the backup doesn't have (left as they are unless listed as emptied below): ${notInBackup.join(', ')}`);
if (cascade.size) console.log(`Also emptied, because they point at restored tables: ${[...cascade].join(', ')}`);
if (later.length) console.log(`Filled in after the inserts (they point at their own table or form a loop): ${later.map((l) => `${l.t}.${l.c}`).join(', ')}`);
if (blocked.length) { console.log(`Can't restore: ${blocked.map((l) => `${l.t}.${l.c}`).join(', ')} must have a value but sits in a loop.`); await client.end(); process.exit(1); }

// every profile must still have its sign-in account, or the insert would fail
if (set.has('profiles')) {
  const ids = plan.profiles.data.map((r) => r.id);
  const missing = ids.length ? (await rows(`select x from unnest($1::uuid[]) x where not exists (select 1 from auth.users u where u.id = x)`, [ids])).length : 0;
  console.log(missing ? `\n${missing} profile(s) in the backup have no sign-in account any more; the restore would fail. Restore with --tables= leaving profiles out, or ask first.` : `\nEvery profile in the backup still has its sign-in account.`);
  if (missing && (write || rehearse)) { await client.end(); process.exit(1); }
}

if (!write && !rehearse) {
  console.log('\n(dry run: nothing was changed. --rehearse tries it and undoes it; --write does it.)');
  await client.end(); process.exit(0);
}

if (write) {
  console.log('\nTaking a backup of the live database first…');
  const r = spawnSync(process.execPath, ['scripts/backup-db.mjs', '--name=before-restore'], { stdio: 'inherit' });
  if (r.status !== 0) { console.log('The backup failed, so nothing was restored.'); await client.end(); process.exit(1); }
}

try {
  await client.query('begin');
  await client.query(`truncate ${order.map(q).join(', ')} cascade`);
  for (const t of order) await client.query(`alter table ${q(t)} disable trigger user`);
  for (const t of order) {
    const { data, cols } = plan[t];
    if (!data.length) continue;
    const held = later.filter((l) => l.t === t).map((l) => l.c);
    const list = cols.map((c) => (held.includes(c) ? `null` : qc(c)));
    await client.query(`insert into ${q(t)} (${cols.map(qc).join(', ')}) overriding system value
      select ${list.join(', ')} from jsonb_populate_recordset(null::${q(t)}, $1::jsonb)`, [JSON.stringify(data)]);
  }
  for (const { t, c } of later) {
    const pk = (await rows(`select a.attname c from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
      where i.indrelid = $1::regclass and i.indisprimary`, [q(t)])).map((r) => r.c);
    await client.query(`update ${q(t)} x set ${qc(c)} = b.${qc(c)} from jsonb_populate_recordset(null::${q(t)}, $1::jsonb) b
      where ${pk.map((k) => `x.${qc(k)} = b.${qc(k)}`).join(' and ')}`, [JSON.stringify(plan[t].data)]);
  }
  for (const t of order) await client.query(`alter table ${q(t)} enable trigger user`);
  // sequences behind serial and identity columns move past the restored ids
  for (const t of order) for (const { c } of liveCols[t]) {
    const seq = (await rows(`select pg_get_serial_sequence($1, $2) s`, [q(t), c]))[0].s;
    if (seq) await client.query(`select setval($1, greatest(coalesce((select max(${qc(c)}) from ${q(t)}), 0), 1))`, [seq]);
  }
  const counts = [];
  for (const t of order) counts.push(`  ${t.padEnd(20)} ${(await rows(`select count(*)::int n from ${q(t)}`))[0].n}`);
  await client.query(rehearse ? 'rollback' : 'commit');
  console.log(`\n${rehearse ? 'Rehearsal worked, and was undone. Rows it would leave' : 'Restored. Rows now'}:\n${counts.join('\n')}`);
} catch (e) {
  await client.query('rollback').catch(() => {});
  console.log(`\nFailed, nothing was changed: ${e.message}`);
  await client.end(); process.exit(1);
}
await client.end();
