// From private/catalogues/hakara/posts.json picks the essays and long articles: Marathi (Devanagari title), in the Reflection (परामर्श) or
// Editorial (संपादकीय) categories, at least 600 words. A second list holds long Marathi pieces from other categories (Panorama, Narrative)
// for Sarthak to decide. Each piece is paired with its English version (same author and day, no Devanagari, nearest in length) so a gist
// can be written from real text. Writes private/catalogues/hakara/candidates.json.  node scripts/hakara/select.mjs
import fs from 'node:fs';
const dir = 'private/catalogues/hakara';
const posts = JSON.parse(fs.readFileSync(`${dir}/posts.json`, 'utf8'));
const dev = (t) => /[ऀ-ॿ]/.test(t);
const day = (p) => p.date.slice(0, 10);
// "TITLE’ : Author", "TITLE’ | मूळ ... : X । मराठी अनुवाद : Y", "TITLE : Author" -> the title as written, the Devanagari author if given, the translator
const split = (t) => {
  const tr = t.match(/मराठी अनुवाद\s*:\s*([^|।’]+)/)?.[1]?.trim() ?? null;
  const orig = t.match(/(?:मूळ[^:]*|मूळ इंग्रजी[^:]*)\s*:\s*([^।|’]+)/)?.[1]?.trim() ?? null;
  let title = t.split(/’|\s\|\s|\s\|/)[0].replace(/\s*[:।]\s*(मूळ|अनुवाद|Original|English Translation).*$/, '').replace(/\s*\((Originally Published|मूळ)[^)]*$/, '').trim();
  let by = null;
  const c = title.match(/^(.*\S)\s+:\s+([^:]+)$/);       // "title : author" with no closing quote
  if (!t.includes('’') && c && dev(c[2]) && c[2].split(' ').length <= 4) { title = c[1].trim(); by = c[2].trim(); }
  const after = t.match(/’\s*:\s*([^|]+?)\s*$/)?.[1]?.trim();   // "title’ : author"
  if (after && !/मूळ|अनुवाद/.test(after)) by = after;
  return { title: title.replace(/^[‘'"]+/, ''), by: by ?? orig, translator: tr };
};
const isEssay = (p) => p.categories.some((c) => /Reflection|परामर्श|Editorial|संपादकीय/.test(c));
const other = (p) => p.categories.some((c) => /Panorama|दृश्यांगण|Narrative|आख्यान/.test(c)) && !isEssay(p);
const mr = posts.filter((p) => dev(p.title));
const en = posts.filter((p) => !dev(p.title));
const pair = (p) => en.filter((e) => e.author === p.author && Math.abs(Date.parse(day(e)) - Date.parse(day(p))) <= 86400_000 * 2)
  .sort((a, b) => Math.abs(a.words - p.words) - Math.abs(b.words - p.words))[0];
const shape = (p) => { const s = split(p.title), e = pair(p); return { id: p.id, ...s, rawTitle: p.title, author: p.author, date: day(p), link: p.link, categories: p.categories, words: p.words, excerpt: p.excerpt,
  english: e && { title: split(e.title).title, excerpt: e.excerpt, link: e.link } }; };
// issue contents pages (found by hand in the first look) are not essays
const CONTENTS = new Set([11003, 10083, 9953, 9949]);
const main = mr.filter((p) => isEssay(p) && p.words >= 600 && !CONTENTS.has(p.id)).map(shape);
const contents = mr.filter((p) => CONTENTS.has(p.id)).map(shape);
const maybe = mr.filter((p) => other(p) && p.words >= 1000).map(shape);
fs.writeFileSync(`${dir}/candidates.json`, JSON.stringify({ main, maybe, contents }, null, 1));
console.log(`contents pages left out: ${contents.length}`);
console.log(`Marathi posts ${mr.length}; essays/editorials >=600 words: ${main.length}; other long Marathi pieces (maybe): ${maybe.length}; short essays skipped: ${mr.filter((p) => isEssay(p) && p.words < 600).length}`);
console.log(`with an English twin: ${main.filter((m) => m.english).length}/${main.length}`);
