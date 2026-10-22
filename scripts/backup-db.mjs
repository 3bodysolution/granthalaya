// A full copy of the live database's rows, taken before a change to its structure.
//
//   node scripts/backup-db.mjs                 writes private/backups/<date-time>.json.gz
//   node scripts/backup-db.mjs --name=before-008
//
// pg_dump isn't installed on this computer, so this reads every table in the public, auth and storage schemas
// (each row as JSON, so nothing is lost to formatting) plus what defines the structure as it is live: columns,
// indexes, constraints, policies, functions, triggers and grants. supabase/schema.sql in git is the readable version.
// Read only: it never changes the database. Needs SUPABASE_DB_URL in .env (read here, never printed).
// private/ is git-ignored, so backups are never committed.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import pg from 'pg';

let dbUrl = process.env.SUPABASE_DB_URL;
try {
  const line = fs.readFileSync('.env', 'utf8').split(/\r?\n/).find((l) => l.startsWith('SUPABASE_DB_URL='));
  if (line) dbUrl = line.slice('SUPABASE_DB_URL='.length).trim().replace(/^(["'])(.*)\1$/, '$2');
} catch { /* no .env: fall back to the environment */ }
if (!dbUrl) { console.log('Add SUPABASE_DB_URL to .env first.'); process.exit(1); }
const name = (process.argv.find((a) => a.startsWith('--name=')) ?? '').slice(7).replace(/[^a-z0-9-]/gi, '');

// same connection rules as db-apply.mjs: split at the last "@", verify against Supabase's CA
const m = dbUrl.match(/^postgres(?:ql)?:\/\/([^:@/]+):(.*)@([^@/:]+):(\d+)\/([^?]+)/);
if (!m) { console.log('SUPABASE_DB_URL should look like postgresql://user:password@host:5432/postgres'); process.exit(1); }
const [, user, password, host, port, database] = m;
const client = new pg.Client({ user, password, host, port: +port, database, ssl: { ca: fs.readFileSync('supabase/prod-ca-2021.crt', 'utf8'), rejectUnauthorized: true } });
try { await client.connect(); } catch (e) { console.log(`Could not connect: ${e.message}`); process.exit(1); }

const rows = async (sql) => (await client.query(sql)).rows;
// one snapshot for every table, so the copy is consistent
await client.query('begin isolation level repeatable read read only');
const out = { taken_at: new Date().toISOString(), server: (await rows('show server_version'))[0].server_version, tables: {}, structure: {}, skipped: [] };

const tables = await rows(`select table_schema s, table_name t from information_schema.tables
  where table_type = 'BASE TABLE' and table_schema in ('public', 'auth', 'storage') order by 1, 2`);
for (const { s, t } of tables) {
  const id = `${s}.${t}`;
  try {
    await client.query('savepoint one');
    out.tables[id] = (await rows(`select to_jsonb(x) as r from "${s}"."${t}" x`)).map((r) => r.r);
    await client.query('release savepoint one');
  } catch (e) {
    await client.query('rollback to savepoint one');
    out.skipped.push(`${id}: ${e.message}`);
  }
}

const S = `('public', 'auth', 'storage')`;
out.structure.columns = await rows(`select table_schema, table_name, column_name, data_type, is_nullable, column_default
  from information_schema.columns where table_schema in ${S} order by 1, 2, ordinal_position`);
out.structure.indexes = await rows(`select schemaname, tablename, indexname, indexdef from pg_indexes where schemaname = 'public' order by 2, 3`);
out.structure.constraints = await rows(`select conrelid::regclass::text as table, conname, pg_get_constraintdef(oid) as def
  from pg_constraint where connamespace = 'public'::regnamespace order by 1, 2`);
out.structure.policies = await rows(`select * from pg_policies where schemaname in ('public', 'storage') order by tablename, policyname`);
out.structure.functions = await rows(`select p.proname, pg_get_functiondef(p.oid) as def from pg_proc p
  where p.pronamespace = 'public'::regnamespace and p.prokind = 'f' order by 1`);
out.structure.triggers = await rows(`select tgrelid::regclass::text as table, tgname, pg_get_triggerdef(oid) as def
  from pg_trigger where not tgisinternal and tgrelid::regclass::text not like 'auth.%' order by 1, 2`);
out.structure.grants = await rows(`select table_schema, table_name, grantee, privilege_type from information_schema.role_table_grants
  where table_schema = 'public' order by 2, 3, 4`);
await client.query('commit');
await client.end();

const dir = 'private/backups';
fs.mkdirSync(dir, { recursive: true });
const stamp = out.taken_at.slice(0, 16).replace(/[:T]/g, '-');
const file = path.join(dir, `${stamp}${name ? `-${name}` : ''}.json.gz`);
const gz = zlib.gzipSync(JSON.stringify(out));
fs.writeFileSync(file, gz);

const counts = Object.entries(out.tables).filter(([, r]) => r.length).map(([t, r]) => `  ${t.padEnd(36)} ${String(r.length).padStart(6)}`);
console.log(`Postgres ${out.server}. Rows per table (empty tables left out of this list):\n${counts.join('\n')}`);
if (out.skipped.length) console.log(`Could not read:\n  ${out.skipped.join('\n  ')}`);
console.log(`\nSaved ${file}: ${(gz.length / 1024).toFixed(0)} KB compressed (${(JSON.stringify(out).length / 1024 / 1024).toFixed(1)} MB as text).`);
