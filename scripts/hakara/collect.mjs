// Collects Hakara's (hakara.in) articles for the Essays section, with their permission. Hakara runs WordPress, so this reads its public
// REST API (the same data as its pages and sitemap; robots.txt allows everything) gently: 100 posts a request, 2 seconds apart, a
// plain user agent. If any request meets a bot check or is refused, it stops and says so.
//   node scripts/hakara/collect.mjs
// Saves private/catalogues/hakara/posts.json: id, title, author, date, link, categories, words (length of the text), excerpt.
import fs from 'node:fs';
const dir = 'private/catalogues/hakara';
const UA = "Granthalaya/1.0 (+https://mygranthalaya.vercel.app; essay list, with Hakara's permission)";
const get = async (path) => {
  const r = await fetch(`https://hakara.in/wp-json/wp/v2/${path}`, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(60000) });
  const type = r.headers.get('content-type') ?? '';
  if (!r.ok || !type.includes('json')) throw new Error(`stopped: ${path} answered ${r.status} (${type || 'no type'}); not going further`);
  await new Promise((s) => setTimeout(s, 2000));
  return { data: await r.json(), pages: Number(r.headers.get('x-wp-totalpages') ?? 1), total: Number(r.headers.get('x-wp-total') ?? 0) };
};
const plain = (h) => h.replace(/<[^>]+>/g, ' ').replace(/&#8217;|&rsquo;/g, '’').replace(/&#8211;|&ndash;/g, '–').replace(/&amp;/g, '&').replace(/&nbsp;|&#160;/g, ' ').replace(/&hellip;|&#8230;/g, '…').replace(/&#\d+;/g, ' ').replace(/\s+/g, ' ').trim();

const cats = {};
for (let p = 1; ; p++) {
  const { data, pages } = await get(`categories?per_page=100&page=${p}&_fields=id,name,slug,count,parent`);
  data.forEach((c) => { cats[c.id] = c; });
  if (p >= pages) break;
}
const users = {};
for (let p = 1; ; p++) {
  const { data, pages } = await get(`users?per_page=100&page=${p}&_fields=id,name`).catch(() => ({ data: [], pages: 0 }));
  data.forEach((u) => { users[u.id] = u.name; });
  if (p >= pages) break;
}
const posts = [];
for (let p = 1; ; p++) {
  const { data, pages, total } = await get(`posts?per_page=100&page=${p}&_fields=id,date,link,title,author,categories,excerpt,content,type,status`);
  for (const x of data) {
    const text = plain(x.content?.rendered ?? '');
    posts.push({
      id: x.id, title: plain(x.title?.rendered ?? ''), author: users[x.author] ?? `author ${x.author}`, date: x.date, link: x.link,
      categories: x.categories.map((c) => cats[c]?.name ?? String(c)), words: text.split(' ').filter(Boolean).length,
      excerpt: plain(x.excerpt?.rendered ?? '').slice(0, 300),
    });
  }
  console.log(`page ${p}/${pages}: ${posts.length}/${total}`);
  if (p >= pages) break;
}
fs.writeFileSync(`${dir}/posts.json`, JSON.stringify(posts, null, 1));
fs.writeFileSync(`${dir}/categories.json`, JSON.stringify(Object.values(cats), null, 1));
console.log(`saved ${posts.length} posts, ${Object.keys(cats).length} categories`);
