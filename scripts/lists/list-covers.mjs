// Covers for list books (Marathi and Hindi records with a painted placeholder: classics, Sahitya Akademi, Jnanpith, suggested lists).
// Dry run by default: finds a shop's cover for each and writes a page to check by eye. Nothing is saved.
//
//   node scripts/lists/list-covers.mjs                 dry run: private/catalogues/list-covers-<date>.html (open it in a browser) and .json
//   node scripts/lists/list-covers.mjs --write         saves the matches Sarthak accepted (only when he asks)
//
// Where it looks, in this order, stopping at the first sure match:
//   1. the shop books we already have (shop_books in the database)
//   2. Akshardhara's whole catalogue (products.json, 250 at a time, 3 seconds apart, kept in private/catalogues/raw)
//   3. BookGanga, searched by title (10 seconds apart, its Crawl-Delay), the book's page read to check the author
// A match needs the same title (both scripts and spellings are compared: मृत्युंजय = Mrutyunjay = Mrityunjay) and the same author's surname.
// "Sure" = both agree. "Title only" = the shop gives no author, or the record has none: check these by eye. Nothing weaker is shown.
//
// --write takes the sure matches, plus any slug in private/catalogues/list-covers-decisions.json "accept", minus those in "reject".
// It sets the title's cover (cover_url, cover_from; a cover is never replaced), and adds a shop_books row so the book gets its
// "Buy at" link and credit like the other shop books. Hidden covers and books are never brought back.
// Needs PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY in .env (read here, never printed).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { titleKey, mainKey, surnameKey, partOf, alike, splitTitle } from '../shops/text.mjs';

for (const line of fs.readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z_]+)\s*=\s*"?([^"#]*?)"?\s*(#.*)?$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}
const db = createClient(process.env.PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
const write = process.argv.includes('--write');
const day = new Date().toLocaleDateString('en-CA');
const OUT = 'private/catalogues', RAW = `${OUT}/raw`;
const UA = 'Granthalaya/1.0 (book catalogue, with permission; contact kokanesarthak52@gmail.com)';
const COVER_OK = /^https:\/\/(cdn\.shopify\.com\/s\/files\/1\/0800\/1214\/9058\/|www\.bookganga\.com\/eBooks\/Content\/images\/books\/)[\w./%-]+$/;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const last = {};
async function get(url, gap) {
  const file = path.join(RAW, crypto.createHash('sha1').update(url).digest('hex').slice(0, 16) + (url.includes('.json') ? '.json' : '.html'));
  if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8');
  const host = new URL(url).hostname;
  const wait = (last[host] ?? 0) + gap - Date.now();
  if (wait > 0) await sleep(wait);
  for (let tries = 0; tries < 2; tries++) {
    last[host] = Date.now();
    const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: url.includes('.json') ? 'application/json' : 'text/html' } }).catch(() => null);
    if (r?.ok) { const t = await r.text(); fs.writeFileSync(file, t); return t; }
    await sleep(gap * 3);
  }
  return null;
}

/* ——— the records that need a cover ——— */
const titles = [];
for (let f = 0; ; f += 1000) {
  const { data, error } = await db.from('titles').select('id, slug, title, original_title, creator, language, cover_url').eq('kind', 'book').range(f, f + 999);
  if (error) { console.log(error.message); process.exit(1); }
  titles.push(...data);
  if (data.length < 1000) break;
}
const lists = {};   // slug → the lists it is in
for (const f of fs.readdirSync('src/data/lists')) {
  const l = JSON.parse(fs.readFileSync(`src/data/lists/${f}`, 'utf8'));
  if (l.kind === 'book') for (const i of l.items) if (i.slug) (lists[i.slug] ??= []).push(l.title);
}
const { data: sug } = await db.from('book_suggestions').select('language, title:titles(slug)');
for (const s of sug ?? []) if (s.title?.slug) (lists[s.title.slug] ??= []).push(s.language === 'hi' ? 'Hindi books to try' : 'Marathi books to try');
const todo = titles.filter((t) => !t.cover_url && (!t.language || ['mr', 'hi'].includes(t.language)) && lists[t.slug]);
const skipped = titles.filter((t) => !t.cover_url && !todo.includes(t));
console.log(`${todo.length} Marathi or Hindi list records have no cover (${skipped.length} other books without a cover are left alone: other languages, or in no list).`);
for (const t of todo) {
  t.tkeys = [...new Set([titleKey(t.title), titleKey(t.original_title), mainKey(t.title), mainKey(t.original_title)].filter((k) => k.length >= 2))];
  t.akey = surnameKey(t.creator);
  t.part = partOf(`${t.title} ${t.original_title ?? ''}`);
}

