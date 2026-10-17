// npm run check:site: looks over the local copy (npm run dev must be running) and says what is broken.
//   1. the main pages load
//   2. every list: its tile links open and its covers exist (a sample per list; add --full for every item)
//   3. with only the public (anon) key, the database keeps private things private
//
//   npm run check:site
//   npm run check:site -- --full --base http://localhost:4321
//
// The anon key is read from .env inside this script and never printed. Exits with 1 when something failed.
import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';

try {
  for (const line of fs.readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*"?([^"#]*?)"?\s*(#.*)?$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
} catch {}

const args = process.argv.slice(2);
const flag = (f) => args.includes(f);
const opt = (f, d) => { const i = args.indexOf(f); return i < 0 ? d : args[i + 1]; };
const BASE = opt('--base', 'http://localhost:4321');
const SAMPLE = flag('--full') ? Infinity : 6;

let bad = 0;
const note = [];
const ok = (m) => console.log(`  ok    ${m}`);
const fail = (m) => { bad++; console.log(`  FAIL  ${m}`); };
const info = (m) => { note.push(m); console.log(`  note  ${m}`); };
const head = (t) => console.log(`\n${t}`);

async function pool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); }
  }));
  return out;
}
// the catalogue sites slow down when asked a lot at once, so a failed answer is asked again after a pause
const again = async (fn, bad) => { let r = await fn(); if (bad(r)) { await new Promise((x) => setTimeout(x, 1500)); r = await fn(); } return r; };
const get = (url, init = {}) => fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(45000), ...init });

// ───────── 1. main pages ─────────
head('1. Main pages');
try { await get(BASE + '/'); } catch { console.log(`Can't reach ${BASE}. Start it with npm run dev.`); process.exit(1); }
const pages = [
  ['/', 200], ['/films/', 200], ['/films/?kind=tv', 200], ['/books/', 200], ['/essays/', 200], ['/lists/', 200],
  ['/books/?list=booker', 200], ['/films/?list=palme-dor', 200], ['/lists/nobel-literature/', 200],
  ['/about', 200], ['/privacy', 200], ['/terms', 200], ['/signin', 200], ['/this-page-does-not-exist/', 404],
];
await pool(pages, 4, async ([p, want]) => {
  const r = await get(BASE + p).catch((e) => ({ status: 0, text: async () => String(e) }));
  const html = r.status ? await r.text() : '';
  if (r.status !== want) fail(`${p} answered ${r.status}, expected ${want}`);
  else if (want === 200 && (!/<title>[^<]+<\/title>/.test(html) || /Internal Server Error|Unhandled|ReferenceError|TypeError/.test(html))) fail(`${p} loaded but looks broken`);
  else ok(`${p} ${r.status}`);
});

