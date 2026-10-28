// One book in two rows (a list record and a shop book, or the same book from both shops): find them, and merge them into one row.
//   node scripts/merge-titles.mjs               dry run: lists every cluster, changes nothing; writes private/catalogues/merge-plan.md and .json
//   node scripts/merge-titles.mjs --rehearse    does the whole merge inside a transaction and rolls it back (proves it works, saves nothing)
//   node scripts/merge-titles.mjs --write       merges (only when Sarthak asks; take a backup first: node scripts/backup-db.mjs --name=before-merge)
//   private/catalogues/merge-decisions.json  { "skip": ["<winner slug>", ...] }  clusters left alone
//
// Same book = same language (or one has none), same title (Devanagari or English, spellings compared loosely: scripts/shops/text.mjs),
// same author's surname (both must name one), neither a different Open Library work, and at least one has a cover or shop details.
// The row that stays (the winner): the one with an Open Library page, else the one with the most logs, else the one with shop details,
// else the older. Into it go: every log (so reviews, ratings and dates), collection items, favourites, shop rows, suggestions, and any
// empty field (cover, publisher, description, original title...). The other row is then deleted. List files that name the old slug are
// pointed at the winner (src/data/lists/*.json) and old addresses redirect (src/data/slug-redirects.json).
// Needs SUPABASE_DB_URL in .env (read here, never printed).
import fs from 'node:fs';
import pg from 'pg';
import { titleKey, mainKey, surnameKey } from './shops/text.mjs';

// one author written two ways (a pen name): both surnames count as the same person
const ALIASES = [['Shirwadkar', 'Kusumagraj'], ['Sane', 'Sane Guruji'], ['Prakash', 'Prakash Pandit']].map((g) => g.map(surnameKey));
const authorKey = (name) => { const k = surnameKey(name); return ALIASES.find((g) => g.includes(k))?.[0] ?? k; };
/** the numbers in a title (volumes, parts), Devanagari digits too: "Part 1 & 2" and "Part 1" are different books */
const numbers = (s) => (String(s ?? '').replace(/[०-९]/g, (d) => '०१२३४५६७८९'.indexOf(d)).match(/\d+/g) ?? []).join(',');

