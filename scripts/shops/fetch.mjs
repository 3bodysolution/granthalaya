// The best Marathi and Hindi books from two Indian bookshops, with their permission: Akshardhara (a Shopify store) and BookGanga.
// Only their curated lists are read, never the whole catalogue:
//   Akshardhara: Top 100 Marathi Books, Bestsellers (वाचकप्रिय), Top 50, Top 25 of 2025, Sahitya Akademi winners, two Hindi lists,
//                and fiction (its Novel and Tales collections) among the top of its best-selling order.
//   BookGanga:   Best Sellers, Top 10, Novels by popularity (top 100), Hindi by popularity (top 50), and each chosen book's own page
//                (the list pages have no author).
//
//   node scripts/shops/fetch.mjs            fetches what isn't cached yet, writes private/catalogues/candidates.json
//   node scripts/shops/fetch.mjs --fresh    asks for the lists again (to pick up new books); book pages stay cached
//
// Polite: robots.txt allows these pages; one request every 3 seconds to Akshardhara and every 10 to BookGanga (its Crawl-Delay),
// with a user agent naming Granthalaya and a contact. Every answer is kept in private/catalogues/raw/ (git-ignored), so a re-run
// asks again only for what is new. Nothing here touches the database.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { splitTitle } from './text.mjs';

const UA = 'Granthalaya/1.0 (book catalogue, with permission; contact kokanesarthak52@gmail.com)';
const RAW = 'private/catalogues/raw';
const fresh = process.argv.includes('--fresh');
const FICTION_FROM_BESTSELLING = 2000;   // how far down Akshardhara's best-selling order fiction is taken from
fs.mkdirSync(RAW, { recursive: true });

const last = {};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let asked = 0;
/** one page, from the cache or the shop; `gap` is the wait between requests to that shop */
async function get(url, { gap, list = false }) {
  const file = path.join(RAW, crypto.createHash('sha1').update(url).digest('hex').slice(0, 16) + (url.includes('.json') ? '.json' : '.html'));
  if (fs.existsSync(file) && !(fresh && list)) return fs.readFileSync(file, 'utf8');
  const host = new URL(url).hostname;
  const wait = (last[host] ?? 0) + gap - Date.now();
  if (wait > 0) await sleep(wait);
  for (let tries = 0; ; tries++) {
    last[host] = Date.now();
    asked++;
    const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: url.includes('.json') ? 'application/json' : 'text/html' } }).catch((e) => ({ ok: false, status: e.message }));
    if (r.ok) { const text = await r.text(); fs.writeFileSync(file, text); return text; }
    if (tries >= 1) { console.log(`  gave up on ${url} (${r.status})`); return null; }
    await sleep(gap * 3);
  }
}

/* ——— Akshardhara ——— */
const AK = 'https://akshardhara.com';
const akGet = (u, list = true) => get(u, { gap: 3000, list });
async function akCollection(handle, max = Infinity) {
  const out = [];
  for (let page = 1; out.length < max; page++) {
    const t = await akGet(`${AK}/collections/${encodeURIComponent(handle)}/products.json?limit=250&page=${page}`);
    const ps = t ? JSON.parse(t).products ?? [] : [];
    out.push(...ps);
    if (ps.length < 250) break;
  }
  return out.slice(0, max);
}
const AK_LISTS = [
  ['top-marathi-books', 'Top 100 Marathi Books', true],
  ['best-sellers', 'Bestsellers', true],
  ['akshardhara-top-50', 'Akshardhara Top 50', true],
  ['top-25-books-of-2025', 'Top 25 Books of 2025', false],
  ['साहित्य-अकादमी-पुरस्कृत', 'Sahitya Akademi', true],
  ['hindi-books-1', 'Hindi Books', true],      // the shop's own Hindi picks: taken whole, like the top lists
  ['हिंदी-किताबें', 'हिंदी किताबें', true],
];
const HINDI_LISTS = new Set(['hindi-books-1', 'हिंदी-किताबें']);

