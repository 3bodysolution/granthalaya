// Dry run: which shop books are already in our catalogue (they get the shop's cover if they have none, and Buy links),
// which are on Open Library (they come in as Open Library records, so nobody can add a second copy later from search),
// and which are new (our own records). Writes a report and a plan; changes nothing.
//
//   node scripts/shops/match.mjs --write   saves it (after 010; only when Sarthak asks): links, covers, Open Library and own records, shop rows
//   node scripts/shops/match.mjs     reads private/catalogues/candidates.json (from fetch.mjs) and the catalogue (read only)
//                                    writes private/catalogues/matches-<date>.md (to read and tick) and plan-<date>.json
//
// One book is one record: the same book in several lists, editions or both shops becomes one group (same title in either
// script, same part number, and a shared author surname). A group only counts as "new" when neither our catalogue nor
// Open Library has it. Open Library is asked once per new group, a second apart, and its answers are cached.
// Needs PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY in .env (read here, never printed).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { titleKey, mainKey, surnameKey, partOf, alike, deva2latin } from './text.mjs';

for (const line of fs.readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z_]+)\s*=\s*"?([^"#]*?)"?\s*(#.*)?$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}
const db = createClient(process.env.PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
const day = new Date().toLocaleDateString('en-CA');   // today's date where the script runs (YYYY-MM-DD)
const OUT = 'private/catalogues';

/* ——— the shop books we want ——— */
const raw = JSON.parse(fs.readFileSync(`${OUT}/candidates.json`, 'utf8'));
const CHILDREN = /balvadmay|balvangmay|bal gat|children|kumar gat|बालसाहित्य|बालवाङ्मय|बालकथा|बालगीत/i;
// sets of several books, and Diwali issues (magazines, not books)
const SETS = /diwali ank|दिवाळी अंक|विशेषांक|combo|\bset\b|संच|कॉम्बो|\bpack\b/i;
// Non-fiction is wanted only when it is literary: biography, memoir, essays, history, travel.
// Left out: exam and study guides, textbooks and reference, self-help and how-to (checked on tags, category and title).
const STUDY = /exam|mpsc|upsc|textbook|dictionary|शब्दकोश|shabdakosh|vishard|prathama|bandish|बंदिश|swar ?archana|ragmanthan|nadchintan|gharano|grammar|vyakaran|muhavara|instant english|अंग्रेजी|statistics|data science|industry 4|infotech|semiconductor|artificial intelligence|AI|संदर्भ-साहित्याविषयक.*(कोश|सूची)/i;
const HOWTO = /self.?help|सेल्फ हेल्प|व्यक्तिमत्त्व विकास|motivation|मार्गदर्शन|leadership|business|उद्योग|Others|no category|fitness|madhumeh|मधुमेह|vitamin|power of habit|habit|prabhavi|kamyab|saphal|safal|success|millionaire|rich dad|body language|productivity|positive|secret|soch ki|shakti|manager|ceo|finance|money|mind ?power|manashakti|guide/i;
// soft leave-outs, unless the book is plainly a life, a history, a journey or an essay collection
const SOFT = /arogya|आरोग्य|health|माहिती तंत्रज्ञान|विज्ञानविषयक|vidnyan|science|मानसशास्त्र|psycholog|अर्थशास्त्र|economics|धार्मिक|आध्यात्मिक|spiritual|religious|dharmik|sant ?sahitya|संतसाहित्य|sangitvishayak|संगीत विषयक|माहितीपर|informative|abhang|manache shlok|meditation/i;
const LITERARY = /charitra|atmacharitra|atmakatha|aatmakatha|biograph|memoir|चरित्र|आत्मकथा|आत्मचरित्र|aitihasik|itihas|इतिहास|history|travel|पर्यटन|bhraman|प्रवास|safar|ghumakkad|घुमक्कड|यात्रा|yatra|rajdhan|wari|वारी|व्यक्तिचित्रण|lalit|ललित|lekh|लेख|essay|sahitya akademi|top 100|top 50/i;
const why = {};
const skip = (r, reason) => { why[reason] = (why[reason] ?? 0) + 1; r.skipped = reason; return false; };
function language(r) {
  if (r.language === 'hi' || /\bhindi\b|हिंदी किताब/i.test(`${r.title} ${r.original} ${(r.tags ?? []).join(' ')}`)) return 'hi';
  if (r.language === 'en' || (r.tags ?? []).includes('English Books')) return 'en';
  if (r.shop === 'bookganga' && r.language && r.language !== 'mr') return r.language;
  return 'mr';
}
const books = raw.filter((r) => {
  r.lang = language(r);
  // BookGanga can name several people in one field ("Achyut Godbole, Sulabha Pishavikar")
  r.authorsAll = [...(r.authors ?? []), r.author, r.authorDeva].filter(Boolean).flatMap((a) => a.split(/\s*(?:,|&|\band\b|\bव\b|आणि|और)\s*/)).map((a) => a.trim()).filter(Boolean);
  if (!r.title && !r.original) return skip(r, 'no title');
  if (!['mr', 'hi'].includes(r.lang)) return skip(r, `not Marathi or Hindi (${r.lang})`);
  if (SETS.test(`${r.title} ${r.original}`)) return skip(r, 'a set of several books');
  if (CHILDREN.test(`${(r.tags ?? []).join(' ')} ${r.category ?? ''}`)) return skip(r, "children's book");
  if (!r.fiction && !r.topList) return skip(r, 'not fiction, and not on a top list');
  if (!r.fiction) {
    const text = `${r.title} ${r.original} ${(r.tags ?? []).join(' ')} ${r.category ?? ''}`;
    if (STUDY.test(text)) return skip(r, 'study guide, textbook or reference');
    if (HOWTO.test(text) && !/charitra|atmacharitra|चरित्र/i.test(text)) return skip(r, 'self-help or how-to');
    if (SOFT.test(text) && !LITERARY.test(text)) return skip(r, 'health, science, religion or music (not literary)');
  }
  return true;
});
for (const r of books) {
  r.tkeys = [...new Set([titleKey(r.title), titleKey(r.original)].filter((k) => k.length >= 2))];
  r.mkeys = [...new Set([mainKey(r.title), mainKey(r.original)].filter((k) => k.length >= 2))];
  r.akeys = [...new Set(r.authorsAll.map(surnameKey).filter((k) => k.length >= 2))];
  r.part = partOf(`${r.title} ${r.original}`);
}

/* ——— one group per book (across lists, editions and both shops) ——— */
const parent = books.map((_, i) => i);
const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
const maybeSame = [];   // same title, but one has no author: listed for a look, not merged
for (let i = 0; i < books.length; i++) for (let j = i + 1; j < books.length; j++) {
  const a = books[i], b = books[j];
  if (a.part !== b.part || !a.tkeys.some((k) => b.tkeys.includes(k))) continue;
  if (a.akeys.some((k) => b.akeys.includes(k))) parent[find(i)] = find(j);
  else if (!a.akeys.length || !b.akeys.length) maybeSame.push([a, b]);
}
const groups = new Map();
books.forEach((r, i) => { const g = find(i); groups.set(g, [...(groups.get(g) ?? []), r]); });
const G = [...groups.values()].map((items) => {
  const best = [...items].sort((a, b) => (a.rank ?? 1e9) - (b.rank ?? 1e9))[0];
  return {
    items, title: items.find((x) => x.title)?.title ?? '', original: items.find((x) => x.original)?.original ?? '',
    author: items.flatMap((x) => x.authors ?? (x.author ? [x.author] : []))[0] ?? items.find((x) => x.authorDeva)?.authorDeva ?? '',
    lang: best.lang, fiction: items.some((x) => x.fiction), lists: [...new Set(items.flatMap((x) => x.lists))],
    shops: [...new Set(items.map((x) => x.shop))], tkeys: [...new Set(items.flatMap((x) => x.tkeys))], mkeys: [...new Set(items.flatMap((x) => x.mkeys))], akeys: [...new Set(items.flatMap((x) => x.akeys))],
    part: best.part, publisher: items.find((x) => x.publisher)?.publisher ?? '', isbn: items.find((x) => x.isbn)?.isbn ?? '',
    cover: (items.find((x) => x.shop === 'akshardhara' && x.cover) ?? items.find((x) => x.cover))?.cover ?? '',
  };
});

/* ——— our catalogue ——— */
const { data: ours, error } = await db.from('titles').select('id, slug, title, original_title, creator, cover_url, ol_key, source, language').eq('kind', 'book');
if (error) { console.log('Could not read the catalogue:', error.message); process.exit(1); }
for (const t of ours) {
  // our side is compared with and without subtitles, against the shop's whole titles and their main parts
  t.tkeys = [...new Set([titleKey(t.title), titleKey(t.original_title), mainKey(t.title), mainKey(t.original_title)].filter((k) => k.length >= 2))];
  t.akeys = [surnameKey(t.creator)].filter((k) => k.length >= 2);
  t.part = partOf(`${t.title} ${t.original_title ?? ''}`);
}
for (const g of G) {
  const same = ours.filter((t) => t.part === g.part && t.tkeys.some((k) => g.tkeys.includes(k) || g.mkeys.includes(k)));
  const near = ours.filter((t) => t.part === g.part && !same.includes(t) && t.akeys.some((k) => g.akeys.includes(k))
    && t.tkeys.some((a) => g.tkeys.some((b) => Math.min(a.length, b.length) >= 4 && alike(a, b) >= 0.8)));
  const sure = same.filter((t) => t.akeys.some((k) => g.akeys.includes(k)));
  // both sides name an author and they differ: a different book with a similar title (short titles can look alike without vowels)
  const other = same.filter((t) => !sure.includes(t) && t.akeys.length && g.akeys.length);
  const open = same.filter((t) => !sure.includes(t) && !other.includes(t));
  if (other.length) g.otherAuthor = other;
  if (sure.length === 1) { g.state = 'sure'; g.ours = sure[0]; }
  else if (sure.length > 1) { g.state = 'unsure'; g.note = `${sure.length} of our records have this title and author`; g.candidates = sure; }
  else if (open.length) { g.state = 'unsure'; g.note = g.akeys.length ? 'same title; our record has no author' : 'same title; the shop gives no author'; g.candidates = open; }
  else if (near.length) { g.state = 'unsure'; g.note = 'a similar title by the same author'; g.candidates = near; }
  else g.state = 'new';
}
// Sarthak's answers to the unsure ones (private/catalogues/decisions.json): accepted → ours; rejected → a book of its own
const decided = fs.existsSync(`${OUT}/decisions.json`) ? JSON.parse(fs.readFileSync(`${OUT}/decisions.json`, 'utf8')) : { accept: [], reject: [] };
for (const g of G.filter((x) => x.state === 'unsure')) {
  const yes = g.candidates.find((t) => decided.accept.includes(t.slug));
  if (yes) { g.state = 'checked'; g.ours = yes; continue; }
  if (g.candidates.every((t) => decided.reject.includes(t.slug))) { g.state = 'new'; g.rejected = g.candidates; delete g.candidates; }
}

/* ——— Open Library, for the new ones (so a record never doubles one people can add from search) ——— */
const RAW = `${OUT}/raw/openlibrary`;
fs.mkdirSync(RAW, { recursive: true });
let lastOL = 0, askedOL = 0;
async function ol(q) {
  const url = `https://openlibrary.org/search.json?${q}&fields=key,title,author_name,cover_i,language,first_publish_year&limit=8`;
  const file = path.join(RAW, crypto.createHash('sha1').update(url).digest('hex').slice(0, 16) + '.json');
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  const wait = lastOL + 1100 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastOL = Date.now(); askedOL++;
  const r = await fetch(url, { headers: { 'User-Agent': 'Granthalaya/1.0 (contact kokanesarthak52@gmail.com)' } }).catch(() => null);
  const j = r?.ok ? await r.json().catch(() => null) : null;
  if (j) fs.writeFileSync(file, JSON.stringify(j));
  return j;
}
const fresh = G.filter((g) => g.state === 'new');
console.log(`Checking ${fresh.length} new books against Open Library (cached answers are not asked again)…`);
for (const g of fresh) {
  const asks = [g.original, g.title].filter(Boolean).map((t) => `title=${encodeURIComponent(t)}`);
  const docs = [];
  for (const q of asks) { const j = await ol(q); docs.push(...(j?.docs ?? [])); if (docs.length) break; }
  const hit = docs.find((d) => g.tkeys.includes(titleKey(d.title)) && (d.author_name ?? []).some((a) => g.akeys.includes(surnameKey(a))));
  const loose = !hit && docs.find((d) => g.tkeys.includes(titleKey(d.title)));
  if (hit) { g.state = 'openlibrary'; g.ol = { key: hit.key.replace('/works/', ''), title: hit.title, author: hit.author_name?.[0], cover: !!hit.cover_i, coverId: hit.cover_i, year: hit.first_publish_year }; }
  else if (loose) { g.olMaybe = { key: loose.key.replace('/works/', ''), title: loose.title, author: loose.author_name?.[0] }; }
}

/* ——— the report ——— */
const by = (s) => G.filter((g) => g.state === s);
const name = (g) => `${g.original || g.title}${g.original && g.title ? ` (${g.title})` : ''}${g.author ? `, ${g.author}` : ''}`;
const where = (g) => `${g.lang === 'hi' ? 'Hindi' : 'Marathi'} | ${g.fiction ? 'fiction' : 'non-fiction'} | ${g.shops.join(' + ')} | ${g.lists.join(', ')}`;
const ourName = (t) => `${t.title}${t.original_title ? ` / ${t.original_title}` : ''}, ${t.creator || 'no author'} (${t.slug}${t.cover_url ? ', has a cover' : ', no cover'})`;
const count = (list, f) => list.filter(f).length;
const sure = [...by('sure'), ...by('checked')], unsure = by('unsure'), onOL = by('openlibrary'), nw = by('new');
const leftOut = raw.filter((r) => r.skipped && /study|self-help|health/.test(r.skipped));
const lines = [
  `# Shop books: dry run ${day}`, '',
  `From ${raw.length} shop listings: ${books.length} kept, ${raw.length - books.length} left out (${Object.entries(why).map(([k, v]) => `${v} ${k}`).join(', ')}).`,
  `The ${books.length} listings are ${G.length} books (the same book in several lists, editions or both shops counts once; ${count(G, (g) => g.shops.length > 1)} are in both shops).`, '',
  '| | Books | Marathi | Hindi | Fiction |', '|---|---|---|---|---|',
  ...[['Already ours (sure, or accepted by Sarthak)', sure], ['Ours? (please check)', unsure], ['On Open Library', onOL], ['New (our own record)', nw]].map(([k, l]) =>
    `| ${k} | ${l.length} | ${count(l, (g) => g.lang === 'mr')} | ${count(l, (g) => g.lang === 'hi')} | ${count(l, (g) => g.fiction)} |`),
  '',
  `Already ours: ${count(sure, (g) => !g.ours.cover_url)} would get a cover (they have none); ${count(sure, (g) => g.ours.cover_url)} keep theirs and only get Buy links.`,
  `On Open Library: ${count(onOL, (g) => !g.ol.cover)} have no cover there and would use the shop's.`,
  `Possibly the same book in two listings, not merged because one gives no author: ${maybeSame.length} pairs (listed at the end).`, '',
  '## Please check: are these ours?', 'Tick a line to accept the match; leave it to make the book separate.', '',
  ...unsure.flatMap((g) => [`- [ ] **${name(g)}** (${where(g)}): ${g.note}`, ...g.candidates.map((t) => `    - ours: ${ourName(t)}`)]),
  '', '## Already ours (sure)', '',
  ...sure.map((g) => `- ${name(g)} → ${ourName(g.ours)} (${g.shops.join(' + ')})${g.state === 'checked' ? ' (accepted by Sarthak)' : ''}`),
  '', '## On Open Library (would come in as Open Library records)', '',
  ...onOL.map((g) => `- ${name(g)} → ${g.ol.title}, ${g.ol.author} (${g.ol.key}${g.ol.cover ? '' : ', no cover there'}) | ${where(g)}`),
  '', '## New: our own records', '',
  ...nw.map((g) => `- ${name(g)} | ${where(g)}${g.publisher ? ` | ${g.publisher}` : ''}${g.rejected ? ' | not ours (Sarthak said no)' : ''}${g.olMaybe ? ` | Open Library has the title by ${g.olMaybe.author ?? 'someone else'} (${g.olMaybe.key})` : ''}`),
  '', '## Same title as one of ours, different author (kept separate, for information)', '',
  ...G.filter((g) => g.otherAuthor).map((g) => `- ${name(g)} | ours: ${g.otherAuthor.map(ourName).join('; ')}`),
  '', '## Non-fiction left out (study, self-help, health/science/religion/music)', '',
  ...leftOut.map((r) => `- ${r.original || r.title} (${r.title || ''}; ${r.shop}) | ${r.skipped}`),
  '', '## Possibly the same book (not merged)', '',
  ...maybeSame.map(([a, b]) => `- ${a.original || a.title} (${a.shop}, ${a.authorsAll[0] ?? 'no author'}) / ${b.original || b.title} (${b.shop}, ${b.authorsAll[0] ?? 'no author'})`),
];
fs.writeFileSync(`${OUT}/matches-${day}.md`, lines.join('\n'));
fs.writeFileSync(`${OUT}/plan-${day}.json`, JSON.stringify(G.map((g) => ({ ...g, ours: g.ours?.id, candidates: g.candidates?.map((t) => t.id), items: g.items.map((x) => ({ shop: x.shop, key: x.key, url: x.url, cover: x.cover, title: x.title, original: x.original, authors: x.authorsAll, publisher: x.publisher, isbn: x.isbn, lists: x.lists })) })), null, 1));
console.log(lines.slice(0, 15).join('\n'));
console.log(`\n(${askedOL} new questions to Open Library.) Written: ${OUT}/matches-${day}.md and ${OUT}/plan-${day}.json.`);
if (!process.argv.includes('--write')) { console.log('Nothing was changed (dry run; --write saves it).'); process.exit(0); }

/* ——— --write: save it (only when Sarthak asks, after 010 is applied) ——— */
// Safe to repeat: shop rows are keyed by shop and product (a re-run updates them and never touches hidden ones);
// a book already imported reuses its record; covers only fill empty ones (a shop never replaces a cover we have).
if (unsure.length) { console.log(`${unsure.length} matches still need an answer in decisions.json; they are left out of this run.`); }
const probe = await db.from('shop_books').select('id', { head: true, count: 'exact' });
if (probe.error) { console.log('supabase/changes/010 is not applied yet. Apply it first.'); process.exit(1); }
const NAME = { akshardhara: 'Akshardhara', bookganga: 'BookGanga' };
const keysOf = G.flatMap((g) => g.items.map((x) => x.key));
const existing = new Map();
for (let i = 0; i < keysOf.length; i += 200) {
  const { data } = await db.from('shop_books').select('shop, shop_key, title_id, hidden, cover_hidden').in('shop_key', keysOf.slice(i, i + 200));
  for (const r of data ?? []) existing.set(`${r.shop}:${r.shop_key}`, r);
}
// "MAHIPATICHA GOSHTIROOP" → "Mahipaticha Goshtiroop"; "B D KHER" → "B D Kher"; mixed case is left as it is
const tidy = (s) => (s && s === s.toUpperCase() && /[A-Z]{3}/.test(s) ? s.toLowerCase().replace(/(^|[\s(-])([a-z])/g, (m, a, b) => a + b.toUpperCase()) : s ?? '').replace(/\s+/g, ' ').trim();
const slugify = (s) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/['’]/g, '').replace(/&/g, ' and ')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 70).replace(/-+$/, '');
async function freeSlug(base) {
  const b = base || 'book';
  const tries = [b, ...Array.from({ length: 8 }, (_, i) => `${b}-${i + 2}`)];
  const { data } = await db.from('titles').select('slug').in('slug', tries);
  const taken = new Set((data ?? []).map((r) => r.slug));
  return tries.find((t) => !taken.has(t)) ?? `${b}-${Date.now().toString(36)}`;
}
const latinAuthor = (g) => tidy(g.items.flatMap((x) => x.authorsAll ?? []).find((a) => !/[ऀ-ॿ]/.test(a)) ?? g.author);
const done = { covers: 0, linked: 0, olMade: 0, olFound: 0, made: 0, shopRows: 0, skippedHidden: 0, errors: 0 };
// a real cover in one of the shops' own cover folders (BookGanga's "no cover" picture, book_img.gif, sits outside them)
const COVER_OK = /^https:\/\/(cdn\.shopify\.com\/s\/files\/1\/0800\/1214\/9058\/|www\.bookganga\.com\/eBooks\/Content\/images\/books\/)[\w./%-]+$/;
for (const g of G) for (const x of g.items) if (existing.get(`${x.shop}:${x.key}`)?.cover_hidden) x.cover = '';   // a shop asked about this cover
for (const g of G) { g.cover = COVER_OK.test(g.cover ?? '') ? g.cover : (g.items.find((x) => COVER_OK.test(x.cover ?? ''))?.cover ?? ''); for (const x of g.items) if (!COVER_OK.test(x.cover ?? '')) x.cover = ''; }
for (const g of G.filter((x) => ['sure', 'checked', 'openlibrary', 'new'].includes(x.state))) {
  if (g.items.some((x) => existing.get(`${x.shop}:${x.key}`)?.hidden)) { done.skippedHidden++; continue; }
  const shopCover = g.cover || null;
  const coverFrom = shopCover ? g.items.find((x) => x.cover === shopCover)?.shop ?? null : null;
  let titleId = g.items.map((x) => existing.get(`${x.shop}:${x.key}`)?.title_id).find(Boolean) ?? null;   // imported before
  if (!titleId && (g.state === 'sure' || g.state === 'checked')) titleId = g.ours.id;
  if (!titleId && g.state === 'openlibrary') {
    const { data: had } = await db.from('titles').select('id').eq('ol_key', g.ol.key).maybeSingle();
    if (had) { titleId = had.id; done.olFound++; }
    else {
      const title = g.ol.title || tidy(g.title) || g.original;
      const row = {
        kind: 'book', slug: await freeSlug(slugify(title) || slugify(deva2latin(g.original))), title, creator: g.ol.author || latinAuthor(g), year: g.ol.year ?? null,
        ol_key: g.ol.key, original_title: /[ऀ-ॿ]/.test(g.original) && g.original !== title ? g.original : null, language: g.lang, publisher: g.publisher || null,
        cover_url: g.ol.coverId ? `https://covers.openlibrary.org/b/id/${g.ol.coverId}-L.jpg` : shopCover, cover_from: g.ol.coverId ? null : coverFrom, source: 'Open Library',
      };
      const { data, error } = await db.from('titles').insert(row).select('id').single();
      if (error) { done.errors++; console.log(`  ${title}: ${error.message}`); continue; }
      titleId = data.id; done.olMade++;
    }
  }
  if (!titleId) {
    // a new book: our own record from the shop
    const title = tidy(g.title) || g.original;
    const row = {
      kind: 'book', slug: await freeSlug(slugify(title) || slugify(deva2latin(g.original))), title, creator: latinAuthor(g), year: null,
      original_title: g.original && g.original !== title ? g.original : null, language: g.lang, publisher: g.publisher || null,
      cover_url: shopCover, cover_from: coverFrom, source: NAME[g.items[0].shop],
    };
    const { data, error } = await db.from('titles').insert(row).select('id').single();
    if (error) { done.errors++; console.log(`  ${title}: ${error.message}`); continue; }
    titleId = data.id; done.made++;
  } else if (shopCover) {
    // fill an empty cover (and publisher); never replace one
    const { data } = await db.from('titles').update({ cover_url: shopCover, cover_from: coverFrom }).eq('id', titleId).is('cover_url', null).select('id');
    if (data?.length) done.covers++;
    if (g.publisher) await db.from('titles').update({ publisher: g.publisher }).eq('id', titleId).is('publisher', null);
    done.linked++;
  }
  const rows = g.items.map((x) => ({
    shop: x.shop, shop_key: x.key, url: x.url, title: tidy(x.title).slice(0, 300), original_title: (x.original ?? '').slice(0, 300),
    author: (x.authors ?? []).join(', ').slice(0, 300), publisher: (x.publisher ?? '').slice(0, 200), language: g.lang,
    isbn: /^97[89]\d{10}$/.test(x.isbn ?? '') ? x.isbn : null, cover_src: x.cover || null, lists: x.lists ?? [], title_id: titleId,
    match: g.state, last_seen: new Date().toISOString(),
  }));
  const { error } = await db.from('shop_books').upsert(rows, { onConflict: 'shop,shop_key' });
  if (error) { done.errors++; console.log(`  shop rows for ${g.title || g.original}: ${error.message}`); } else done.shopRows += rows.length;
}
console.log(`\nSaved. Already ours, linked: ${done.linked} (${done.covers} got a cover). Open Library records made: ${done.olMade} (already in our catalogue: ${done.olFound}). New records: ${done.made}. Shop rows written: ${done.shopRows}. Left alone because a shop asked to hide them: ${done.skippedHidden}. Errors: ${done.errors}.`);
