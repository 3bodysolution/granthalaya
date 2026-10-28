// Dry run: books whose Wikidata publication date (P577) is earlier than the year Granthalaya shows. Changes nothing.
//   node scripts/wikidata-years.mjs         reads the catalogue (read only), asks Wikidata and Open Library politely (answers are kept in
//                                           private/catalogues/raw/wikidata, git-ignored), writes private/catalogues/wikidata-years.md and .json
//
// "Our year" is what the book's page shows: titles.year, else Open Library's first publication year, then the Wikipedia text's own year if
// it says an earlier one (src/lib/catalog/years.mjs). A Wikidata item is accepted only when its title matches and, where it names an author,
// the author's name shares the creator's surname, and it is a literary work (novel, book, play, poem, short story...). Nothing is saved:
// the list is for Sarthak to check (Wikidata's own dates can be a translation's or an edition's, so each line carries the link).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { firstYear } from '../src/lib/catalog/years.mjs';

for (const line of fs.readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z_]+)\s*=\s*"?([^"#]*?)"?\s*(#.*)?$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}
const db = createClient(process.env.PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
const RAW = 'private/catalogues/raw/wikidata';
fs.mkdirSync(RAW, { recursive: true });
const UA = 'Granthalaya/1.0 (book catalogue; contact kokanesarthak52@gmail.com)';

let last = 0;
async function get(url) {
  const file = path.join(RAW, crypto.createHash('sha1').update(url).digest('hex').slice(0, 16) + '.json');
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  const wait = last + 700 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  for (let tries = 0; tries < 2; tries++) {
    last = Date.now();
    const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } }).catch(() => null);
    if (r?.ok) { const j = await r.json().catch(() => null); if (j) { fs.writeFileSync(file, JSON.stringify(j)); return j; } }
    await new Promise((r) => setTimeout(r, 3000));
  }
  return null;
}

