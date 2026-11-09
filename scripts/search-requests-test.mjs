// Tries real requests against a running dev server and prints a before/after table:
//   before = what the normal title search (/api/search?q=) found for the same words
//   after  = what the request answer (/api/search?ask=) shows: its heading and the first results
//   node scripts/search-requests-test.mjs [base url]      (writes .shots/hakara-search/search-before-after.md too)
import fs from 'node:fs';
const base = process.argv[2] || 'http://localhost:4321';
const QUERIES = [
  'best sports movies', 'best war movies of the 90s', 'good horror movies', 'top rated Hindi comedy films', 'best marathi movies',
  'newest sci-fi series', 'best crime series', 'highest rated documentaries', 'romantic movies from the 80s', 'best animated films',
  'best philosophy books', 'Marathi novels about villages', 'best science fiction books', 'top history books', 'good poetry books',
  'Hindi short stories', 'best travel books', 'books about war',
  'essays on writing', 'essays about nature', 'essays on freedom', 'best essays on work',
  'उत्तम मराठी कादंबऱ्या', 'गावाबद्दल मराठी कादंबऱ्या', 'सर्वोत्तम हिंदी चित्रपट', 'मराठी चित्रपट', 'लेखनावर निबंध', 'अच्छी हिंदी कहानियाँ',
  // not requests: must stay as they were
  'the godfather', 'paterson',
];
const get = async (path) => { const t = Date.now(); try { const r = await fetch(base + path, { signal: AbortSignal.timeout(30000) }); return { j: await r.json(), ms: Date.now() - t }; } catch { return { j: null, ms: Date.now() - t }; } };
const short = (a, n = 3) => a.slice(0, n).map((x) => x.title).join('; ');
const rows = [];
for (const q of QUERIES) {
  const [before, after] = [await get(`/api/search?q=${encodeURIComponent(q)}`), await get(`/api/search?ask=${encodeURIComponent(q)}`)];
  const b = before.j, a = after.j?.answer;
  const nb = (b?.titles?.length ?? 0) + (b?.books?.length ?? 0);
  rows.push({ q, before: b ? `${nb} matches: ${short([...(b.titles ?? []), ...(b.books ?? [])]) || 'none'}` : 'no answer', heading: a?.heading ?? `(none: ${after.j?.how ?? 'no answer'})`, results: a ? `${a.items.length}: ${short(a.items, 4)}` : '', ms: after.ms });
  console.log(`${q}\n   before  ${rows.at(-1).before}\n   after   ${rows.at(-1).heading}${a ? ` -> ${rows.at(-1).results}` : ''}  [${after.ms} ms]`);
  await new Promise((r) => setTimeout(r, 1200));
}
const md = ['| Request | Before: title search | After: request answer | First results | Time |', '|---|---|---|---|---|', ...rows.map((r) => `| ${r.q} | ${r.before.replace(/\|/g, '/')} | ${r.heading.replace(/\|/g, '/')} | ${r.results.replace(/\|/g, '/')} | ${r.ms} ms |`)].join('\n');
fs.mkdirSync('.shots/hakara-search', { recursive: true });
fs.writeFileSync('.shots/hakara-search/search-before-after.md', md + '\n');
console.log(`\nanswered: ${rows.filter((r) => r.results).length}/${rows.length}`);
