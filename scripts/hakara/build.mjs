// Builds src/data/hakara.json (the Marathi essays from Hakara, listed with their permission) from the reviewed list:
// private/catalogues/hakara/candidates.json (scripts/hakara/select.mjs) and drafts.json (themes, one-line gists, Roman titles).
// Newest first. Each opens at hakara.in. The gist is the card's one line; `roman` is only for search.
//   node scripts/hakara/build.mjs
import fs from 'node:fs';
const dir = 'private/catalogues/hakara';
const { main } = JSON.parse(fs.readFileSync(`${dir}/candidates.json`, 'utf8'));
const drafts = new Map(JSON.parse(fs.readFileSync(`${dir}/drafts.json`, 'utf8')).map((d) => [d.id, d]));
const latin = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
// authors with no Latin letters in their name still get a stable page address
const hash = (s) => { let n = 0; for (const c of s) n = (n * 31 + c.codePointAt(0)) >>> 0; return n.toString(36); };
const slug = (name) => latin(name) || `h-${hash(name)}`;
const items = main.filter((m) => drafts.has(m.id)).sort((a, b) => b.date.localeCompare(a.date) || a.id - b.id).map((m) => {
  const d = drafts.get(m.id);
  return {
    title: m.title, author: m.author, authorKey: null, authorSlug: slug(m.author), publication: 'Hakara', year: Number(m.date.slice(0, 4)),
    link: m.link, note: d.gist, language: 'mr', theme: d.theme, roman: d.roman,
  };
});
const data = { name: 'From Hakara', credit: { name: 'Hakara', url: 'https://hakara.in/' }, items };
fs.writeFileSync('src/data/hakara.json', JSON.stringify(data, null, 2) + '\n');
const themes = {};
for (const i of items) themes[i.theme] = (themes[i.theme] ?? 0) + 1;
console.log(`${items.length} essays`, themes);
