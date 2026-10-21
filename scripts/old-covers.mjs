// The 20 old covers in public/covers (referenced as /covers/<file>.jpg): which titles have a TMDB poster or an Open Library cover
// we could switch to? Dry run only: it lists each title with the old address and the candidate, and writes nothing.
//
//   node scripts/old-covers.mjs
//
// A candidate is only listed when the match is sure: films by TMDB id (or title and year), books by Open Library key
// (or title and author). Needs PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY and TMDB_API_KEY in .env. Nothing from .env is printed.
import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';

try {
  for (const line of fs.readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*"?([^"#]*?)"?\s*(#.*)?$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
} catch { /* no .env */ }
const db = createClient(process.env.PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
const tmdb = process.env.TMDB_API_KEY;
const get = async (u) => { try { const r = await fetch(u, { headers: { 'User-Agent': 'Granthalaya/1.0 (old covers)' }, signal: AbortSignal.timeout(20000) }); return r.ok ? r.json() : null; } catch { return null; } };
const norm = (s) => String(s ?? '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

const { data: rows } = await db.from('titles').select('id, kind, slug, title, year, creator, tmdb_id, ol_key, cover_url').like('cover_url', '/covers/%').order('title');
console.log(`${rows.length} titles use an old cover file\n`);
let found = 0;
for (const r of rows) {
  let candidate = null, how = '';
  if (r.kind === 'film' || r.kind === 'tv') {
    const type = r.kind === 'tv' ? 'tv' : 'movie';
    let p = r.tmdb_id ? await get(`https://api.themoviedb.org/3/${type}/${r.tmdb_id}?api_key=${tmdb}`) : null;
    how = r.tmdb_id ? 'by TMDB id' : '';
    if (!p) {
      const s = await get(`https://api.themoviedb.org/3/search/${type}?api_key=${tmdb}&query=${encodeURIComponent(r.title)}${r.year ? `&${type === 'tv' ? 'first_air_date_year' : 'year'}=${r.year}` : ''}`);
      const hit = (s?.results ?? []).find((x) => norm(x.title ?? x.name) === norm(r.title) && x.poster_path);
      if (hit) { p = hit; how = `by title${r.year ? ' and year' : ''}: "${hit.title ?? hit.name}" (${(hit.release_date ?? hit.first_air_date ?? '').slice(0, 4)})`; }
    }
    if (p?.poster_path) candidate = `https://image.tmdb.org/t/p/w500${p.poster_path}`;
  } else if (r.kind === 'book') {
    let coverId = null;
    if (r.ol_key) {
      const w = await get(`https://openlibrary.org/works/${r.ol_key}.json`);
      coverId = (w?.covers ?? []).find((c) => c > 0) ?? null;
      how = 'by Open Library key';
    }
    if (!coverId) {
      const s = await get(`https://openlibrary.org/search.json?title=${encodeURIComponent(r.title)}&author=${encodeURIComponent(r.creator ?? '')}&limit=5&fields=key,title,author_name,cover_i`);
      const hit = (s?.docs ?? []).find((d) => d.cover_i && norm(d.title) === norm(r.title));
      if (hit) { coverId = hit.cover_i; how = `by title and author: "${hit.title}" by ${(hit.author_name ?? []).slice(0, 2).join(', ')} (${hit.key})`; }
    }
    if (coverId) candidate = `https://covers.openlibrary.org/b/id/${coverId}-L.jpg`;
  }
  if (candidate) found++;
  console.log(`${r.kind.toUpperCase().padEnd(5)} ${r.title}${r.year ? ` (${r.year})` : ''}${r.creator ? `, ${r.creator}` : ''}`);
  console.log(`  old:       ${r.cover_url}`);
  console.log(`  candidate: ${candidate ?? 'none found (keep the old file)'}${candidate ? `   [${how}]` : ''}\n`);
}
console.log(`${found} of ${rows.length} have a candidate. Nothing was changed.`);
