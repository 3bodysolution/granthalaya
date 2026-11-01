// Finds the list films the home wall must leave out (horror, TMDB genre 27, or adult) and writes their TMDB ids to
// src/data/wall-skip.json, and saves TMDB's own one-line tagline of each list film in src/data/wall-lines.json (the line a cover turns over
// to show), so the home page never has to ask TMDB about them. Run it again after the film lists change:
//   node scripts/lists/wall-skip.mjs
// The key comes from .env and is never printed.
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const env = {};
if (existsSync(join(ROOT, '.env'))) {
  for (const line of readFileSync(join(ROOT, '.env'), 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
const KEY = env.TMDB_API_KEY || process.env.TMDB_API_KEY;
if (!KEY) { console.error('No TMDB key.'); process.exit(1); }

const dir = join(ROOT, 'src', 'data', 'lists');
const ids = new Set();
for (const f of readdirSync(dir)) {
  const l = JSON.parse(readFileSync(join(dir, f), 'utf8'));
  if (l.kind === 'film') for (const i of l.items) if (i.tmdb && i.cover) ids.add(i.tmdb);
}
const skip = [], failed = [], lines = {};
const all = [...ids];
for (let at = 0; at < all.length; at += 15) {
  await Promise.all(all.slice(at, at + 15).map(async (id) => {
    for (let t = 0; t < 3; t++) {
      try {
        const r = await fetch(`https://api.themoviedb.org/3/movie/${id}?api_key=${KEY}&language=en-US`);
        if (!r.ok) throw new Error(String(r.status));
        const m = await r.json();
        if (m.tagline && m.tagline.trim().length <= 70) lines[id] = m.tagline.trim();
        if (m.adult || (m.genres ?? []).some((g) => g.id === 27)) skip.push(id);
        return;
      } catch { await new Promise((r) => setTimeout(r, 500)); }
    }
    failed.push(id);
  }));
}
// a film TMDB would not answer for stays out, to be safe
const out = [...new Set([...skip, ...failed])].sort((a, b) => a - b);
writeFileSync(join(ROOT, 'src', 'data', 'wall-skip.json'), JSON.stringify(out) + '\n');
writeFileSync(join(ROOT, 'src', 'data', 'wall-lines.json'), JSON.stringify(Object.fromEntries(Object.entries(lines).sort((a, b) => a[0] - b[0]))) + '\n');
console.log(`${Object.keys(lines).length} taglines saved. ${all.length} list films checked, ${skip.length} horror or adult, ${failed.length} not answered; ${out.length} left out.`);
