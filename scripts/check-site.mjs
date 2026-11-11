// npm run check:site: looks over the local copy (npm run dev must be running) and says what is broken.
//   1. the main pages load
//   2. every list: its tile links open and its covers exist (a sample per list; add --full for every item)
//   3. with only the public (anon) key, the database keeps private things private
//
//   npm run check:site
//   npm run check:site -- --full --base http://localhost:4321
//
// The anon key is read from .env inside this script and never printed.
// At the end every failure is listed again with the check's name and the page, in two groups:
//   - Real problems: something on this site is wrong (a wrong answer, a missing page, a privacy rule that doesn't hold).
//   - Outside service (retry later): TMDB, Open Library or another service didn't answer (our pages say 503 then, or nothing came back in time).
// Exit code: 1 when there are real problems, 2 when only outside services failed, 0 when all is good.
import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { checkWidth, phonePages, reportWidth } from './lib/widthcheck.mjs';

try {
  for (const line of fs.readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*"?([^"#]*?)"?\s*(#.*)?$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
} catch { /* no .env */ }

const args = process.argv.slice(2);
const flag = (f) => args.includes(f);
const opt = (f, d) => { const i = args.indexOf(f); return i < 0 ? d : args[i + 1]; };
const BASE = opt('--base', 'http://localhost:4321');
const SAMPLE = flag('--full') ? Infinity : 6;

const note = [];
const failures = [];   // { check, page, msg, outside }
const ok = (m) => console.log(`  ok    ${m}`);
// check = the name of the check, page = the address it was about; outside = an outside service (TMDB, Open Library...) didn't answer
const fail = (m, { check = '', page = '', outside = false } = {}) => { failures.push({ check, page, msg: m, outside }); console.log(`  ${outside ? 'OUTSIDE ' : 'FAIL    '}${m}${outside ? '  (outside service, retry later)' : ''}`); };
// our pages answer 503 when a catalogue (TMDB, Open Library) isn't answering; no answer at all is a timeout
const outsideStatus = (st) => st === 503 || st === 0 || st === undefined;
const info = (m) => { note.push(m); console.log(`  note  ${m}`); };
let slow = 0;
const warn = (m) => { slow++; console.log(`  warn  ${m}`); };
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
const again = async (fn, bad) => { let r = await fn(); for (const pause of [1500, 4000]) { if (!bad(r)) break; await new Promise((x) => setTimeout(x, pause)); r = await fn(); } return r; };
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
  // asked once more after a pause if it didn't answer as expected (a catalogue can be busy for a moment)
  const r = await again(() => get(BASE + p).catch((e) => ({ status: 0, text: async () => String(e) })), (x) => x.status !== want);
  const html = r.status ? await r.text() : '';
  if (r.status !== want) fail(`${p} answered ${r.status}${r.status === 503 ? ' (a catalogue is not answering)' : ''}, expected ${want}`, { check: '1. Main pages', page: p, outside: outsideStatus(r.status) && !/^\/(about|privacy|terms|signin)/.test(p) });
  else if (want === 200 && (!/<title>[^<]+<\/title>/.test(html) || /Internal Server Error|Unhandled|ReferenceError|TypeError/.test(html))) fail(`${p} loaded but looks broken`, { check: '1. Main pages', page: p });
  else ok(`${p} ${r.status}`);
});

