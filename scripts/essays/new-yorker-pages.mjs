// Reads each New Yorker article's own page once (gently: one request at a time, 1.5 s apart, a plain user agent) and saves what its
// schema.org data says: the headline and the ORIGINAL publication date (datePublished, never dateModified). Saved to
// private/catalogues/tetw-new-yorker/pages.json; scripts/essays/new-yorker.mjs uses it for titles and for years the link doesn't carry.
//   node scripts/essays/new-yorker-pages.mjs          (links already in pages.json are skipped; --force to read them all again)
import fs from 'node:fs';
const dir = 'private/catalogues/tetw-new-yorker';
const list = JSON.parse(fs.readFileSync(`${dir}/list.json`, 'utf8'));
const out = fs.existsSync(`${dir}/pages.json`) ? JSON.parse(fs.readFileSync(`${dir}/pages.json`, 'utf8')) : {};
const UA = 'Granthalaya/1.0 (+https://mygranthalaya.vercel.app; essay access check)';
let n = 0;
for (const x of list) {
  if (out[x.url] && !process.argv.includes('--force')) continue;
  let rec = { error: 'not read' };
  try {
    const r = await fetch(x.url, { headers: { 'User-Agent': UA, Accept: 'text/html' }, redirect: 'follow', signal: AbortSignal.timeout(20000) });
    if (!r.ok) rec = { error: `HTTP ${r.status}` };
    else {
      const html = await r.text();
      const nodes = [];
      const walk = (o) => { if (Array.isArray(o)) o.forEach(walk); else if (o && typeof o === 'object') { nodes.push(o); Object.values(o).forEach(walk); } };
      for (const m of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) { try { walk(JSON.parse(m[1])); } catch { /* not JSON */ } }
      const art = nodes.find((o) => /Article/.test([].concat(o['@type'] ?? []).join(' ')) && o.headline);
      rec = { final: r.url, headline: art?.headline?.replace(/\s+/g, ' ').trim() ?? null, datePublished: art?.datePublished ?? null };
    }
  } catch (e) { rec = { error: `could not fetch (${e.name})` }; }
  out[x.url] = rec;
  n++;
  console.log(String(n).padStart(3), rec.error ?? `${rec.datePublished?.slice(0, 10) ?? 'no date'}  ${rec.headline}`);
  fs.writeFileSync(`${dir}/pages.json`, JSON.stringify(out, null, 1));
  await new Promise((r) => setTimeout(r, 1500));
}
console.log('done');
