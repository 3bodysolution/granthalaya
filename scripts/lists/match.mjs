// Matches every item in src/data/lists/*.json to the catalogue and writes the ids back.
//   Books: Open Library (title + author), then Google Books  -> "ol" or "gb", and "cover"
//   Films: TMDB (title ±2 years, then original title, then no year but the item's language)
//          -> "tmdb", "cover", and "release_year" corrected from TMDB
// Doubtful or missing matches are written to docs/unmatched.md.
// Keys come from .env (TMDB_API_KEY, optional GOOGLE_BOOKS_API_KEY) and are never printed.
// Run from the project root: node scripts/lists/match.mjs [--force] [slug ...]
//   Items that already have an id are skipped unless --force is given.
//   --second: a second pass on unmatched items only (original titles, author alone, closest title).
//   Its results are appended to docs/unmatched.md under "Second pass".
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
const SECOND = args.includes('--second');
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


// ---------- second pass (unmatched items only) ----------
// Like norm(), but keeps Devanagari vowel signs so Hindi and Marathi words stay whole.
const norm2 = (s) =>
  (s ?? '').normalize('NFC').toLowerCase().replace(/&/g, ' and ').replace(/^(the|a|an)\s+/, '').replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ').trim();
/** 0 to 1: how alike two titles are (shared words, Dice score) */
function sim(a, b) {
  const x = new Set(norm2(a).split(' ').filter(Boolean)), y = new Set(norm2(b).split(' ').filter(Boolean));
  if (!x.size || !y.size) return 0;
  let n = 0; for (const w of x) if (y.has(w)) n++;
  return (2 * n) / (x.size + y.size);
}
const best = (cands, names) => {
  let top = null;
  for (const c of cands) {
    const sc = Math.max(...names.filter(Boolean).map((n) => sim(c.title, n)));
    if (sc >= 0.5 && (!top || sc > top.sc)) top = { ...c, sc };
  }
  return top;
};
const gbSearch = async (q) => {
  const j = await getJSON(`https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(q)}&maxResults=20${GB ? `&key=${GB}` : ''}`);
  await sleep(300);
  return (j?.items ?? []).map((v) => {
    const i = v.volumeInfo ?? {};
    const c = i.imageLinks?.thumbnail || i.imageLinks?.smallThumbnail;
    return { gb: v.id, title: i.title ?? '', authors: i.authors ?? [], cover: c ? c.replace(/^http:/, 'https:').replace('&edge=curl', '') : undefined };
  });
};

async function matchBookSecond(it) {
  const names = [it.title, it.original_title];
  const cands = [];
  const ol = async (params) => {
    const u = new URL('https://openlibrary.org/search.json');
    for (const [k, v] of Object.entries(params)) if (v) u.searchParams.set(k, v);
    u.searchParams.set('limit', '40');
    u.searchParams.set('fields', 'key,title,author_name,cover_i');
    const j = await getJSON(u); await sleep(250);
    for (const d of j?.docs ?? []) cands.push({ ol: d.key.replace('/works/', ''), title: d.title ?? '', authors: d.author_name ?? [], cover: d.cover_i ? `https://covers.openlibrary.org/b/id/${d.cover_i}-L.jpg` : undefined });
  };
  if (it.original_title) { await ol({ title: it.original_title }); await ol({ q: it.original_title }); }
  if (it.creator) await ol({ author: it.creator });
  // a title match counts if the author fits, or the original (Devanagari) title is an almost exact match
  const fits = (c) => authorOk(it.creator, c.authors) || (it.original_title && sim(c.title, it.original_title) >= 0.9);
  let pick = best(cands.filter(fits), names);
  if (!pick) {
    const g = [];
    if (it.original_title) g.push(...(await gbSearch(`intitle:${it.original_title}`)));
    if (it.creator) g.push(...(await gbSearch(`inauthor:${it.creator}`)));
    pick = best(g.filter(fits), names);
  }
  if (!pick) return { fail: 'still nothing' };
  return { ol: pick.ol, gb: pick.ol ? undefined : pick.gb, cover: pick.cover, note: pick.sc >= 0.95 ? null : `closest title "${pick.title}" by ${pick.authors.join(', ')}` };
}

async function matchFilmSecond(it) {
  const y = it.release_year ?? it.year, lang = it.language;
  const names = [it.title, it.original_title];
  const ry = (r) => (r.release_date ? +r.release_date.slice(0, 4) : null);
  const cands = [];
  const add = (j) => { for (const r of j?.results ?? []) cands.push(r); };
  for (const q of [it.original_title, it.title].filter(Boolean)) {
    add(await tm('/search/movie', { query: q, include_adult: 'false', language: lang ? `${lang}-IN` : undefined })); await sleep(120);
  }
  if (lang && y) for (const yr of [y, y - 1, y + 1]) {
    add(await tm('/discover/movie', { with_original_language: lang, primary_release_year: String(yr), sort_by: 'popularity.desc' })); await sleep(120);
  }
  const ok = cands.filter((r) => (!lang || r.original_language === lang) && ry(r) && y && Math.abs(ry(r) - y) <= 2)
    .map((r) => ({ r, title: r.title, sc: Math.max(...names.concat(r.original_title).filter(Boolean).map((n) => Math.max(sim(r.title, n), sim(r.original_title, n)))) }))
    .filter((c) => c.sc >= 0.5).sort((a, b) => b.sc - a.sc)[0];
  if (!ok) return { fail: 'still nothing' };
  const r = ok.r;
  return { tmdb: r.id, cover: r.poster_path ? `https://image.tmdb.org/t/p/w500${r.poster_path}` : undefined, release_year: ry(r), note: ok.sc >= 0.95 ? null : `closest "${r.title}" (${ry(r)})` };
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
    if ((!FORCE || SECOND) && (it.ol || it.gb || it.tmdb)) { skipped++; continue; }
    const r = SECOND
      ? (list.kind === 'film' ? await matchFilmSecond(it) : await matchBookSecond(it))
      : (list.kind === 'film' ? await matchFilm(it) : await matchBook(it));
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

if (SECOND) {
  const f = join(ROOT, 'docs', 'unmatched.md');
  const old = readFileSync(f, 'utf8').replace(/\n## Second pass[\s\S]*$/, '');
  const note = 'Run with `--second` on items that had no match. Notes above may be out of date for items matched here.';
  writeFileSync(f, old + '\n## Second pass\n\n' + note + '\n\n' + (report.join('\n') || 'Nothing new.\n'));
} else writeFileSync(
  join(ROOT, 'docs', 'unmatched.md'),
  `# Unmatched and doubtful list items\n\nMade by \`scripts/lists/match.mjs\`. "Check" means a match was saved but may be the wrong work or film. "No match" means nothing was saved.\n\n${report.join('\n') || 'Everything matched.\n'}`,
);
console.log(summary.join('\n'));
