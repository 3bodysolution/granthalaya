// Builds src/data/new-yorker.json (the "Best of The New Yorker" collection) from private/catalogues/tetw-new-yorker/list.json, which
// scripts/essays/tetw-parse.mjs made from the Electric Typewriter's page. Order is the page's order. No gist is written for a card:
// the site shows "The New Yorker" and the year. A theme is set only where the title makes it obvious (THEMES below, by hand).
//   node scripts/essays/new-yorker.mjs
import fs from 'node:fs';
const list = JSON.parse(fs.readFileSync('private/catalogues/tetw-new-yorker/list.json', 'utf8'));
const ours = JSON.parse(fs.readFileSync('src/data/essays.json', 'utf8')).themes.flatMap((t) => t.items);
// themes of our own essays (Writing, Nature, Work, Freedom, India, Fiction): only where the title itself makes it obvious
const THEMES = {
  'The Art of the Impersonal Essay': 'Writing',
  'Silent Spring': 'Nature', 'The Climate of Man': 'Nature', 'The Stolen Forests': 'Nature', 'Where Do Eels Come From?': 'Nature',
  'The Long Flight to Teach an Endangered Ibis Species to Migrate': 'Nature', 'Atchafalaya': 'Nature',
  'Is Venture Capital Worth the Risk?': 'Work',
  'We Are Sleepwalking Into Autocracy': 'Freedom',
  'Blood and Soil in Narendra Modi’s India': 'India',
};
// what each article's own page says (scripts/essays/new-yorker-pages.mjs): its headline, and its original publication date
const pages = fs.existsSync('private/catalogues/tetw-new-yorker/pages.json') ? JSON.parse(fs.readFileSync('private/catalogues/tetw-new-yorker/pages.json', 'utf8')) : {};
const changed = [], kept = [], dated = [];
const slug = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const byName = new Map(ours.map((e) => [e.author, e]));
const items = list.map((x) => {
  const page = pages[x.url];
  const own = page?.headline?.trim();
  // The article's own headline wins where ours differs only in capitals, punctuation or word order. Where the web headline is a different
  // title altogether (the magazine's title was rewritten for the web, or "..., by Author" was added), the list's title stays.
  const words = (t) => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter(Boolean).sort().join(' ');
  const same = own && words(own) === words(x.title) && own !== own.toUpperCase();
  const title = same ? own : x.title.trim();
  if (same && own !== x.title.trim()) changed.push(`${x.title.trim()}  ->  ${own}`);
  else if (own && !same && own !== x.title.trim()) kept.push(`${x.title.trim()}   (page says: ${own})`);
  let year = x.year;
  if (year == null && page?.datePublished) { year = Number(page.datePublished.slice(0, 4)) || null; if (year) dated.push(`${title}: ${year}`); }
  const known = byName.get(x.author);   // an author we already have keeps their page
  return {
    title, author: x.author, authorKey: known?.authorKey ?? null, authorSlug: known?.authorSlug ?? slug(x.author),
    publication: 'The New Yorker', year, link: x.url, note: null, ...(THEMES[x.title.trim()] ? { theme: THEMES[x.title.trim()] } : {}),
  };
});
const show = (label, rows) => rows.length && console.log([`${label} (${rows.length}):`, ...rows.map((r) => `  ${r}`)].join('\n'));
show("titles changed to the article's own headline", changed);
show('kept as listed although the page headline differs', kept);
show('years filled from datePublished', dated);
const unused = Object.keys(THEMES).filter((t) => !list.some((x) => x.title.trim() === t));
if (unused.length) console.log('theme names that matched no title:', unused);
const data = { name: 'Best of The New Yorker', curator: { name: 'The Electric Typewriter', url: 'https://tetw.org/' }, items };
fs.writeFileSync('src/data/new-yorker.json', JSON.stringify(data, null, 2) + '\n');
console.log(`${items.length} articles, ${items.filter((i) => i.theme).length} with a theme, ${items.filter((i) => i.year == null).length} with no year`);
