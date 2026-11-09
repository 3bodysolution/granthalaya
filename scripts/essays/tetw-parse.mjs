// Reads the saved tetw.org page (private/catalogues/tetw-new-yorker/page.html.html, saved by hand from a browser) and writes the list:
// author, title, newyorker.com link and the year when the link carries a date. Reads the file only; no network.
//   node scripts/essays/tetw-parse.mjs
import fs from 'node:fs';
const dir = 'private/catalogues/tetw-new-yorker';
const html = fs.readFileSync(`${dir}/page.html.html`, 'utf8');
// addresses that moved since tetw.org linked them (checked: the old one answered 404, this one answers)
const MOVED = { 'https://www.newyorker.com/reporting/2012/03/05/120305fa_fact_paumgarten': 'https://www.newyorker.com/magazine/2012/03/05/magic-mountain' };
const out = [], skipped = [];
// the page's own machine-readable list (schema.org ItemList), in page order; it has every entry (the headings show only three per author)
const ld = html.slice(html.indexOf('"itemListElement"'));
for (const m of ld.matchAll(/"headline":\s*"((?:[^"\\]|\\.)*)",\s*"url":\s*"([^"]+)",\s*"author":\s*\{"@type":\s*"Person",\s*"name":\s*"((?:[^"\\]|\\.)*)"/g)) {
  const title = JSON.parse(`"${m[1]}"`), author = JSON.parse(`"${m[3]}"`);
  const u = new URL(m[2]); u.protocol = 'https:';
  if (!/(^|\.)newyorker\.com$/.test(u.hostname)) { skipped.push(`${author} | ${title} | ${m[2]}`); continue; }   // only newyorker.com links
  u.search = ''; u.hash = '';
  if (MOVED[u.href]) u.href = MOVED[u.href];
  const y = u.href.match(/\/((?:19|20)\d\d)\/\d\d\/\d\d\//);
  out.push({ n: out.length + 1, author, title, url: u.href, year: y ? Number(y[1]) : null });
}
fs.writeFileSync(`${dir}/list.json`, JSON.stringify(out, null, 1));
console.log(`${out.length} articles, ${new Set(out.map((x) => x.author)).size} authors, ${out.filter((x) => x.year).length} with a year from the link`);
if (skipped.length) console.log('left out (not on newyorker.com):\n  ' + skipped.join('\n  '));