/* ——— matching ——— */
function judge(t, p) {
  if (t.part !== p.part) return null;
  const exact = t.tkeys.some((k) => p.tkeys.includes(k));
  const near = !exact && t.tkeys.some((a) => p.tkeys.some((b) => Math.min(a.length, b.length) >= 5 && alike(a, b) >= 0.86));
  if (!exact && !near) return null;
  const author = t.akey && p.akeys.length ? p.akeys.includes(t.akey) : null;   // null: one side names nobody
  if (author === false) return null;
  if (author === true) return exact ? 'sure' : 'likely';
  return exact ? 'title only' : null;
}
const prep = (p) => {
  p.tkeys = [...new Set([titleKey(p.title), titleKey(p.original), mainKey(p.title), mainKey(p.original)].filter((k) => k.length >= 2))];
  p.akeys = [...new Set((p.authors ?? []).map(surnameKey).filter((k) => k.length >= 2))];
  p.part = partOf(`${p.title} ${p.original}`);
  return p;
};
const RANK = { sure: 3, likely: 2, 'title only': 1 };
const matches = new Map();
function offer(t, p, how) {
  const c = judge(t, p);
  if (!c || !COVER_OK.test(p.cover ?? '')) return;
  const had = matches.get(t.slug);
  if (!had || RANK[c] > RANK[had.confidence]) matches.set(t.slug, { confidence: c, from: how, ...p });
}
const open = () => todo.filter((t) => (matches.get(t.slug)?.confidence ?? '') !== 'sure');

/* 1. the shop books we already have */
{
  const rows = [];
  for (let f = 0; ; f += 1000) {
    const { data } = await db.from('shop_books').select('shop, shop_key, url, title, original_title, author, publisher, cover_src, hidden, cover_hidden, title_id').not('cover_src', 'is', null).range(f, f + 999);
    rows.push(...(data ?? []));
    if ((data ?? []).length < 1000) break;
  }
  const pool = rows.filter((r) => !r.hidden && !r.cover_hidden).map((r) => prep({ shop: r.shop, key: r.shop_key, url: r.url, title: r.title, original: r.original_title, authors: r.author.split(/\s*,\s*/).filter(Boolean), publisher: r.publisher, cover: r.cover_src, titleId: r.title_id }));
  for (const t of todo) for (const p of pool) offer(t, p, 'a shop book we already have');
  console.log(`1. shop books we already have (${pool.length}): ${[...matches.values()].length} matches.`);
}

