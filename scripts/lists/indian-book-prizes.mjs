// Builds three list files in src/data/lists/:
//   sahitya-akademi-marathi.json, sahitya-akademi-hindi.json, jnanpith.json
// Sources: English Wikipedia (wikitext via the MediaWiki API) for the winners,
// Wikidata for original-script titles and English labels. Where the Jnanpith
// table names no book (lifetime awards), the laureate's notable work on Wikidata
// (or failing that their most-linked book) is picked; those items are marked check.
// Run from the project root: node scripts/lists/indian-book-prizes.mjs
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = join(ROOT, 'src', 'data', 'lists');
const UA = 'GranthalayaDataBot/1.0 (Granthalaya project; scripts/lists/indian-book-prizes.mjs)';

const PAGES = {
  marathi: 'List_of_Sahitya_Akademi_Award_winners_for_Marathi',
  hindi: 'List_of_Sahitya_Akademi_Award_winners_for_Hindi',
  jnanpith: 'Jnanpith_Award',
};

const LANG = {
  Assamese: 'as', Bengali: 'bn', Bodo: 'brx', Dogri: 'doi', English: 'en', Gujarati: 'gu',
  Hindi: 'hi', Kannada: 'kn', Kashmiri: 'ks', Konkani: 'kok', Maithili: 'mai', Malayalam: 'ml',
  Manipuri: 'mni', Marathi: 'mr', Nepali: 'ne', Odia: 'or', Oriya: 'or', Punjabi: 'pa',
  Sanskrit: 'sa', Santali: 'sat', Sindhi: 'sd', Tamil: 'ta', Telugu: 'te', Urdu: 'ur',
};
// English books are not needed for original-script titles, and its query is too large.
const CODES = [...new Set(Object.values(LANG))].filter((c) => c !== 'en');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(url) {
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      lastErr = err;
      await sleep(2000 * attempt);
    }
  }
  throw lastErr;
}

const sparql = (query) => getJson(`https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(query)}`);

async function getWikitext(page) {
  const json = await getJson(
    `https://en.wikipedia.org/w/api.php?action=parse&page=${page}&prop=wikitext&format=json&formatversion=2`,
  );
  if (!json.parse) throw new Error(`Wikipedia ${page}: no page`);
  return json.parse.wikitext;
}

// Wikidata: books in each prize language, with their label in that language.
// One query per language keeps each request small enough for the endpoint.
async function getWikidataWorks() {
  const works = {};
  for (const lc of CODES) {
    const query = `
SELECT ?item ?en ?nat WHERE {
  ?l wdt:P424 "${lc}" .
  ?item wdt:P407 ?l ; wdt:P31 wd:Q7725634 ; rdfs:label ?nat .
  FILTER(LANG(?nat) = "${lc}")
  OPTIONAL { ?item rdfs:label ?en . FILTER(LANG(?en) = "en") }
}`;
    try {
      const json = await sparql(query);
      for (const b of json.results.bindings) {
        (works[lc] ||= []).push({ en: b.en ? b.en.value : '', nat: b.nat.value });
      }
    } catch (err) {
      console.warn(`Wikidata ${lc} failed, its titles will be marked for checking: ${err.message}`);
    }
  }
  return works;
}

// Remove wiki markup from one piece of text.
function wikiClean(input) {
  let s = input
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<ref[^>]*\/>/g, '')
    .replace(/<ref[^>]*>[\s\S]*?<\/ref>/g, '')
    .replace(/\[\[(?:File|Image):[^\]]*\]\]/gi, '');
  let prev;
  do {
    prev = s;
    s = s.replace(/\{\{([^{}]*)\}\}/g, (_, inner) => template(inner));
  } while (s !== prev);
  return s
    .replace(/\[\[[^\]|]*\|([^\]]*)\]\]/g, '$1')
    .replace(/\[\[([^\]]*)\]\]/g, '$1')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/'{2,}/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/—/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function template(inner) {
  const name = inner.split('|')[0].trim().toLowerCase();
  // {{sort|key|display}}: the display text is what readers see; keep any link for wikiClean.
  if (name === 'sort') {
    const rest = inner.slice(inner.indexOf('|') + 1);
    const second = rest.indexOf('|');
    return second >= 0 ? rest.slice(second + 1) : rest;
  }
  const parts = inner.split('|').map((p) => p.trim());
  // Named options such as dab=author are ignored. sortname is first name, surname, optional display text.
  const args = parts.slice(1).filter((p) => p && !p.includes('='));
  if (name === 'sortname') return args.length >= 3 ? args[2] : args.slice(0, 2).join(' ');
  if (['small', 'lang', 'nowrap', 'nobold', 'unicode', 'transl', 'transliteration'].includes(name)) {
    return args.pop() || '';
  }
  return '';
}

