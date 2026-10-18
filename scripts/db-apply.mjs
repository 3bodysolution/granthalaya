// Applies the numbered SQL files in supabase/changes/ to the live database, once each.
//
//   npm run db:apply -- --dry        show what is waiting (changes nothing, not even the record-keeping table)
//   npm run db:apply                 run the waiting files, oldest first, each in its own transaction
//   npm run db:apply -- --mark 001   record a file as already applied (you ran it by hand) without running it
//
// Needs SUPABASE_DB_URL in .env (Supabase → Project Settings → Database → Connection string, session pooler).
// Which files have run is kept in the table public.applied_changes. Only run this when Sarthak asks (see CLAUDE.md).
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';

// the whole line after "=", so a password containing "#" or "@" is not cut short
let dbUrl = process.env.SUPABASE_DB_URL;
try {
  const line = fs.readFileSync('.env', 'utf8').split(/\r?\n/).find((l) => l.startsWith('SUPABASE_DB_URL='));
  if (line) dbUrl = line.slice('SUPABASE_DB_URL='.length).trim().replace(/^(["'])(.*)\1$/, '$2');
} catch { /* no .env: fall back to the environment */ }
const args = process.argv.slice(2);
const dry = args.includes('--dry');
const mark = args.includes('--mark') ? args[args.indexOf('--mark') + 1] : null;
if (!dbUrl) { console.log('Add SUPABASE_DB_URL to .env first.'); process.exit(1); }

const DIR = 'supabase/changes';
const CA = 'supabase/prod-ca-2021.crt';
const files = fs.readdirSync(DIR).filter((f) => /^\d+.*\.sql$/.test(f)).sort();
// Split the address by hand at the LAST "@", so a password with "@" or other symbols in it works unescaped.
function connection(url) {
  const m = url.match(/^postgres(?:ql)?:\/\/([^:@/]+):(.*)@([^@/:]+):(\d+)\/([^?]+)/);
  if (!m) { console.log('SUPABASE_DB_URL should look like postgresql://user:password@host:5432/postgres'); process.exit(1); }
  const [, user, password, host, port, database] = m;
  // the connection is verified against Supabase's own CA certificate (supabase/prod-ca-2021.crt)
  return { user, password, host, port: +port, database, ssl: { ca: fs.readFileSync(CA, 'utf8'), rejectUnauthorized: true } };
}
const client = new pg.Client(connection(dbUrl));
try { await client.connect(); } catch (e) { console.log(`Could not connect: ${e.message}`); process.exit(1); }

const tracked = (await client.query(`select to_regclass('public.applied_changes') as t`)).rows[0].t !== null;
const done = new Set(tracked ? (await client.query('select name from public.applied_changes')).rows.map((r) => r.name) : []);
const waiting = files.filter((f) => !done.has(f));

const ensure = () => client.query(`create table if not exists public.applied_changes (name text primary key, applied_at timestamptz not null default now());
  alter table public.applied_changes enable row level security;  -- no policies, and nothing granted below: the site's API can't see it
  revoke all on public.applied_changes from anon, authenticated;`);

if (mark) {
  const hit = files.filter((f) => f.startsWith(mark));
  if (!hit.length) { console.log(`No file in ${DIR} starts with "${mark}".`); await client.end(); process.exit(1); }
  if (dry) console.log(`Would record as already applied (without running): ${hit.join(', ')}${tracked ? '' : ' (and create public.applied_changes)'}`);
  else {
    await ensure();
    for (const f of hit) await client.query('insert into public.applied_changes (name) values ($1) on conflict do nothing', [f]);
    console.log(`Recorded as applied: ${hit.join(', ')}`);
  }
  await client.end(); process.exit(0);
}

console.log(`Database reached. ${tracked ? `${done.size} change(s) already applied.` : 'No record-keeping table yet (public.applied_changes), so every file counts as waiting.'}`);
if (!waiting.length) { console.log('Nothing waiting.'); await client.end(); process.exit(0); }
for (const f of waiting) {
  const sql = fs.readFileSync(path.join(DIR, f), 'utf8');
  console.log(`\n${dry ? 'Waiting' : 'Applying'}: ${f}`);
  if (dry) { console.log(sql.split('\n').filter((l) => l.trim() && !l.trim().startsWith('--')).map((l) => '    ' + l).join('\n')); continue; }
  try {
    await ensure();
    await client.query(sql);
    await client.query('insert into public.applied_changes (name) values ($1)', [f]);
    console.log('  done');
  } catch (e) {
    await client.query('rollback').catch((e2) => console.log(`  (rollback also failed: ${e2.message})`));
    console.log(`  failed, nothing from this file was kept: ${e.message}`);
    await client.end(); process.exit(1);
  }
}
if (dry) console.log('\n(dry run: nothing was changed)');
await client.end();