/* 2. Akshardhara's whole catalogue */
{
  const NOT_A_NAME = /kadambari|katha|story|hindi|top|best|seller|sahitya|akademi|publication|prakashan|house|books?$|novel|poem|kavita|natak|drama|well-known|award|puraskar|fiction|tales|edition|sale|offer|english|combo/i;
  const pool = [];
  for (let page = 1; page < 60; page++) {
    const text = await get(`https://akshardhara.com/products.json?limit=250&page=${page}`, 3000);
    const ps = text ? JSON.parse(text).products ?? [] : [];
    for (const p of ps) {
      const s = splitTitle(p.title);
      const names = (p.tags ?? []).map(String).filter((x) => /^[A-Za-z][A-Za-z. ']{2,40}$/.test(x) && /^\S+(\s+\S+){1,3}$/.test(x.trim()) && !NOT_A_NAME.test(x));
      const cover = p.images?.[0]?.src?.split('?')[0] ?? '';
      pool.push(prep({ shop: 'akshardhara', key: p.handle, url: `https://akshardhara.com/products/${p.handle}`, title: s.latin, original: s.deva, authors: [...names, ...(s.author ? [s.author] : [])], publisher: '', cover }));
    }
    if (ps.length < 250) break;
  }
  const before = matches.size;
  for (const t of open()) for (const p of pool) offer(t, p, "Akshardhara's whole catalogue");
  console.log(`2. Akshardhara's whole catalogue (${pool.length} products): ${matches.size - before} new matches.`);
}

/* 3. BookGanga, by title; the book's page tells the author */
{
  const BG = 'https://www.bookganga.com/eBooks';
  const decode = (s) => s.replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ');
  const hits = (html) => { const out = [], re = /BookThumbBlock" title="([^"]*)">[\s\S]*?\/eBooks\/Books\/details\/(\d+)\?BookName=([^'"]*)[\s\S]*?<img alt="" src="([^"]+)"/gi; for (let m; (m = re.exec(html));) out.push({ shown: decode(m[1]).trim(), key: m[2], slug: m[3], cover: m[4].split('?')[0] }); return out; };
  const details = (html) => {
    const ld = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => { try { return JSON.parse(m[1]); } catch { return null; } });
    const prod = ld.flat().find((x) => x && x['@type'] === 'Product') ?? {};
    const field = (k) => ((prod.description ?? '').match(new RegExp(`${k}\\s*\\n?\\s*:\\s*([^\\n]+)`)) ?? [])[1]?.trim() ?? '';
    const s = splitTitle(prod.name ?? '');
    return { title: s.latin, original: s.deva, author: field('Author'), publisher: field('Publisher'), cover: (prod.image?.[0] ?? '').split('?')[0] };
  };
  const left = open();
  console.log(`3. BookGanga: searching ${left.length} titles, 10 seconds apart (about ${Math.round(left.length * 15 / 60)} minutes)…`);
  let n = 0;
  for (const t of left) {
    if (++n % 10 === 0) console.log(`   ${n} of ${left.length}`);
    const seen = new Set();
    for (const q of [t.title, t.original_title].filter(Boolean)) {
      const html = await get(`${BG}/Books/Index?BookSearchTags=${encodeURIComponent(q)}`, 10000);
      for (const h of html ? hits(html).slice(0, 12) : []) {
        if (seen.has(h.key)) continue;
        seen.add(h.key);
        const keys = [titleKey(h.shown), titleKey(h.slug.replace(/-/g, ' ')), mainKey(h.shown)].filter((k) => k.length >= 2);
        if (!t.tkeys.some((k) => keys.includes(k) || keys.some((b) => Math.min(k.length, b.length) >= 5 && alike(k, b) >= 0.86))) continue;
        const page = await get(`${BG}/Books/details/${h.key}`, 10000);
        if (!page) continue;
        const d = details(page);
        offer(t, prep({ shop: 'bookganga', key: h.key, url: `${BG}/Books/details/${h.key}?BookName=${h.slug}`, title: d.title || h.slug.replace(/-/g, ' '), original: d.original || h.shown, authors: d.author.split(/\s*(?:,|&|\band\b|आणि|और)\s*/).filter(Boolean), publisher: d.publisher, cover: d.cover || h.cover }), "BookGanga's search");
      }
      if (matches.get(t.slug)?.confidence === 'sure') break;
    }
  }
}

/* ——— the page to check ——— */
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const found = todo.filter((t) => matches.has(t.slug)).sort((a, b) => RANK[matches.get(b.slug).confidence] - RANK[matches.get(a.slug).confidence] || a.title.localeCompare(b.title));
const none = todo.filter((t) => !matches.has(t.slug));
const small = (u) => (/shopify/.test(u) ? `${u}?width=160` : u);
const row = (t) => {
  const m = matches.get(t.slug);
  return `<tr class="${m.confidence.replace(' ', '-')}"><td><b>${esc(t.title)}</b><br>${esc(t.original_title)}<br><span>${esc(t.creator || 'no author')}</span><br><small>${esc((lists[t.slug] ?? []).join(', '))}</small></td>
<td><img src="${esc(small(m.cover))}" loading="lazy"></td>
<td><b>${esc(m.title)}</b><br>${esc(m.original)}<br><span>${esc((m.authors ?? []).join(', ') || 'no author given')}</span><br><small>${esc(m.shop)}: <a href="${esc(m.url)}">${esc(m.key.slice(0, 40))}</a> | ${esc(m.from)}</small></td>
<td class="c">${esc(m.confidence)}</td><td><code>${esc(t.slug)}</code></td></tr>`;
};
const html = `<!doctype html><meta charset="utf-8"><title>List covers ${day}</title>
<style>body{font:14px/1.4 system-ui;margin:24px;background:#fafafa;color:#222}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ddd;padding:8px;vertical-align:top;text-align:left}img{width:100px;display:block}span{color:#555}small{color:#777}.c{font-weight:600}.sure .c{color:#0a7}.likely .c,.title-only .c{color:#b60}h2{margin-top:32px}</style>
<h1>Covers for list books, ${day} (nothing saved)</h1>
<p>${todo.length} records with no cover. Matches: ${found.filter((t) => matches.get(t.slug).confidence === 'sure').length} sure, ${found.filter((t) => matches.get(t.slug).confidence !== 'sure').length} to check by eye. No match: ${none.length}.</p>
<table><tr><th>Our record</th><th>Shop cover</th><th>Shop book</th><th>Match</th><th>Slug</th></tr>${found.map(row).join('\n')}</table>
<h2>No match (${none.length})</h2><p>${none.map((t) => `${esc(t.title)}${t.creator ? ' (' + esc(t.creator) + ')' : ''}`).join(' · ')}</p>`;
fs.writeFileSync(`${OUT}/list-covers-${day}.html`, html);
fs.writeFileSync(`${OUT}/list-covers-${day}.json`, JSON.stringify({ found: found.map((t) => ({ id: t.id, slug: t.slug, title: t.title, creator: t.creator, ...matches.get(t.slug), tkeys: undefined, akeys: undefined })), none: none.map((t) => ({ slug: t.slug, title: t.title, creator: t.creator })) }, null, 1));
const count = (c) => found.filter((t) => matches.get(t.slug).confidence === c).length;
console.log(`\n${todo.length} records: ${count('sure')} sure, ${count('likely')} likely, ${count('title only')} title only, ${none.length} no match.`);
console.log(`Written: ${OUT}/list-covers-${day}.html (open it in a browser) and .json.`);
if (!write) { console.log('Nothing was changed (dry run; --write saves the accepted ones).'); process.exit(0); }

/* ——— --write ——— */
const dec = fs.existsSync(`${OUT}/list-covers-decisions.json`) ? JSON.parse(fs.readFileSync(`${OUT}/list-covers-decisions.json`, 'utf8')) : { accept: [], reject: [] };
const take = found.filter((t) => (matches.get(t.slug).confidence === 'sure' || dec.accept.includes(t.slug)) && !dec.reject.includes(t.slug));
let saved = 0, errors = 0;
for (const t of take) {
  const m = matches.get(t.slug);
  const { data: upd, error } = await db.from('titles').update({ cover_url: m.cover, cover_from: m.shop }).eq('id', t.id).is('cover_url', null).select('id');
  if (error) { errors++; console.log(`  ${t.slug}: ${error.message}`); continue; }
  const { data: had } = await db.from('shop_books').select('id, hidden').eq('shop', m.shop).eq('shop_key', m.key).maybeSingle();
  if (had?.hidden) { await db.from('titles').update({ cover_url: null, cover_from: null }).eq('id', t.id); continue; }
  if (!had) {
    const { error: e2 } = await db.from('shop_books').insert({ shop: m.shop, shop_key: m.key, url: m.url, title: (m.title ?? '').slice(0, 300), original_title: (m.original ?? '').slice(0, 300), author: (m.authors ?? []).join(', ').slice(0, 300), publisher: (m.publisher ?? '').slice(0, 200), language: t.language === 'hi' ? 'hi' : 'mr', cover_src: m.cover, lists: [], title_id: t.id, match: 'checked' });
    if (e2) { errors++; console.log(`  shop row for ${t.slug}: ${e2.message}`); continue; }
  }
  if (upd?.length) saved++;
}
console.log(`\nSaved: ${saved} covers, ${errors} errors.`);