// Split a wikitable into rows of cleaned cell strings.
function tableRows(text, marker) {
  const at = text.indexOf(marker);
  if (at < 0) throw new Error(`table marker not found: ${marker}`);
  const start = text.lastIndexOf('{|', at);
  const end = text.indexOf('\n|}', at);
  const rows = [];
  let cur = null;
  for (const raw of text.slice(start, end).split('\n')) {
    const t = raw.trimEnd();
    if (!t || t.startsWith('{|') || t.startsWith('|+') || t.startsWith('|}')) continue;
    if (t.startsWith('|-')) {
      cur = [];
      rows.push(cur);
      continue;
    }
    if (/^[|!]/.test(t)) {
      if (!cur) rows.push((cur = []));
      const body = t.slice(1);
      cur.push(...(t[0] === '!' ? body.split('!!') : body.split('||')));
    } else if (cur && cur.length) {
      cur[cur.length - 1] += ' ' + t;
    }
  }
  return rows.map((cells) =>
    cells.map((c) => {
      // Drop cell attributes such as style="..." or rowspan=2 before the cell's own "|".
      const raw = /^\s*[\w-]+\s*=/.test(c) ? c.replace(/^[^|[]*\|(?!\|)/, '') : c;
      return wikiClean(raw);
    }),
  );
}

const isNonLatin = (s) => /[^\x00-\x7F]/.test(s);
const norm = (s) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');

// Find the original-script title of a book by its Latin title in Wikidata.
function findNative(works, lc, latin) {
  const list = (works[lc] || []).filter((w) => isNonLatin(w.nat));
  const n = norm(latin);
  if (!n) return null;
  const exact = list.find((w) => w.en && norm(w.en) === n);
  if (exact) return { nat: exact.nat, en: exact.en, how: 'exact' };
  if (n.length >= 6) {
    const fuzzy = list.filter((w) => {
      const e = norm(w.en);
      return e.length >= 6 && (e.includes(n) || n.includes(e));
    });
    if (new Set(fuzzy.map((w) => w.nat)).size === 1) return { nat: fuzzy[0].nat, en: fuzzy[0].en, how: 'fuzzy' };
  }
  return null;
}

function sahitya(rows, lc, works) {
  const header = rows.find((r) => r.some((c) => /^year$/i.test(c)));
  const iYear = header.findIndex((c) => /^year$/i.test(c));
  const iAuthor = header.findIndex((c) => /author/i.test(c));
  const iWork = header.findIndex((c) => /work/i.test(c));
  const items = [];
  for (const r of rows) {
    if (r === header) continue;
    const year = r[iYear] || '';
    if (!/^\d{4}$/.test(year)) continue;
    if (r.join(' ').includes('No Award')) continue;
    const title = r[iWork] || '';
    const creator = r[iAuthor] || '';
    const item = { year: Number(year), title, creator, language: lc };
    const m = findNative(works, lc, title);
    if (m) {
      item.original_title = m.nat;
      if (m.how !== 'exact' || !m.en) item.check = true;
    } else {
      item.check = true;
    }
    if (!title || !creator) item.check = true;
    items.push(item);
  }
  return items;
}

function jnanpithRows(rows) {
  const items = [];
  let year = null;
  for (const r of rows) {
    if (r[0] === 'Year' || r[1] === 'Recipient') continue;
    let cells = r;
    if (/^\d{4}/.test(cells[0])) {
      year = Number(cells[0].match(/^\d{4}/)[0]);
      cells = cells.slice(1);
    }
    const [creator = '', language = '', cited = ''] = cells;
    // Since the 1980s the award is often for a lifetime's work, so the table names no book.
    const work = /^lifetime contribution$/i.test(cited) ? '' : cited;
    if (!creator) continue;
    const code = LANG[language.split(/[,/]/)[0].trim()] || '';
    const item = { year, title: work, creator, pick: true };
    if (code) item.language = code;
    item.check = true;
    items.push(item);
  }
  return items;
}

// Resolve the Wikidata id of each laureate from their Wikipedia page name.
async function personIds(names) {
  const ids = {};
  for (let i = 0; i < names.length; i += 40) {
    const batch = names.slice(i, i + 40);
    const j = await getJson(
      `https://en.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(batch.join('|'))}&redirects=1&prop=pageprops&ppprop=wikibase_item&format=json&formatversion=2`,
    );
    const normalized = Object.fromEntries((j.query.normalized || []).map((n) => [n.from, n.to]));
    const redirects = Object.fromEntries((j.query.redirects || []).map((r) => [r.from, r.to]));
    const byTitle = Object.fromEntries(j.query.pages.map((p) => [p.title, p.pageprops?.wikibase_item]));
    for (const name of batch) {
      const t = redirects[normalized[name] || name] || normalized[name] || name;
      if (byTitle[t]) ids[name] = byTitle[t];
    }
  }
  return ids;
}

// For each laureate: a notable work listed on Wikidata (P800), else the most-linked book by them.
async function topWorks(qids) {
  const top = {};
  for (let i = 0; i < qids.length; i += 40) {
    const values = qids.slice(i, i + 40).map((q) => `wd:${q}`).join(' ');
    const notable = await sparql(`
SELECT ?person ?work ?sl WHERE {
  VALUES ?person { ${values} }
  ?person wdt:P800 ?work . ?work wikibase:sitelinks ?sl .
} ORDER BY DESC(?sl)`);
    for (const b of notable.results.bindings) {
      const pid = b.person.value.split('/').pop();
      if (!top[pid]) top[pid] = b.work.value.split('/').pop();
    }
    const authored = await sparql(`
SELECT ?person ?work ?sl WHERE {
  VALUES ?person { ${values} }
  ?work wdt:P50 ?person ; wdt:P31 ?t ; wikibase:sitelinks ?sl .
  VALUES ?t { wd:Q7725634 wd:Q571 }
} ORDER BY DESC(?sl)`);
    for (const b of authored.results.bindings) {
      const pid = b.person.value.split('/').pop();
      if (!top[pid]) top[pid] = b.work.value.split('/').pop();
    }
  }
  return top;
}

async function labelsFor(ids, langs) {
  const out = {};
  for (let i = 0; i < ids.length; i += 50) {
    const j = await getJson(
      `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${ids.slice(i, i + 50).join('|')}&props=labels&languages=${langs.join('|')}&format=json`,
    );
    for (const [id, e] of Object.entries(j.entities || {})) {
      out[id] = Object.fromEntries(Object.entries(e.labels || {}).map(([k, v]) => [k, v.value]));
    }
  }
  return out;
}

// Items where the award names no book get the laureate's chosen work.
async function pickBooks(items) {
  const need = items.filter((i) => !i.title);
  if (!need.length) return;
  const ids = await personIds([...new Set(need.map((i) => i.creator))]);
  const qids = [...new Set(Object.values(ids))];
  const top = qids.length ? await topWorks(qids) : {};
  const workIds = [...new Set(Object.values(top))];
  const labels = workIds.length ? await labelsFor(workIds, ['en', ...CODES]) : {};
  for (const item of need) {
    const qid = ids[item.creator];
    const wid = qid && top[qid];
    if (!wid) continue;
    const lab = labels[wid] || {};
    const en = lab.en || '';
    const nat = lab[item.language] || '';
    item.title = en || (isNonLatin(nat) ? '' : nat);
    if (isNonLatin(nat)) item.original_title = nat;
  }
}

const sortNewest = (items) => items.sort((a, b) => b.year - a.year);

async function main() {
  const works = await getWikidataWorks();
  const wikitext = {};
  for (const [k, page] of Object.entries(PAGES)) wikitext[k] = await getWikitext(page);

  const marathiRows = tableRows(wikitext.marathi, 'class="wikitable sortable"');
  const hindiRows = tableRows(wikitext.hindi, 'class="wikitable sortable"');
  const jnanRows = tableRows(wikitext.jnanpith, '|+List of award recipients');

  const jnanItems = jnanpithRows(jnanRows);
  await pickBooks(jnanItems);

  const files = {
    'sahitya-akademi-marathi.json': {
      slug: 'sahitya-akademi-marathi',
      title: 'Sahitya Akademi Award winners in Marathi',
      kind: 'book',
      intro: "The winning book of the Sahitya Akademi Award for Marathi, given each year since 1955 by India's national academy of letters.",
      source: { name: 'Wikipedia', url: `https://en.wikipedia.org/wiki/${PAGES.marathi}` },
      items: sortNewest(sahitya(marathiRows, 'mr', works)),
    },
    'sahitya-akademi-hindi.json': {
      slug: 'sahitya-akademi-hindi',
      title: 'Sahitya Akademi Award winners in Hindi',
      kind: 'book',
      intro: "The winning book of the Sahitya Akademi Award for Hindi, given each year since 1955 by India's national academy of letters.",
      source: { name: 'Wikipedia', url: `https://en.wikipedia.org/wiki/${PAGES.hindi}` },
      items: sortNewest(sahitya(hindiRows, 'hi', works)),
    },
    'jnanpith.json': {
      slug: 'jnanpith',
      title: 'Jnanpith Award winners',
      kind: 'book',
      intro: "Every winner of the Jnanpith Award since 1965, India's highest literary award, with one book by each writer that is a good place to start reading them.",
      source: { name: 'Wikipedia', url: `https://en.wikipedia.org/wiki/${PAGES.jnanpith}` },
      items: sortNewest(jnanItems),
    },
  };

  for (const [name, data] of Object.entries(files)) {
    writeFileSync(join(OUT, name), JSON.stringify(data, null, 2) + '\n', 'utf8');
    const years = data.items.map((i) => i.year);
    const flagged = data.items.filter((i) => i.check).length;
    console.log(`${name}: ${data.items.length} items, ${Math.min(...years)}-${Math.max(...years)}, ${flagged} marked check`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
