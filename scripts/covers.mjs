// Fetch real covers for the library: book covers from Open Library, film posters from TMDB.
// Each one is saved as public/covers/<file name>.jpg.
//
// Film posters need a free TMDB key. Put it in a file called .env in this folder, as one line:
//   TMDB_API_KEY=your-key
// (.env is never committed.) Without a key, films keep their painted covers.
//
//   npm run covers                  fetch covers that are missing
//   npm run covers -- --force       fetch them all again
//   npm run covers -- piranesi      only this entry (its file name)
//
// Wrong cover? Put your own image at public/covers/<file name>.jpg,
// or add `cover: painted` to the entry to keep the painted one.
import fs from 'node:fs';
import path from 'node:path';

const LIB = 'src/content/library';
const OUT = 'public/covers';
const UA = { 'User-Agent': 'Granthalaya/1.0 (personal library; covers script)' };
const args = process.argv.slice(2);
const force = args.includes('--force');
const only = args.filter((a) => !a.startsWith('--'));
// read .env, if there is one
try {
  for (const line of fs.readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*"?([^"]*?)"?\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
} catch {}
const TMDB = process.env.TMDB_API_KEY;
if (!TMDB) console.log('No TMDB key found, so films are skipped and keep their painted covers.\n');

fs.mkdirSync(OUT, { recursive: true });

// read the simple fields we need from the top of each file
function front(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const out = {};
  if (!m) return out;
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^(\w+):\s*(.*)$/);
    if (!kv) continue;
    let v = kv[2].trim();
    if (/^["'].*["']$/.test(v)) v = v.slice(1, -1);
    out[kv[1]] = v;
  }
  return out;
}

async function getJSON(url) {
  const r = await fetch(url, { headers: UA });
  if (!r.ok) throw new Error(`${r.status} from ${new URL(url).host}`);
  return r.json();
}

async function save(url, slug) {
  const r = await fetch(url, { headers: UA, redirect: 'follow' });
  if (!r.ok) throw new Error(`${r.status} downloading image`);
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length < 2000) throw new Error('image too small (probably a placeholder)');
  const type = r.headers.get('content-type') || '';
  const ext = type.includes('png') ? 'png' : type.includes('webp') ? 'webp' : 'jpg';
  for (const e of ['jpg', 'png', 'webp']) fs.rmSync(path.join(OUT, `${slug}.${e}`), { force: true });
  fs.writeFileSync(path.join(OUT, `${slug}.${ext}`), buf);
  return `${slug}.${ext} (${Math.round(buf.length / 1024)} KB)`;
}

const norm = (s = '') => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

async function bookCover(d) {
  const q = new URLSearchParams({ title: d.title, limit: '8', fields: 'title,author_name,cover_i,edition_count' });
  if (d.creator) q.set('author', d.creator);
  let docs = (await getJSON(`https://openlibrary.org/search.json?${q}`)).docs ?? [];
  if (!docs.some((x) => x.cover_i)) {
    q.delete('author');
    docs = (await getJSON(`https://openlibrary.org/search.json?${q}`)).docs ?? [];
  }
  const withCover = docs.filter((x) => x.cover_i);
  // prefer an exact title match, then the most-printed edition
  withCover.sort((a, b) => (norm(b.title) === norm(d.title)) - (norm(a.title) === norm(d.title)) || (b.edition_count ?? 0) - (a.edition_count ?? 0));
  const hit = withCover[0];
  if (!hit) throw new Error('no cover on Open Library');
  return { url: `https://covers.openlibrary.org/b/id/${hit.cover_i}-L.jpg?default=false`, from: 'Open Library' };
}

async function filmPoster(d) {
  // only TMDB: Wikipedia doesn't share film posters, and guessing finds photos of directors instead
  const q = new URLSearchParams({ query: d.title, api_key: TMDB });
  if (d.year) q.set('year', d.year);
  let res = (await getJSON(`https://api.themoviedb.org/3/search/movie?${q}`)).results ?? [];
  if (!res.length && d.year) { q.delete('year'); res = (await getJSON(`https://api.themoviedb.org/3/search/movie?${q}`)).results ?? []; }
  const hit = res.find((m) => m.poster_path && norm(m.title) === norm(d.title)) ?? res.find((m) => m.poster_path);
  if (!hit) throw new Error('no poster on TMDB');
  return { url: `https://image.tmdb.org/t/p/w500${hit.poster_path}`, from: `TMDB (${hit.title}${hit.release_date ? ', ' + hit.release_date.slice(0, 4) : ''})` };
}

const files = fs.readdirSync(LIB).filter((f) => f.endsWith('.md'));
let got = 0, skipped = 0, failed = 0;
for (const f of files) {
  const slug = f.replace(/\.md$/, '');
  if (only.length && !only.includes(slug)) continue;
  const d = front(fs.readFileSync(path.join(LIB, f), 'utf8'));
  if (d.type !== 'book' && d.type !== 'film') continue;
  if (d.type === 'film' && !TMDB) continue;
  if (d.cover) { console.log(`·  ${slug}: has its own cover setting (${d.cover}), skipped`); skipped++; continue; }
  const exists = ['jpg', 'png', 'webp'].some((e) => fs.existsSync(path.join(OUT, `${slug}.${e}`)));
  if (exists && !force) { skipped++; continue; }
  try {
    const { url, from } = d.type === 'book' ? await bookCover(d) : await filmPoster(d);
    console.log(`✓  ${slug}: ${await save(url, slug)} from ${from}`);
    got++;
  } catch (e) {
    console.log(`✗  ${slug}: ${e.message}. It keeps its painted cover.`);
    failed++;
  }
  await new Promise((r) => setTimeout(r, 400)); // be gentle with the free services
}
console.log(`\nDone: ${got} fetched, ${skipped} already had one, ${failed} not found.`);
