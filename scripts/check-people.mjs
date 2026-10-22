// Opens the cast and crew pages of a set of titles on a running dev server and reports anything that is not a normal page.
//   node scripts/check-people.mjs [port] [perTitle]
// It finds each title on TMDB by name, opens its page, follows every /person/ link on it (up to perTitle, spread over cast and
// crew, plus the people with no photo), and prints each page that is not a 200 with a person's name in it.
import fs from 'node:fs';
for (const line of fs.readFileSync('.env', 'utf8').split(/\r?\n/)) { const m = line.match(/^\s*([A-Z_]+)\s*=\s*"?([^"#]*?)"?\s*(#.*)?$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2]; }
const port = process.argv[2] || '4321', perTitle = Number(process.argv[3]) || 24;
const key = process.env.TMDB_API_KEY;
const titles = [
  ['movie', 'Street Fighter', 2026], ['movie', 'Natsamrat', 2016], ['movie', 'The Matrix', 1999], ['movie', 'Court', 2014], ['movie', 'Sholay', 1975],
  ['movie', 'Pather Panchali', 1955], ['movie', 'Seven Samurai', 1954], ['movie', 'Lagaan', 2001], ['movie', 'Sairat', 2016], ['movie', 'Perfect Days', 2023],
  ['movie', 'Past Lives', 2023], ['movie', 'Killa', 2014], ['movie', 'Shyamchi Aai', 1953], ['movie', 'Mother India', 1957], ['movie', 'RRR', 2022],
  ['tv', 'Dark', 2017], ['tv', 'Breaking Bad', 2008], ['tv', 'Panchayat', 2020], ['tv', 'Sacred Games', 2018], ['tv', 'Chernobyl', 2019],
];
const get = async (u, tries = 3) => { for (let i = 0; i < tries; i++) { try { const r = await fetch(u); return r; } catch { await new Promise((r) => setTimeout(r, 800)); } } return null; };
let pages = 0, bad = 0;
for (const [type, name, year] of titles) {
  const s = await (await get(`https://api.themoviedb.org/3/search/${type}?api_key=${key}&query=${encodeURIComponent(name)}`))?.json();
  const hit = (s?.results ?? []).find((x) => (x.release_date ?? x.first_air_date ?? '').startsWith(String(year))) ?? s?.results?.[0];
  if (!hit) { console.log(`?? ${name}: not found on TMDB`); continue; }
  const path = `/${type === 'tv' ? 'tv' : 'film'}/${hit.id}/`;
  const page = await get(`http://localhost:${port}${path}`);
  const html = page ? await page.text() : '';
  const links = [...new Set([...html.matchAll(/href="(\/person\/[^"]+)"/g)].map((m) => m[1]))];
  // spread over the list, and always include people who show an initial instead of a photo
  const pick = links.filter((_, i) => i % Math.max(1, Math.ceil(links.length / perTitle)) === 0).slice(0, perTitle);
  let ok = 0;
  for (const l of pick) {
    const r = await get(`http://localhost:${port}${l}`);
    const body = r ? await r.text() : '';
    pages++;
    const good = r && r.status === 200 && /<h1[^>]*>[^<]+<\/h1>/.test(body) && !/Internal server error|Something went wrong|vite-error-overlay/.test(body);
    if (good) ok++; else { bad++; console.log(`  BAD ${l} -> ${r?.status}${/vite-error-overlay/.test(body) ? ' (error overlay)' : ''}`); }
  }
  console.log(`${name} (${year}) ${path}: ${links.length} people linked, ${pick.length} opened, ${ok} fine`);
}
console.log(`\n${pages} person pages opened, ${bad} not fine`);
