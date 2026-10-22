// Writes a description (`titles.description`) for every book already in the catalogue, the same way the site does for a book
// whose page is opened: Wikipedia's intro when the page is clearly this book, else Open Library's text; cleaned, and shortened to
// 2 or 3 sentences by a free AI model when long or messy (src/lib/catalog/describe-core.mjs). Only empty fields are filled.
// Google Books text is never saved.
//
//   node scripts/fill-descriptions.mjs              dry run (the default): looks up Wikipedia and Open Library, prints each
//                                                   Wikipedia match for a look, asks no AI and writes nothing
//   node scripts/fill-descriptions.mjs --write      does it (only when Sarthak asks for it in that message)
//   --limit=N                                       stops after N books (the free AI allowance is limited; run it again to carry on)
//
// Needs PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY (and an AI key for --write) in .env. Nothing from .env is printed.
// The dry run also works before supabase/changes/007 is applied (it then treats every book as having no description).
import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { describeBook, MAX } from '../src/lib/catalog/describe-core.mjs';

try {
  for (const line of fs.readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*"?([^"#]*?)"?\s*(#.*)?$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
} catch { /* no .env */ }
if (!process.env.PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SECRET_KEY) { console.log('Add PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY to .env first.'); process.exit(1); }
const write = process.argv.includes('--write');
const limit = Number(process.argv.find((a) => a.startsWith('--limit='))?.slice(8)) || Infinity;
const keys = { gemini: process.env.GEMINI_API_KEY, geminiModel: process.env.GEMINI_MODEL, groq: process.env.GROQ_API_KEY, groqModel: process.env.GROQ_MODEL };
const db = createClient(process.env.PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
if (write && !keys.gemini && !keys.groq) { console.log('No AI key in .env.'); process.exit(1); }

// every book still without a description
let column = true;
const rows = [];
for (let from = 0; ; from += 500) {
  const read = () => {
    const q = db.from('titles').select(`id, slug, title, creator, year, ol_key${column ? ', description' : ''}`).eq('kind', 'book');
    return (column ? q.is('description', null) : q).order('created_at').range(from, from + 499);
  };
  let { data, error } = await read();
  if (error && column && !write) { column = false; ({ data, error } = await read()); }   // 007 not applied yet: a dry run can still look
  if (error) { console.log('Could not read the catalogue:', error.message, '(is supabase/changes/007 applied?)'); process.exit(1); }
  rows.push(...data);
  if (data.length < 500) break;
}
console.log(`Books without a description: ${rows.length}${column ? '' : ' (007 is not applied yet, so every book counts)'}; ${rows.filter((r) => r.ol_key).length} have an Open Library work`);

async function olText(key) {
  if (!key) return null;
  for (let t = 0; t < 2; t++) {
    try {
      const r = await fetch(`https://openlibrary.org/works/${key}.json`, { headers: { 'User-Agent': 'Granthalaya/1.0 (book descriptions)' }, signal: AbortSignal.timeout(20000) });
      if (r.status === 404) return null;
      if (r.ok) { const d = (await r.json()).description; return typeof d === 'string' ? d : d?.value ?? null; }
    } catch { /* try again */ }
    await sleep(1000);
  }
  return null;
}
// the same tidy-up the site's plain() does for catalogue text (markdown links, HTML, the "----" tail)
const plain = (s) => String(s ?? '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n\n').replace(/<[^>]+>/g, '')
  .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/\[([^\]]+)\]\[\d+\]/g, '$1').replace(/^\s*\[\d+\]:.*$/gm, '')
  .replace(/[*_]{1,2}([^*_]+)[*_]{1,2}/g, '$1').replace(/^-{3,}[\s\S]*$/m, '').replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim();

const tally = { wikipedia: 0, openlibrary: 0, 'ai-wikipedia': 0, 'ai-openlibrary': 0, nothing: 0, rejected: 0 };
const matches = [], rejected = [];
let done = 0, changed = 0, stopped = false;
for (const r of rows) {
  if (done >= limit) break;
  done++;
  const ol = plain(await olText(r.ol_key));
  const d = await describeBook({ title: r.title, creator: r.creator, year: r.year, olText: ol }, keys, { ai: write });
  if (d.wiki) matches.push(`  ${r.title} (${r.creator || 'no author'}) -> ${d.wiki.title} [${d.wiki.description}]${d.source === 'openlibrary' || d.source === 'ai-openlibrary' ? ' (intro too short, Open Library used)' : ''}`);
  if (d.wikiRejected) { tally.rejected++; rejected.push(`  ${r.title} (${r.creator || 'no author'}) -x- ${d.wikiRejected.title} [${d.wikiRejected.description}]`); }
  if (!d.text) { tally.nothing++; await sleep(300); continue; }
  tally[d.source]++;
  if (!write) { await sleep(300); continue; }   // be gentle with Wikipedia
  if (d.needsAi && d.aiFailed) { console.log(`  no AI answer for "${r.title}": stopping (the allowance may be used up; run it again later)`); stopped = true; tally[d.source]--; break; }
  const { error } = await db.from('titles').update({ description: d.text.slice(0, MAX), description_source: d.source, description_url: d.url, description_checked_at: new Date().toISOString() })
    .eq('id', r.id).is('description', null);
  if (error) console.log(`  could not save "${r.title}": ${error.message}`);
  else { changed++; console.log(`  ${r.title}: [${d.source}] ${d.text.slice(0, 90)}${d.text.length > 90 ? '…' : ''}`); }
  await sleep(d.needsAi ? 3500 : 300);   // a free AI allowance is a few calls a minute
}

console.log(`\nWikipedia matches (${matches.length}):`);
console.log(matches.join('\n') || '  none');
console.log(`\nWikipedia pages found but left out because the author's surname isn't on them (${rejected.length}):`);
console.log(rejected.join('\n') || '  none');
console.log(`\n${write ? 'Saved' : 'Would save'}: ${tally.wikipedia} from Wikipedia as it is, ${tally['ai-wikipedia']} shortened from Wikipedia by the AI, ${tally.openlibrary} from Open Library as it is, ${tally['ai-openlibrary']} shortened from Open Library by the AI; ${tally.nothing} with nothing usable; ${done} looked at${stopped ? ', stopped early' : ''}.`);
if (write) console.log(`${changed} titles changed.`);
else console.log('(dry run: no AI was asked and nothing was changed)');
