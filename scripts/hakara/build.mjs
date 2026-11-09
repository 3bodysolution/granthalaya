// Builds the Hakara data for the site from the reviewed lists:
//   src/data/hakara.json          the Marathi essays (From Hakara)
//   src/data/hakara-stories.json  the stories and long pieces (Stories from Hakara; every card says Story)
// Inputs (private/catalogues/hakara/): candidates-v1.json (link and date of every post, from scripts/hakara/select.mjs), essays-v2.json and
// stories-v2.json (cleaned title, original writer, translator, theme, Roman title and one-line gist, written after Sarthak's review; a gist
// is null where the text was too thin, and the card then shows "Hakara" and the year). Newest first; each opens at hakara.in.
//   node scripts/hakara/build.mjs
import fs from 'node:fs';
const dir = 'private/catalogues/hakara';
const read = (f) => JSON.parse(fs.readFileSync(`${dir}/${f}`, 'utf8'));
const cand = read('candidates-v1.json');
const byId = new Map([...cand.main, ...cand.maybe].map((m) => [m.id, m]));
const latin = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const hash = (s) => { let n = 0; for (const c of s) n = (n * 31 + c.codePointAt(0)) >>> 0; return n.toString(36); };
const slug = (name) => latin(name) || `h-${hash(name)}`;   // a name with no Latin letters still gets a stable page address

// essay #6 is the Marathi post of the editorial whose English version is #1: the Marathi one stays (with its Marathi title), the English one goes
const SIX = { id: byId.size && cand.main[5].id, n: 6, title: 'हाकारा । hākārā : संवादी मुक्तावकाश', writer: 'Ashutosh Potdar', translator: null, with: null, theme: 'Writing',
  roman: 'hakara hakara samvadi muktavakash', gist: 'What a literary magazine is, starting from the society and reading culture it is published in.' };

const make = (d, extra = {}) => {
  const m = byId.get(d.id);
  if (!m) throw new Error(`no post ${d.id}`);
  return {
    title: d.title.trim(), author: d.writer.trim(), authorKey: null, authorSlug: slug(d.writer), publication: 'Hakara', year: Number(m.date.slice(0, 4)),
    link: m.link, note: d.gist ? d.gist.trim() : null, language: 'mr', ...(d.theme ? { theme: d.theme } : {}), roman: d.roman,
    ...(d.translator ? { translator: d.translator } : {}), ...(d.with ? { with: d.with } : {}), ...extra, _date: m.date, _id: m.id,
  };
};
const newestFirst = (a, b) => b._date.localeCompare(a._date) || a._id - b._id;
const strip = ({ _date, _id, ...rest }) => rest;

const essays = [...read('essays-v2.json'), SIX].map((d) => make(d)).sort(newestFirst).map(strip);
const stories = read('stories-v2.json').map((d) => make(d, { kind: 'story' })).sort(newestFirst).map(strip);
const credit = { name: 'Hakara', url: 'https://hakara.in/' };
fs.writeFileSync('src/data/hakara.json', JSON.stringify({ name: 'From Hakara', credit, items: essays }, null, 2) + '\n');
fs.writeFileSync('src/data/hakara-stories.json', JSON.stringify({ name: 'Stories from Hakara', credit, items: stories }, null, 2) + '\n');
const count = (a, f) => a.filter(f).length;
console.log(`essays ${essays.length} (no gist ${count(essays, (e) => !e.note)}, translated ${count(essays, (e) => e.translator)}), stories ${stories.length} (no gist ${count(stories, (e) => !e.note)}, translated ${count(stories, (e) => e.translator)}, with a theme ${count(stories, (e) => e.theme)})`);