const fold = (s) => String(s ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const surname = (name) => { const w = fold(name).split(' ').filter((x) => x.length > 1); return w[w.length - 1] ?? ''; };
// literary works: literary work, novel, book, play, poem, short story, novella, collection, epic, autobiography, memoir, essay, biography, written work
const WORK = new Set(['Q7725634', 'Q8261', 'Q571', 'Q25379', 'Q5185279', 'Q49084', 'Q149537', 'Q1318295', 'Q37484', 'Q17489659', 'Q8274', 'Q1114461', 'Q35760', 'Q36279', 'Q47461344', 'Q2831984', 'Q3331189', 'Q1279564', 'Q12106333', 'Q215380', 'Q1667921', 'Q267625', 'Q386724', 'Q187685', 'Q128093', 'Q7889', 'Q4263842', 'Q1760610', 'Q122731938', 'Q3238340', 'Q193977', 'Q11424']);

/* ——— the books ——— */
const rows = [];
for (let f = 0; ; f += 1000) {
  const { data, error } = await db.from('titles').select('id, slug, title, original_title, creator, year, ol_key, language, description, description_source, description_url').eq('kind', 'book').range(f, f + 999);
  if (error) { console.log(error.message); process.exit(1); }
  rows.push(...data);
  if (data.length < 1000) break;
}
const books = rows.filter((r) => r.year || r.ol_key);
console.log(`${rows.length} books; ${books.length} with a year or an Open Library page.`);

async function olYear(key) {
  const j = await get(`https://openlibrary.org/search.json?q=${encodeURIComponent(`key:/works/${key}`)}&fields=key,first_publish_year&limit=1`);
  return j?.docs?.[0]?.first_publish_year;
}
const claimYear = (e) => {
  const ys = (e?.claims?.P577 ?? []).map((c) => c.mainsnak?.datavalue?.value?.time).filter(Boolean).map((t) => Number(String(t).match(/^[+-]?(\d{1,4})/)?.[1])).filter((y) => y > 0);
  return ys.length ? Math.min(...ys) : undefined;
};
const WD = 'https://www.wikidata.org/w/api.php?format=json&origin=*&';
async function entities(ids) {
  const out = {};
  for (let i = 0; i < ids.length; i += 40) {
    const j = await get(`${WD}action=wbgetentities&ids=${ids.slice(i, i + 40).join('|')}&props=claims|labels&languages=en`);
    Object.assign(out, j?.entities ?? {});
  }
  return out;
}

const found = [];
let n = 0;
for (const b of books) {
  n++;
  if (n % 25 === 0) console.log(`  ${n} of ${books.length}`);
  const ours = b.year ?? (b.ol_key ? await olYear(b.ol_key) : undefined);
  const shown = firstYear(ours, b.description, b.description_source);
  if (!shown) continue;
  // candidate items: the Wikipedia article's item, else a search by title (and original title)
  let ids = [];
  const wp = String(b.description_url ?? '').match(/^https:\/\/([a-z-]+)\.wikipedia\.org\/wiki\/([^#?]+)/);
  if (wp) {
    const j = await get(`https://${wp[1]}.wikipedia.org/w/api.php?action=query&prop=pageprops&ppprop=wikibase_item&titles=${wp[2]}&format=json&redirects=1`);
    const id = Object.values(j?.query?.pages ?? {})[0]?.pageprops?.wikibase_item;
    if (id) ids.push(id);
  }
  if (!ids.length) {
    for (const [q, lang] of [[b.title, 'en'], ...(b.original_title ? [[b.original_title, b.language === 'hi' ? 'hi' : 'mr']] : [])]) {
      const j = await get(`${WD}action=wbsearchentities&search=${encodeURIComponent(q)}&language=${lang}&uselang=en&type=item&limit=7`);
      ids.push(...(j?.search ?? []).map((s) => s.id));
    }
    ids = [...new Set(ids)];
  }
  if (!ids.length) continue;
  const ents = await entities(ids);
  const authors = [...new Set(ids.flatMap((id) => (ents[id]?.claims?.P50 ?? []).map((c) => c.mainsnak?.datavalue?.value?.id)).filter(Boolean))];
  const people = authors.length ? await entities(authors) : {};
  const sur = surname(b.creator);
  const ok = ids.map((id) => {
    const e = ents[id];
    if (!e || e.missing !== undefined) return null;
    const kinds = (e.claims?.P31 ?? []).map((c) => c.mainsnak?.datavalue?.value?.id);
    if (!kinds.some((k) => WORK.has(k))) return null;
    const label = e.labels?.en?.value ?? '';
    const names = (e.claims?.P50 ?? []).map((c) => people[c.mainsnak?.datavalue?.value?.id]?.labels?.en?.value).filter(Boolean);
    const titleMatch = [b.title, b.original_title].filter(Boolean).some((t) => fold(t) === fold(label) || (fold(label).length > 3 && fold(t).startsWith(fold(label))));
    const authorMatch = sur ? names.some((x) => fold(x).includes(sur)) : false;
    const viaWikipedia = !!wp && id === ids[0];
    if (!(titleMatch || viaWikipedia) || (names.length && sur && !authorMatch)) return null;
    return { id, label, names, year: claimYear(e), via: viaWikipedia ? 'the Wikipedia article' : 'title search', sure: authorMatch };
  }).filter((x) => x && x.year).sort((a, c) => Number(c.sure) - Number(a.sure));
  const m = ok[0];
  if (!m) continue;
  found.push({ slug: b.slug, title: b.title, creator: b.creator, ours: shown, oursFrom: b.year ? 'saved year' : 'Open Library', wikidata: m.year, earlier: m.year < shown, link: `https://www.wikidata.org/wiki/${m.id}`, label: m.label, authors: m.names, via: m.via, authorChecked: m.sure });
}

const earlier = found.filter((f) => f.earlier).sort((a, b) => (b.ours - b.wikidata) - (a.ours - a.wikidata));
const same = found.filter((f) => !f.earlier && f.wikidata === f.ours).length, later = found.filter((f) => !f.earlier && f.wikidata > f.ours);
const lines = [
  `# Wikidata publication dates earlier than ours (dry run ${new Date().toLocaleDateString('en-CA')})`, '',
  `${books.length} books looked at; ${found.length} found on Wikidata (title matched, a literary work, author's surname matched where it names one).`,
  `${earlier.length} have an earlier Wikidata date than the year we show; ${same} agree; ${later.length} have a later one (not listed). Nothing was changed.`, '',
  '| Book | Author | Our year | Wikidata (P577) | Found by | Wikidata |', '|---|---|---|---|---|---|',
  ...earlier.map((f) => `| ${f.title} | ${f.creator || ''} | ${f.ours} (${f.oursFrom}) | ${f.wikidata} | ${f.via}${f.authorChecked ? ', author checked' : ', no author on Wikidata'} | [${f.link.split('/').pop()}](${f.link}) |`),
];
fs.writeFileSync('private/catalogues/wikidata-years.md', lines.join('\n'));
fs.writeFileSync('private/catalogues/wikidata-years.json', JSON.stringify(found, null, 1));
console.log(lines.join('\n'));
console.log('\nWritten: private/catalogues/wikidata-years.md and wikidata-years.json. Nothing was changed (dry run).');