// ───────── 2. lists ─────────
head(`2. Lists (${SAMPLE === Infinity ? 'every item' : `${SAMPLE} links per list`}, every cover)`);
const slugs = fs.readdirSync('src/data/lists').filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, ''));
const listPages = [...slugs.map((s) => [s, `/lists/${s}/`])];
const seenLinks = new Map(), seenCovers = new Map();
for (const [slug, path] of listPages) {
  const listRes = await get(BASE + path).catch(() => null);
  const html = listRes ? await listRes.text().catch(() => '') : '';
  if (!html) { fail(`${slug}: page didn't load${listRes ? ` (${listRes.status})` : ''}`, { check: '2. Lists', page: path, outside: !listRes || outsideStatus(listRes.status) }); continue; }
  const inList = html.includes('class="lg') ? html.slice(html.indexOf('class="lg')) : html;
  const links = [...new Set([...inList.matchAll(/<a [^>]*href="(\/(?:film|tv|book)\/[^"#?]+)"/g)].map((m) => m[1]))];
  const covers = [...new Set([...inList.matchAll(/<img src="(https?:[^"]+)"/g)].map((m) => m[1].replaceAll('&amp;', '&')))];
  const items = slugs.includes(slug) ? JSON.parse(fs.readFileSync(`src/data/lists/${slug}.json`, 'utf8')).items.length : null;
  const sample = links.length <= SAMPLE ? links : Array.from({ length: SAMPLE }, (_, i) => links[Math.floor((i * links.length) / SAMPLE)]);
  const dead = [], deadOutside = [];
  await pool(sample.filter((l) => !seenLinks.has(l)), 2, async (l) => {
    const r = await again(() => get(BASE + l).catch(() => ({ status: 0 })), (x) => x.status !== 200);
    seenLinks.set(l, r.status);
  });
  for (const l of sample) if (seenLinks.get(l) !== 200) (outsideStatus(seenLinks.get(l)) ? deadOutside : dead).push(`${l} (${seenLinks.get(l)})`);
  await pool(covers.filter((c) => !seenCovers.has(c)), 3, async (c) => {
    // asked once with HEAD and, if that fails, once more with GET after a pause (some image hosts answer HEAD badly)
    let r = await get(c, { method: 'HEAD' }).catch(() => ({ status: 0 }));
    if (r.status === 0 || r.status >= 400) { await new Promise((x) => setTimeout(x, 1500)); r = await get(c).catch(() => ({ status: 0 })); }
    seenCovers.set(c, r.status);
  });
  // only a cover the host says doesn't exist (404, 410) is a failure; one that is slow, busy or refused after the retry is a warning
  const unanswered = covers.filter((c) => (seenCovers.get(c) ?? 0) >= 400 || seenCovers.get(c) === 0);
  const deadCovers = unanswered.filter((c) => [404, 410].includes(seenCovers.get(c)));
  const slowCovers = unanswered.filter((c) => !deadCovers.includes(c));
  if (slowCovers.length) warn(`${slug}: ${slowCovers.length} cover(s) slow or busy even after a retry (${slowCovers.slice(0, 2).map((c) => `${c} ${seenCovers.get(c) || 'no answer'}`).join(', ')})`);
  const own = items ? `${links.length} of ${items} items have a page` : `${links.length} items`;
  // a title page that answered 503 (TMDB or Open Library not answering) is an outside service, not a broken link
  if (deadOutside.length) fail(`${slug}: ${deadOutside.length} page(s) not answering ${deadOutside.slice(0, 3).join(', ')}`, { check: '2. Lists (links)', page: deadOutside.slice(0, 3).join(', '), outside: true });
  if (dead.length || deadCovers.length) fail(`${slug}: ${dead.length} bad links ${dead.slice(0, 3).join(', ')}; ${deadCovers.length} bad covers ${deadCovers.slice(0, 2).join(', ')}`, { check: '2. Lists', page: [...dead.slice(0, 3), ...deadCovers.slice(0, 2)].join(', ') || path });
  else if (!deadOutside.length) ok(`${slug}: ${own}, ${sample.length} links and ${covers.length} covers answer`);
}

// ───────── 3. privacy, with the anon key only ─────────
// ───────── 2b. phone width ─────────
// A page wider than the screen makes a real phone (Chrome on Android) zoom the whole page out. Uses the Pixel 7 profile
// and iPhone 13 profiles (isMobile, hasTouch) at 360 and 390px and measures; looking at a screenshot does not catch it.
head('2b. Phone width (Pixel 7 and iPhone 13 profiles, 360 and 390px)');
{
  const wp = await phonePages(BASE, opt('--user', 'sarthak'));
  const res = await checkWidth(BASE, wp, { widths: [360, 390] });
  for (const r of reportWidth(res)) fail(r.error ? `could not load on ${r.device} ${r.width}px (${r.error})` : `wider than the screen: ${Math.max(r.scrollWidth, r.innerWidth)}px on ${r.device} at ${r.width}px. Sticking out: ${r.offenders.slice(0, 3).map((o) => o.el + ' ' + o.right + 'px').join('; ') || 'unknown'}`, { check: '2b. Phone width', page: r.path, outside: !!r.error });
}

head('3. Privacy (public key only)');
const url = process.env.PUBLIC_SUPABASE_URL, key = process.env.PUBLIC_SUPABASE_PUBLISHABLE_KEY;
if (!url || !key) info('No public Supabase values in .env, so the privacy checks were skipped.');
else {
  const db = createClient(url, key, { auth: { persistSession: false } });
  const rows = async (q) => { const { data, error } = await q; return { data: data ?? [], error }; };

  // "Only me" entries
  let r = await rows(db.from('logs').select('id').eq('only_me', true).limit(5));
  r.data.length ? fail(`anyone can read ${r.data.length}+ "Only me" entries`, { check: '3. Privacy', page: 'logs' }) : ok('"Only me" entries are not readable');

  // private accounts
  const priv = await rows(db.from('profiles').select('id, username').eq('is_private', true).limit(50));
  if (priv.error) info(`private accounts: could not list them (${priv.error.message})`);
  let leaked = 0;
  for (const p of priv.data) {
    for (const t of ['logs', 'highlights', 'threads']) {
      const x = await rows(db.from(t).select('id').eq('user_id', p.id).limit(1));
      if (x.data.length) { leaked++; fail(`${t} of private account @${p.username} can be read`, { check: '3. Privacy', page: t }); }
    }
    const lib = await get(`${BASE}/@${p.username}/library/`).then((x) => x.text()).catch(() => '');
    const links = [...lib.matchAll(new RegExp(`href="/@${p.username}/library/[^"/]+/?"`, 'g'))].length;
    if (links) { leaked++; fail(`@${p.username}'s library page lists ${links} entries to a stranger`, { check: '3. Privacy', page: `/@${p.username}/library/` }); }
  }
  if (!leaked) ok(priv.data.length ? `${priv.data.length} private account(s): entries, lines, collections and library page are closed` : 'no private accounts exist to test (the policy was not exercised)');
  if (!priv.data.length) info('Make a private test account to exercise the private-account checks.');

  // tables nobody should read without signing in
  for (const t of ['blocks', 'reports', 'applied_changes']) {
    const x = await rows(db.from(t).select('*').limit(1));
    x.data.length ? fail(`${t}: a stranger can read rows`, { check: '3. Privacy', page: t }) : ok(`${t}: closed to strangers${x.error ? ' (refused)' : ' (empty)'}`);
  }
  // who runs the site, who is featured and when a name changed are not public
  for (const col of ['is_admin', 'featured', 'username_changed_at']) {
    const x = await rows(db.from('profiles').select(col).limit(1));
    x.error && !x.data.length ? ok(`profiles.${col} is hidden from strangers`) : fail(`profiles.${col} can be read by a stranger`, { check: '3. Privacy', page: `profiles.${col}` });
  }
  const hid = await rows(db.from('book_suggestions').select('id').eq('hidden', true).limit(1));
  hid.data.length ? fail('hidden book suggestions can be read', { check: '3. Privacy', page: 'book_suggestions' }) : ok('hidden book suggestions are not readable');

  // nobody can write
  const w = await db.from('titles').insert({ kind: 'book', slug: 'check-site-test', title: 'x' });
  w.error ? ok('a stranger cannot add to the catalogue') : fail('a stranger added a row to titles (delete slug check-site-test!)', { check: '3. Privacy', page: 'titles' });
  const w2 = await db.from('book_suggestions').update({ hidden: true }).eq('language', 'zz');
  w2.error ? ok('a stranger cannot change book suggestions') : info('book_suggestions update by a stranger did not error (it matched no rows; check the grants if unsure)');

  // reviews, likes and comments (supabase/changes/009)
  const probe = await db.from('review_likes').select('log_id').limit(1);
  if (probe.error) info(`reviews: not checked (${probe.error.message}); is 009 applied?`);
  else {
    // every like and comment a stranger can read must sit on a review a stranger can read (not "Only me", not a private account)
    let leaks = 0;
    for (const t of ['review_likes', 'review_comments']) {
      const x = await rows(db.from(t).select('log_id, log:logs(id, only_me, owner:profiles!logs_user_id_fkey(is_private))').limit(1000));
      const badRows = x.data.filter((l) => !l.log || l.log.only_me || l.log.owner?.is_private);
      if (badRows.length) { leaks++; fail(`${t}: ${badRows.length} row(s) readable on a review a stranger can't see`, { check: '3. Privacy (reviews)', page: t }); }
      else ok(`${t}: ${x.data.length} readable, all on public reviews`);
    }
    // title_reviews over the whole catalogue: nothing "Only me", nothing from a private account
    const ids = (await rows(db.from('titles').select('id').limit(2000))).data.map((t) => t.id);
    const rv = await db.rpc('title_reviews', { title_ids: ids, sort: 'recent', lim: 50, off: 0 });
    if (rv.error) fail(`title_reviews failed for a stranger: ${rv.error.message}`, { check: '3. Privacy (reviews)', page: 'title_reviews' });
    else {
      const privIds = new Set(priv.data.map((p) => p.id));
      const fromPriv = (rv.data ?? []).filter((r) => privIds.has(r.user_id));
      const seen = rv.data.length ? (await rows(db.from('logs').select('id').in('id', rv.data.map((r) => r.id)))).data.length : 0;
      if (fromPriv.length) fail(`title_reviews shows ${fromPriv.length} review(s) from private accounts`, { check: '3. Privacy (reviews)', page: 'title_reviews' });
      else if (seen !== rv.data.length) fail(`title_reviews shows ${rv.data.length - seen} review(s) a stranger can't read directly`, { check: '3. Privacy (reviews)', page: 'title_reviews' });
      else ok(`title_reviews: ${rv.data.length} review(s) shown to a stranger, none private or "Only me"`);
    }
    // nobody can like or comment as someone else (here: without signing in at all)
    // a public review if there is one; otherwise made-up ids (a stranger must be refused before any row is looked at)
    const someLog = (await rows(db.from('logs').select('id, user_id').neq('notes', '').limit(1))).data[0]
      ?? { id: '00000000-0000-4000-8000-000000000001', user_id: priv.data[0]?.id ?? '00000000-0000-4000-8000-000000000002' };
    {
      const l = await db.from('review_likes').insert({ log_id: someLog.id, user_id: someLog.user_id });
      l.error ? ok('a stranger cannot like a review as someone else') : (leaks++, fail('a stranger added a like (delete it from review_likes!)', { check: '3. Privacy (reviews)', page: 'review_likes' }));
      const c = await db.from('review_comments').insert({ log_id: someLog.id, user_id: someLog.user_id, body: 'check-site test' });
      c.error ? ok('a stranger cannot comment as someone else') : (leaks++, fail('a stranger added a comment (delete "check-site test" from review_comments!)', { check: '3. Privacy (reviews)', page: 'review_comments' }));
    }
    if (!leaks) info('Signed-in checks (liking as another account, blocked people) need a test account (not done).');
  }
  info('Blocked users cannot be tested without signing in as one; this needs a test account (not done).');
}

// ---------- summary ----------
const real = failures.filter((f) => !f.outside), outside = failures.filter((f) => f.outside);
const line = (f) => `  - [${f.check || 'check'}] ${f.page || '-'}: ${f.msg}`;
if (real.length) { console.log(`\nReal problems (${real.length}):`); real.forEach((f) => console.log(line(f))); }
if (outside.length) { console.log(`\nOutside service (retry later) (${outside.length}):`); outside.forEach((f) => console.log(line(f))); console.log('  These are TMDB, Open Library or another service not answering. Run the check again in a few minutes.'); }
console.log(`\n${real.length ? `${real.length} real problem(s) found.` : outside.length ? `No real problems. ${outside.length} check(s) failed because an outside service did not answer (retry later).` : 'All good.'}${slow ? ` (${slow} warning(s): covers only slow or busy, not missing.)` : ''}`);
process.exit(real.length ? 1 : outside.length ? 2 : 0);