let dbUrl = process.env.SUPABASE_DB_URL;
try {
  const line = fs.readFileSync('.env', 'utf8').split(/\r?\n/).find((l) => l.startsWith('SUPABASE_DB_URL='));
  if (line) dbUrl = line.slice('SUPABASE_DB_URL='.length).trim().replace(/^(["'])(.*)\1$/, '$2');
} catch { /* environment */ }
if (!dbUrl) { console.log('Add SUPABASE_DB_URL to .env first.'); process.exit(1); }
const m = dbUrl.match(/^postgres(?:ql)?:\/\/([^:@/]+):(.*)@([^@/:]+):(\d+)\/([^?]+)/);
const client = new pg.Client({ user: m[1], password: m[2], host: m[3], port: +m[4], database: m[5], ssl: { ca: fs.readFileSync('supabase/prod-ca-2021.crt', 'utf8'), rejectUnauthorized: true } });
await client.connect();
const write = process.argv.includes('--write'), rehearse = process.argv.includes('--rehearse');
const OUT = 'private/catalogues';
const q = async (sql, args) => (await client.query(sql, args)).rows;

/* ——— the books and what hangs on each ——— */
const books = await q(`select id, slug, title, original_title, creator, language, year, ol_key, source, cover_url, cover_from, publisher, pages, description, created_at from public.titles where kind = 'book'`);
const count = async (sql) => new Map((await q(sql)).map((r) => [r.id, +r.n]));
const logs = await count('select title_id as id, count(*) n from public.logs group by 1');
const items = await count('select title_id as id, count(*) n from public.thread_items group by 1');
const shops = await count('select title_id as id, count(*) n from public.shop_books where title_id is not null group by 1');
const sugg = await count('select title_id as id, count(*) n from public.book_suggestions group by 1');
const favs = await count('select t as id, count(*) n from public.profile_details, unnest(favourites) t group by 1');
const listFiles = fs.readdirSync('src/data/lists').filter((f) => f.endsWith('.json'));
const listEntries = new Map();   // slug → how many list files name it
for (const f of listFiles) { const l = JSON.parse(fs.readFileSync(`src/data/lists/${f}`, 'utf8')); for (const i of l.items) if (i.slug) listEntries.set(i.slug, (listEntries.get(i.slug) ?? 0) + 1); }
for (const b of books) {
  b.logs = logs.get(b.id) ?? 0; b.items = items.get(b.id) ?? 0; b.shops = shops.get(b.id) ?? 0; b.sugg = sugg.get(b.id) ?? 0; b.favs = favs.get(b.id) ?? 0; b.lists = listEntries.get(b.slug) ?? 0;
  b.full = [...new Set([titleKey(b.title), titleKey(b.original_title)].filter((k) => k.length >= 2))];
  b.main = [...new Set([mainKey(b.title), mainKey(b.original_title)].filter((k) => k.length >= 2))];
  b.tkeys = [...new Set([...b.full, ...b.main])];
  b.akey = authorKey(b.creator);
  b.nums = numbers(`${b.title} ${b.original_title ?? ''}`);
  b.weight = b.logs + b.items + b.favs;
}

/* ——— clusters ——— */
const parent = books.map((_, i) => i);
const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
const noAuthor = [];
// the whole titles agree; or, when one side has no shop details (a list record with just "Natsamrat"), its title agrees with the other's main part
const same = (a, b) => (a.language && b.language ? a.language === b.language : true) && a.nums === b.nums
  && (a.full.some((k) => b.full.includes(k)) || ((a.shops === 0 || b.shops === 0) && a.main.some((k) => b.tkeys.includes(k) || b.main.includes(k))))
  && !(a.ol_key && b.ol_key && a.ol_key !== b.ol_key);
const useful = (b) => !!b.cover_url || b.shops > 0 || !!b.publisher;
const byKey = new Map();
books.forEach((b, i) => b.tkeys.forEach((k) => byKey.set(k, [...(byKey.get(k) ?? []), i])));
for (const idxs of byKey.values()) for (let x = 0; x < idxs.length; x++) for (let y = x + 1; y < idxs.length; y++) {
  const a = books[idxs[x]], b = books[idxs[y]];
  if (a.id === b.id || !same(a, b) || !(useful(a) || useful(b))) continue;
  if (!a.akey || !b.akey) { noAuthor.push([a, b]); continue; }
  if (a.akey === b.akey) parent[find(idxs[x])] = find(idxs[y]);
}
const groups = new Map();
books.forEach((b, i) => { const g = find(i); groups.set(g, [...(groups.get(g) ?? []), b]); });
const clusters = [...groups.values()].filter((g) => g.length > 1).map((rows) => {
  const win = [...rows].sort((a, b) => (Number(!!b.ol_key) - Number(!!a.ol_key)) || (b.weight - a.weight) || (b.shops - a.shops) || (new Date(a.created_at) - new Date(b.created_at)))[0];
  return { winner: win, losers: rows.filter((r) => r !== win) };
}).sort((a, b) => a.winner.title.localeCompare(b.winner.title));

/* ——— list entries that name a row with no cover, or only an Open Library work we have no row for ——— */
const winnerOf = new Map();   // row id → the row that will stay
for (const c of clusters) for (const l of c.losers) winnerOf.set(l.id, c.winner);
const good = books.filter((b) => b.cover_url && (b.shops > 0 || b.publisher));
const repoint = [];
for (const f of listFiles) {
  const l = JSON.parse(fs.readFileSync(`src/data/lists/${f}`, 'utf8'));
  if (l.kind !== 'book') continue;
  for (const i of l.items) {
    if (i.cover) continue;
    const own = books.find((b) => i.slug && b.slug === i.slug) ?? books.find((b) => i.ol && b.ol_key === i.ol);
    const base = own ? (winnerOf.get(own.id) ?? own) : null;
    if (base?.cover_url) continue;   // its own row (or the one it merges into) already has a cover
    const it = { language: i.language ?? null, nums: numbers(`${i.title} ${i.original_title ?? ''}`), akey: authorKey(i.creator), full: [titleKey(i.title), titleKey(i.original_title)].filter((k) => k.length >= 2), main: [mainKey(i.title), mainKey(i.original_title)].filter((k) => k.length >= 2), shops: 0 };
    const hit = good.filter((b) => b !== own && it.akey && it.akey === b.akey && same(it, b));
    if (hit.length === 1) repoint.push({ list: f, title: i.title, creator: i.creator, was: own?.slug ?? i.ol ?? '-', now: hit[0].slug, cover: hit[0].cover_url });
  }
}

/* ——— the report ——— */
const d = (b) => `${b.title}${b.original_title ? ` / ${b.original_title}` : ''}, ${b.creator || 'no author'} [${b.slug}; ${b.source ?? '?'}${b.ol_key ? `; ${b.ol_key}` : ''}; ${b.cover_url ? 'cover' : 'no cover'}; ${b.logs} logs, ${b.items} collection items, ${b.favs} favourites, ${b.shops} shop rows, ${b.sugg} suggestions, ${b.lists} list entries]`;
const lines = [
  `# Books in two rows (dry run ${new Date().toLocaleDateString('en-CA')})`, '',
  `${books.length} books. ${clusters.length} clusters of the same book (${clusters.reduce((n, c) => n + c.losers.length, 0)} rows would go). Nothing was changed.`,
  `Left alone: ${noAuthor.length} pairs with the same title where one has no author named.`, '',
  ...clusters.flatMap((c, n) => [`${n + 1}. KEEP ${d(c.winner)}`, ...c.losers.map((l) => `    MERGE IN ${d(l)}`)]),
  '', `## List entries that would point at a better row (${repoint.length})`, '',
  ...repoint.map((r) => `- ${r.title} (${r.creator}) in ${r.list}: ${r.was} → ${r.now}`),
  '', '## Same title, one side names no author (not merged)', '',
  ...noAuthor.slice(0, 60).map(([a, b]) => `- ${d(a)}  |  ${d(b)}`),
];
fs.writeFileSync(`${OUT}/merge-plan.md`, lines.join('\n'));
fs.writeFileSync(`${OUT}/merge-plan.json`, JSON.stringify({ clusters: clusters.map((c) => ({ keep: c.winner.slug, merge: c.losers.map((l) => l.slug) })), repoint }, null, 1));
const withLogs = clusters.filter((c) => c.losers.some((l) => l.logs + l.items + l.favs > 0));
console.log(lines.slice(0, 3).join('\n'));
console.log(`List entries that would point at a better row: ${repoint.length}.`);
console.log(`In ${withLogs.length} clusters a row that goes has logs, collection items or favourites (they move to the row that stays).`);
console.log(`Written: ${OUT}/merge-plan.md and merge-plan.json.`);
if (!write && !rehearse) { console.log('Nothing was changed (dry run).'); await client.end(); process.exit(0); }

/* ——— merging (one transaction per cluster) ——— */
const decided = fs.existsSync(`${OUT}/merge-decisions.json`) ? JSON.parse(fs.readFileSync(`${OUT}/merge-decisions.json`, 'utf8')) : { skip: [] };
const FILL = ['original_title', 'language', 'year', 'pages', 'publisher', 'description', 'description_source', 'description_url', 'description_checked_at', 'tagline', 'card_bg', 'link', 'note', 'trivia_source', 'color'];
const moved = {};   // old slug → winner slug
let merged = 0, failed = 0;
for (const c of clusters.filter((x) => !decided.skip.includes(x.winner.slug))) {
  try {
    await client.query('begin');
    const W = c.winner.id;
    for (const l of c.losers) {
      const L = l.id;
      // an Open Library key is unique: the winner takes the loser's only if it has none
      if (l.ol_key && !c.winner.ol_key) { await client.query('update public.titles set ol_key = null where id = $1', [L]); await client.query('update public.titles set ol_key = $2 where id = $1', [W, l.ol_key]); c.winner.ol_key = l.ol_key; }
      for (const col of FILL) await client.query(`update public.titles w set ${col} = l.${col} from public.titles l where w.id = $1 and l.id = $2 and w.${col} is null and l.${col} is not null`, [W, L]);
      await client.query(`update public.titles w set trivia = l.trivia from public.titles l where w.id = $1 and l.id = $2 and w.trivia = '[]'::jsonb and l.trivia <> '[]'::jsonb`, [W, L]);
      await client.query(`update public.titles w set creator = l.creator from public.titles l where w.id = $1 and l.id = $2 and w.creator = '' and l.creator <> ''`, [W, L]);
      await client.query(`update public.titles w set cover_url = l.cover_url, cover_from = l.cover_from from public.titles l where w.id = $1 and l.id = $2 and w.cover_url is null and l.cover_url is not null`, [W, L]);
      await client.query('update public.logs set title_id = $1 where title_id = $2', [W, L]);
      await client.query('delete from public.thread_items where title_id = $2 and thread_id in (select thread_id from public.thread_items where title_id = $1)', [W, L]);
      await client.query('update public.thread_items set title_id = $1 where title_id = $2', [W, L]);
      await client.query('update public.shop_books set title_id = $1 where title_id = $2', [W, L]);
      await client.query('delete from public.book_suggestions where title_id = $2 and language in (select language from public.book_suggestions where title_id = $1)', [W, L]);
      await client.query('update public.book_suggestions set title_id = $1 where title_id = $2', [W, L]);
      await client.query(`update public.profile_details set favourites = (select coalesce(array_agg(x order by o), '{}') from (select distinct on (x) x, o from unnest(array_replace(favourites, $2::uuid, $1::uuid)) with ordinality t(x, o) order by x, o) s) where $2::uuid = any(favourites)`, [W, L]);
      await client.query('delete from public.titles where id = $1', [L]);
      moved[l.slug] = c.winner.slug;
    }
    await client.query(rehearse ? 'rollback' : 'commit');
    merged++;
  } catch (e) {
    await client.query('rollback').catch(() => {});
    failed++;
    console.log(`  ${c.winner.slug}: ${e.message}`);
  }
}
console.log(`\n${rehearse ? 'Rehearsed (rolled back)' : 'Merged'}: ${merged} clusters, ${failed} failed.`);
if (write && !rehearse && Object.keys(moved).length) {
  // list files: entries that named an old slug now name the winner (and its Open Library work, if it has one)
  const win = new Map(books.map((b) => [b.slug, b]));
  let edited = 0;
  for (const f of listFiles) {
    const file = `src/data/lists/${f}`;
    const raw = fs.readFileSync(file, 'utf8');
    const l = JSON.parse(raw);
    let hit = false;
    for (const i of l.items) if (i.slug && moved[i.slug]) { const w = win.get(moved[i.slug]); i.slug = w.slug; if (w.ol_key) i.ol = w.ol_key; hit = true; edited++; }
    if (hit) fs.writeFileSync(file, JSON.stringify(l, null, 2) + (raw.endsWith('\n') ? '\n' : ''));
  }
  const win2 = new Map(books.map((b) => [b.slug, b]));
  for (const r of repoint) {
    const file = `src/data/lists/${r.list}`, raw = fs.readFileSync(file, 'utf8'), l = JSON.parse(raw);
    const i = l.items.find((x) => x.title === r.title && (x.slug ?? x.ol ?? '-') === r.was);
    if (!i) continue;
    const w = win2.get(r.now);
    i.slug = w.slug; if (w.ol_key) i.ol = w.ol_key; else delete i.ol;
    fs.writeFileSync(file, JSON.stringify(l, null, 2) + (raw.endsWith('\n') ? '\n' : ''));
  }
  const redirectsFile = 'src/data/slug-redirects.json';
  const red = fs.existsSync(redirectsFile) ? JSON.parse(fs.readFileSync(redirectsFile, 'utf8')) : {};
  fs.writeFileSync(redirectsFile, JSON.stringify({ ...red, ...moved }, null, 1) + '\n');
  console.log(`List entries repointed: ${edited}. Old addresses recorded in ${redirectsFile}: ${Object.keys(moved).length}.`);
}
await client.end();