const strip = (s) => (s ?? '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
// "PAN LAKSHAT KON GHETO ! (पण लक्षात कोण घेतो !)", "Swami (स्वामी) By Ranjit Desai" → both parts and any author named (splitTitle)
const akTitle = (t) => splitTitle(t);
// tags are a mix of the author (and translator), the publisher, genres and the shop's own lists
const PUBLISHER = /prakashan|publication|publisher|publishing|house|\bsons\b|book depot|pvt|ltd|\bpress\b|yugm|\bbooks$|पब्लिकेशन|प्रकाशन|गृह/i;
const NOT_A_NAME = /kadambari|katha|story|stories|hindi|top|best|seller|sahitya|akademi|arrival|charitra|translated|children|kumar|offer|english|hasya|lalit|well-known|raudra|vinodi|gramin|aitihasik|book|novel|poem|kavita|natak|drama|self help|history|mythology|combo|diwali|ank|maharaj|independence|award|puraskar|fiction|tales|special|kids|sale|edition|company|gruha|griha|vidyarthi|sanstha|mandal|kendra|trust|^(shringaar|shringar|bibhatsa|raudra|bhayanaka|bhayanak|karun|karuna|veer|vir|adbhut|shant|vatsalya|hasya|bhakti)$|^\d/i;
// two to four words (single words are mostly genres or publishers here: Samar, Vaicharik, Granthali)
const looksLikeName = (t) => /^[A-Za-z][A-Za-z. ']{2,40}$/.test(t) && /^\S+(\s+\S+){1,3}$/.test(t.trim()) && !PUBLISHER.test(t) && !NOT_A_NAME.test(t)
  && !/enterprise|agency|reads|related|distributor|traders|vitaran/i.test(t);
function akRecord(p, lists) {
  const t = akTitle(p.title);
  const body = strip(p.body_html);
  const devaAuthor = (body.match(/लेखक\s*[:：]\s*([^,।|]{2,60}?)(?=\s{2}|\s*(?:अनुवाद|प्रकाशक|संपादक|$))/) ?? [])[1]?.trim() ?? '';
  const tags = (p.tags ?? []).map((x) => String(x).trim());
  return {
    shop: 'akshardhara', key: p.handle, url: `${AK}/products/${p.handle}`,
    title: t.latin, original: t.deva, authors: [...new Set([...tags.filter(looksLikeName), ...(t.author ? [t.author] : [])])], authorDeva: devaAuthor, tags,
    publisher: tags.find((x) => PUBLISHER.test(x) && !NOT_A_NAME.test(x.replace(/books$/i, ''))) ?? tags.find((x) => PUBLISHER.test(x)) ?? '',
    isbn: (p.variants ?? []).map((v) => v.sku).find((s) => /^97[89]\d{10}$/.test(String(s ?? ''))) ?? '',
    cover: p.images?.[0]?.src?.split('?')[0] ?? '', lists,
  };
}

async function akshardhara() {
  console.log('Akshardhara');
  const byHandle = new Map();
  const add = (p, list) => {
    const r = byHandle.get(p.handle) ?? akRecord(p, []);
    if (!r.lists.includes(list)) r.lists.push(list);
    byHandle.set(p.handle, r);
    return r;
  };
  for (const [handle, name, top] of AK_LISTS) {
    const ps = await akCollection(handle);
    console.log(`  ${name}: ${ps.length}`);
    ps.forEach((p, i) => { const r = add(p, name); r.rank = Math.min(r.rank ?? 1e9, i + 1); if (top) r.topList = true; if (HINDI_LISTS.has(handle)) r.language = 'hi'; });
  }
  // fiction: books in its Novel or Tales collections, taken from the top of its best-selling order
  const fiction = new Set();
  for (const h of ['कादंबरी', 'कथा-tales']) for (const p of await akCollection(h)) fiction.add(p.handle);
  console.log(`  Novel and Tales collections: ${fiction.size} books`);
  const best = await akCollection('best-selling-products', FICTION_FROM_BESTSELLING);
  let n = 0;
  best.forEach((p, i) => { if (fiction.has(p.handle)) { const r = add(p, 'Best-selling fiction'); r.bestRank = i + 1; n++; } });
  console.log(`  best-selling fiction in the top ${FICTION_FROM_BESTSELLING}: ${n}`);
  // fiction: in its Novel or Tales collections, or tagged as a novel, stories, poems, a play or humour
  const FICTION_TAGS = /kadambari|katha|story|stories|kavita|kavya|poem|poetry|natak|drama|ekankika|vinodi|hasya|upanyas|kahani|कादंबरी|कथा|कविता|काव्य|नाटक|उपन्यास|कहानी|ग़ज़ल|गजल|शायरी|shayari|ghazal/i;
  for (const r of byHandle.values()) r.fiction = fiction.has(r.key) || r.tags.some((t) => FICTION_TAGS.test(t));
  return [...byHandle.values()];
}

/* ——— BookGanga ——— */
const BG = 'https://www.bookganga.com/eBooks';
const bgGet = (u, list) => get(u, { gap: 10000, list });
// [list page, name, a top list, how many books to take] (a page shows 50; more come from its own "load more" address)
const BG_LISTS = [
  [`${BG}/Books/Index?PID=5725259359419354683&IpP=260&SelSortBy=7`, 'Best Sellers', true, 260],
  [`${BG}/Books/Index?CID=4882314906561278979&IpP=50&SelSortBy=7`, 'Top 10', true, 50],
  [`${BG}/Books/Index?CID=6&IpP=100&SelSortBy=7`, 'Novels (most popular)', false, 100],
  [`${BG}/Books/Index?LID=5567315246161536661&IpP=50&SelSortBy=7`, 'Hindi (most popular)', true, 50],
];
// the rest of a list after its first 50, as the page itself asks for it when you scroll
async function bgMore(html, want) {
  const total = Number((html.match(/TotalRecords\s*=\s*(\d+)/) ?? [])[1] ?? 0);
  const val = (id) => decode((html.match(new RegExp(`id="${id}"[^>]*value="([^"]*)"`)) ?? html.match(new RegExp(`value="([^"]*)"[^>]*id="${id}"`)) ?? [])[1] ?? '');
  const sort = (html.match(/\$\('#SelSortBy'\)\.val\('(\d+)'\)/) ?? [])[1] ?? val('SelSortBy');
  const f = {};
  for (const k of ['BookSearchTags', 'BookTitle', 'BT', 'ISBN', 'AID', 'LID', 'CID', 'PID', 'FC', 'EB', 'EM', 'FEB', 'FEM', 'cmdSearch', 'BookType', 'LR', 'UR', 'CR', 'Ath', 'Pub', 'BTitle', 'EId', 'SelSortBy', 'NEB', 'NB', 'IncOutOfStock', 'SelCatOnly', 'Alpha']) f[k] = k === 'BookTitle' ? val('BTitle') : val(k);
  f.SelSortBy = sort;
  const bt = (html.match(/\$\('#BookType'\)\.val\('(\d+)'\)/) ?? [])[1];
  if (bt) f.BookType = bt;
  const out = [];
  for (let start = 50; start < Math.min(total, want); start += 50) {
    const u = `${BG}/Common/LoadMoreBooKList?StartIndex=${start}&EndIndex=${start + 50}&BookFilter=${encodeURIComponent(JSON.stringify(f))}&ListView=0`;
    const t = await bgGet(u, true);
    let frag = t ?? '';
    try { frag = JSON.parse(frag); } catch { /* already HTML */ }
    const got = bgList(String(frag));
    out.push(...got);
    if (!got.length) break;
  }
  return out;
}
const decode = (s) => s.replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ');
function bgList(html) {
  const out = [];
  const re = /BookThumbBlock" title="([^"]*)">[\s\S]*?\/eBooks\/Books\/details\/(\d+)\?BookName=([^'"]*)[\s\S]*?<img alt="" src="([^"]+)"/gi;
  for (let m; (m = re.exec(html));) out.push({ key: m[2], titleShown: decode(m[1]).trim(), slug: m[3], cover: m[4].split('?')[0] });
  return out;
}
function bgDetails(html) {
  const ld = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => { try { return JSON.parse(m[1]); } catch { return null; } });
  const prod = ld.flat().find((x) => x && x['@type'] === 'Product') ?? {};
  const desc = prod.description ?? '';
  const field = (k) => (desc.match(new RegExp(`${k}\\s*\\n?\\s*:\\s*([^\\n]+)`)) ?? [])[1]?.trim() ?? '';
  // "मुसाफिर (Musafir) By Achyut Godbole"
  const { latin, deva } = splitTitle(prod.name ?? '');
  const cat = strip((html.match(/Category\s*:([\s\S]{0,600}?)All Bo/) ?? [])[1] ?? '').replace(/\|/g, ' ').trim();
  const lang = field('Language');
  return {
    title: latin.trim(), original: deva.trim(), author: field('Author'), publisher: field('Publisher') || prod.brand?.name || '',
    pages: Number(field('Pages')) || null, language: /हिंदी|hindi/i.test(lang) ? 'hi' : /मराठी|marathi/i.test(lang) ? 'mr' : /english|इंग्रजी/i.test(lang) ? 'en' : lang,
    category: cat, isbn: (html.match(/ISBN13\s*:\s*(97[89]\d{10})/) ?? [])[1] ?? '',
    cover: (prod.image?.[0] ?? '').split('?')[0],
  };
}
const BG_FICTION = /कादंबरी|कथा|कविता|काव्य|नाटक|एकांकिका|विनोदी|रहस्य|उपन्यास|कहानी|novel|fiction|stories|poetry|drama/i;

async function bookganga() {
  console.log('BookGanga');
  const byKey = new Map();
  for (const [url, name, top, want] of BG_LISTS) {
    const html = await bgGet(url, true);
    const items = html ? [...bgList(html), ...(await bgMore(html, want))].slice(0, want) : [];
    console.log(`  ${name}: ${items.length}`);
    items.forEach((it, i) => {
      const r = byKey.get(it.key) ?? { shop: 'bookganga', key: it.key, url: `${BG}/Books/details/${it.key}?BookName=${it.slug}`, titleShown: it.titleShown, cover: it.cover, lists: [] };
      if (!r.lists.includes(name)) r.lists.push(name);
      r.rank = Math.min(r.rank ?? 1e9, i + 1);
      if (top) r.topList = true;
      if (name.startsWith('Hindi')) r.language = 'hi';
      byKey.set(it.key, r);
    });
  }
  const all = [...byKey.values()];
  console.log(`  ${all.length} books; reading each book's page (cached ones are not asked again)`);
  let i = 0;
  for (const r of all) {
    const html = await bgGet(`${BG}/Books/details/${r.key}`, false);
    if (++i % 25 === 0) console.log(`    ${i} of ${all.length}`);
    if (!html) continue;
    const d = bgDetails(html);
    Object.assign(r, { ...d, language: r.language ?? d.language, cover: d.cover || r.cover, title: d.title, original: d.original || r.titleShown });
    r.fiction = BG_FICTION.test(r.category) || r.lists.includes('Novels (most popular)');
  }
  return all;
}

const which = process.argv.find((a) => a.startsWith('--only='))?.slice(7);
const out = [];
if (!which || which === 'akshardhara') out.push(...await akshardhara());
if (!which || which === 'bookganga') out.push(...await bookganga());
const file = 'private/catalogues/candidates.json';
const before = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : [];
const keep = which ? before.filter((r) => r.shop !== which) : [];
fs.writeFileSync(file, JSON.stringify([...keep, ...out], null, 1));
console.log(`\n${out.length} books written to ${file} (${asked} new requests).`);
