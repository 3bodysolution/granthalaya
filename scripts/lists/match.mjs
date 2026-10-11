// Matches every item in src/data/lists/*.json to the catalogue and writes the ids back.
//   Books: Open Library (title + author), then Google Books  -> "ol" or "gb", and "cover"
//   Films: TMDB (title ±2 years, then original title, then no year but the item's language)
//          -> "tmdb", "cover", and "release_year" corrected from TMDB
// Doubtful or missing matches are written to docs/unmatched.md.
// Keys come from .env (TMDB_API_KEY, optional GOOGLE_BOOKS_API_KEY) and are never printed.
// Run from the project root: node scripts/lists/match.mjs [--force] [slug ...]
//   Items that already have an id are skipped unless --force is given.
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DIR = join(ROOT, 'src', 'data', 'lists');
const UA = 'GranthalayaDataBot/1.0 (Granthalaya project; scripts/lists/match.mjs)';

const env = {};
if (existsSync(join(ROOT, '.env'))) {
  for (const line of readFileSync(join(ROOT, '.env'), 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
const TMDB = env.TMDB_API_KEY || process.env.TMDB_API_KEY;
const GB = env.GOOGLE_BOOKS_API_KEY || process.env.GOOGLE_BOOKS_API_KEY;
if (!TMDB) console.error('No TMDB_API_KEY: films will be skipped.');
if (!GB) console.error('No GOOGLE_BOOKS_API_KEY: Google Books will answer "too many requests" most of the time.');

const args = process.argv.slice(2);
const FORCE = args.includes('--force');
const only = args.filter((a) => !a.startsWith('--'));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function getJSON(url) {
  for (let i = 1; i <= 3; i++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
      if (r.status === 429 || r.status >= 500) throw new Error(String(r.status));
      if (!r.ok) return null;
      return await r.json();
    } catch {
      await sleep(1500 * i);
    }
  }
  return null;
}

const norm = (s) =>
  (s ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/&/g, ' and ')
    .replace(/^(the|a|an)\s+/, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const same = (a, b) => !!a && !!b && norm(a) === norm(b);
const near = (a, b) => {
  a = norm(a); b = norm(b);
  return !!a && !!b && (a === b || a.startsWith(b + ' ') || b.startsWith(a + ' ') || a.includes(b) || b.includes(a));
};
const lastNames = (creator) =>
  norm(creator).split(/ and | /).filter((w) => w.length > 2);
const authorOk = (creator, names) => {
  const want = lastNames(creator);
  if (!want.length || !names?.length) return false;
  const have = norm(names.join(' '));
  return want.some((w) => have.includes(w));
};

// ---------- books ----------
async function olSearch(params) {
  const u = new URL('https://openlibrary.org/search.json');
  for (const [k, v] of Object.entries(params)) if (v) u.searchParams.set(k, v);
  u.searchParams.set('limit', '8');
  u.searchParams.set('fields', 'key,title,author_name,cover_i,first_publish_year');
  const j = await getJSON(u);
  return j?.docs ?? [];
}

async function matchBook(it) {
  const tries = [
    { title: it.title, author: it.creator },
    ...(it.original_title ? [{ title: it.original_title, author: it.creator }] : []),
    { title: it.title },
  ];
  let doubtful = null;
  for (const t of tries) {
    const docs = await olSearch(t);
    await sleep(250);
    const good = docs.find((d) => near(d.title, it.title) && authorOk(it.creator, d.author_name));
    const exact = docs.find((d) => same(d.title, it.title) && authorOk(it.creator, d.author_name));
    const pick = exact || good;
    if (pick) {
      return {
        ol: pick.key.replace('/works/', ''),
        cover: pick.cover_i ? `https://covers.openlibrary.org/b/id/${pick.cover_i}-L.jpg` : undefined,
        note: exact ? null : `Open Library title "${pick.title}"`,
      };
    }
    if (!doubtful && docs[0] && authorOk(it.creator, docs[0].author_name))
      doubtful = `Open Library gave "${docs[0].title}" by ${docs[0].author_name?.join(', ')}`;
  }
  // Google Books
  const q = `intitle:${it.title}${it.creator ? ` inauthor:${it.creator}` : ''}`;
  const u = `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(q)}&maxResults=5${GB ? `&key=${GB}` : ''}`;
  const j = await getJSON(u);
  await sleep(300);
  for (const v of j?.items ?? []) {
    const i = v.volumeInfo ?? {};
    if (near(i.title, it.title) && authorOk(it.creator, i.authors)) {
      const c = i.imageLinks?.thumbnail || i.imageLinks?.smallThumbnail;
      return {
        gb: v.id,
        cover: c ? c.replace(/^http:/, 'https:').replace('&edge=curl', '') : undefined,
        note: same(i.title, it.title) ? null : `Google Books title "${i.title}"`,
      };
    }
  }
  return { fail: doubtful ?? 'nothing found' };
}

// ---------- films ----------
const tm = (path, params) => {
  const u = new URL(`https://api.themoviedb.org/3${path}`);
  u.searchParams.set('api_key', TMDB);
  for (const [k, v] of Object.entries(params)) if (v) u.searchParams.set(k, v);
  return getJSON(u);
};

async function matchFilm(it) {
  const y = it.release_year ?? it.year;
  const lang = it.language;
  const steps = [
    { q: it.title, years: true },
    ...(it.original_title ? [{ q: it.original_title, years: true }] : []),
    { q: it.title, years: false, lang: true },
    ...(it.original_title ? [{ q: it.original_title, years: false, lang: true }] : []),
  ];
  let doubtful = null;
  for (const s of steps) {
    const j = await tm('/search/movie', { query: s.q, include_adult: 'false' });
    await sleep(120);
    let rs = j?.results ?? [];
    const ry = (r) => (r.release_date ? +r.release_date.slice(0, 4) : null);
    if (s.years) rs = rs.filter((r) => ry(r) && y && Math.abs(ry(r) - y) <= 2);
    if (s.lang && lang) rs = rs.filter((r) => r.original_language === lang);
    const titled = rs.filter((r) => near(r.title, s.q) || near(r.original_title, s.q) || near(r.title, it.title) || near(r.original_title, it.original_title));
    const pick = titled.sort((a, b) => b.popularity - a.popularity)[0];
    if (pick) {
      const exactTitle = same(pick.title, it.title) || same(pick.original_title, it.title) || same(pick.original_title, it.original_title);
      const yearOk = y && ry(pick) && Math.abs(ry(pick) - y) <= 2;
      // without a year, only trust it if there is a single candidate with the right language
      const trusted = exactTitle && (s.years || (lang && titled.length === 1));
      return {
        tmdb: pick.id,
        cover: pick.poster_path ? `https://image.tmdb.org/t/p/w500${pick.poster_path}` : undefined,
        release_year: ry(pick) ?? it.release_year,
        note: trusted && (yearOk || s.years) ? null : `TMDB "${pick.title}" (${ry(pick)})${titled.length > 1 ? `, ${titled.length} candidates` : ''}`,
      };
    }
    if (!doubtful && rs[0]) doubtful = `TMDB gave "${rs[0].title}" (${ry(rs[0])}) which did not fit`;
  }
  return { fail: doubtful ?? 'nothing found' };
}

// ---------- run ----------
const files = readdirSync(DIR).filter((f) => f.endsWith('.json') && (!only.length || only.includes(f.replace('.json', ''))));
const report = [];
const summary = [];

for (const f of files) {
  const path = join(DIR, f);
  const list = JSON.parse(readFileSync(path, 'utf8'));
  if (list.kind === 'film' && !TMDB) continue;
  let ok = 0, doubt = 0, miss = 0, skipped = 0;
  const lines = [];
  for (const it of list.items) {
    if (!FORCE && (it.ol || it.gb || it.tmdb)) { skipped++; continue; }
    const r = list.kind === 'film' ? await matchFilm(it) : await matchBook(it);
    const label = `${it.year} · ${it.title}${it.creator ? ` (${it.creator})` : ''}`;
    if (r.fail) { miss++; lines.push(`- **No match:** ${label}. ${r.fail}.`); continue; }
    for (const k of ['ol', 'gb', 'tmdb']) delete it[k];
    delete it.cover;
    if (r.ol) it.ol = r.ol;
    if (r.gb) it.gb = r.gb;
    if (r.tmdb) it.tmdb = r.tmdb;
    if (r.cover) it.cover = r.cover;
    if (r.release_year && r.release_year !== it.release_year && list.kind === 'film') it.release_year = r.release_year;
    if (r.note) { doubt++; lines.push(`- **Check:** ${label}. ${r.note}.`); } else ok++;
    if (!r.cover) lines.push(`- **No cover:** ${label}.`);
  }
  writeFileSync(path, JSON.stringify(list, null, 2) + '\n');
  summary.push(`${list.slug}: ${list.items.length} items, ${ok} matched, ${doubt} to check, ${miss} unmatched${skipped ? `, ${skipped} already done` : ''}`);
  if (lines.length) report.push(`## ${list.title} (${list.slug})\n\n${lines.join('\n')}\n`);
}

writeFileSync(
  join(ROOT, 'docs', 'unmatched.md'),
  `# Unmatched and doubtful list items\n\nMade by \`scripts/lists/match.mjs\`. "Check" means a match was saved but may be the wrong work or film. "No match" means nothing was saved.\n\n${report.join('\n') || 'Everything matched.\n'}`,
);
console.log(summary.join('\n'));