// ───────── 2. lists ─────────
head(`2. Lists (${SAMPLE === Infinity ? 'every item' : `${SAMPLE} links per list`}, every cover)`);
const slugs = fs.readdirSync('src/data/lists').filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, ''));
const listPages = [...slugs.map((s) => [s, `/lists/${s}/`]), ['suggested-marathi', '/books/?list=suggested-marathi'], ['suggested-hindi', '/books/?list=suggested-hindi']];
const seenLinks = new Map(), seenCovers = new Map();
for (const [slug, path] of listPages) {
  const html = await get(BASE + path).then((r) => r.text()).catch(() => '');
  if (!html) { fail(`${slug}: page didn't load`); continue; }
  const inList = html.includes('class="lg') ? html.slice(html.indexOf('class="lg')) : html;
  const links = [...new Set([...inList.matchAll(/<a [^>]*href="(\/(?:film|tv|book)\/[^"#?]+)"/g)].map((m) => m[1]))];
  const covers = [...new Set([...inList.matchAll(/<img src="(https?:[^"]+)"/g)].map((m) => m[1]))];
  const items = slugs.includes(slug) ? JSON.parse(fs.readFileSync(`src/data/lists/${slug}.json`, 'utf8')).items.length : null;
  const sample = links.length <= SAMPLE ? links : Array.from({ length: SAMPLE }, (_, i) => links[Math.floor((i * links.length) / SAMPLE)]);
  const dead = [];
  await pool(sample.filter((l) => !seenLinks.has(l)), 2, async (l) => {
    const r = await again(() => get(BASE + l).catch(() => ({ status: 0 })), (x) => x.status !== 200);
    seenLinks.set(l, r.status);
  });
  for (const l of sample) if (seenLinks.get(l) !== 200) dead.push(`${l} (${seenLinks.get(l)})`);
  await pool(covers.filter((c) => !seenCovers.has(c)), 3, async (c) => {
    const r = await again(() => get(c, { method: 'HEAD' }).catch(() => ({ status: 0 })), (x) => x.status === 0 || x.status >= 400);
    seenCovers.set(c, r.status);
  });
  const deadCovers = covers.filter((c) => (seenCovers.get(c) ?? 0) >= 400 || seenCovers.get(c) === 0);
  const own = items ? `${links.length} of ${items} items have a page` : `${links.length} items`;
  if (dead.length || deadCovers.length) fail(`${slug}: ${dead.length} bad links ${dead.slice(0, 3).join(', ')}; ${deadCovers.length} bad covers ${deadCovers.slice(0, 2).join(', ')}`);
  else ok(`${slug}: ${own}, ${sample.length} links and ${covers.length} covers answer`);
}

// ───────── 3. privacy, with the anon key only ─────────
head('3. Privacy (public key only)');
const url = process.env.PUBLIC_SUPABASE_URL, key = process.env.PUBLIC_SUPABASE_PUBLISHABLE_KEY;
if (!url || !key) info('No public Supabase values in .env, so the privacy checks were skipped.');
else {
  const db = createClient(url, key, { auth: { persistSession: false } });
  const rows = async (q) => { const { data, error } = await q; return { data: data ?? [], error }; };

  // "Only me" entries
  let r = await rows(db.from('logs').select('id').eq('only_me', true).limit(5));
  r.data.length ? fail(`anyone can read ${r.data.length}+ "Only me" entries`) : ok('"Only me" entries are not readable');

  // private accounts
  const priv = await rows(db.from('profiles').select('id, username').eq('is_private', true).limit(50));
  if (priv.error) info(`private accounts: could not list them (${priv.error.message})`);
  let leaked = 0;
  for (const p of priv.data) {
    for (const t of ['logs', 'highlights', 'threads']) {
      const x = await rows(db.from(t).select('id').eq('user_id', p.id).limit(1));
      if (x.data.length) { leaked++; fail(`${t} of private account @${p.username} can be read`); }
    }
    const lib = await get(`${BASE}/@${p.username}/library/`).then((x) => x.text()).catch(() => '');
    const links = [...lib.matchAll(new RegExp(`href="/@${p.username}/library/[^"/]+/?"`, 'g'))].length;
    if (links) { leaked++; fail(`@${p.username}'s library page lists ${links} entries to a stranger`); }
  }
  if (!leaked) ok(priv.data.length ? `${priv.data.length} private account(s): entries, lines, collections and library page are closed` : 'no private accounts exist to test (the policy was not exercised)');
  if (!priv.data.length) info('Make a private test account to exercise the private-account checks.');

  // tables nobody should read without signing in
  for (const t of ['blocks', 'reports', 'applied_changes']) {
    const x = await rows(db.from(t).select('*').limit(1));
    x.data.length ? fail(`${t}: a stranger can read rows`) : ok(`${t}: closed to strangers${x.error ? ' (refused)' : ' (empty)'}`);
  }
  const hid = await rows(db.from('book_suggestions').select('id').eq('hidden', true).limit(1));
  hid.data.length ? fail('hidden book suggestions can be read') : ok('hidden book suggestions are not readable');

  // nobody can write
  const w = await db.from('titles').insert({ kind: 'book', slug: 'check-site-test', title: 'x' });
  w.error ? ok('a stranger cannot add to the catalogue') : fail('a stranger added a row to titles (delete slug check-site-test!)');
  const w2 = await db.from('book_suggestions').update({ hidden: true }).eq('language', 'zz');
  w2.error ? ok('a stranger cannot change book suggestions') : info('book_suggestions update by a stranger did not error (it matched no rows; check the grants if unsure)');
  info('Blocked users cannot be tested without signing in as one; this needs a test account (not done).');
}

console.log(`\n${bad ? `${bad} problem(s) found.` : 'All good.'}`);
process.exit(bad ? 1 : 0);
