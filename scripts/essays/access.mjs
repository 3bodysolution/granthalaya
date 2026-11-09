// Marks each essay link as free, paywalled or unknown, from what its own page says (schema.org: isAccessibleForFree, on the article or
// on a hasPart part). Never guessed: a page that says nothing, or that can't be fetched, is "unknown". Sites with no paywall at all
// (NO_PAYWALL below, each one a site where everything is open) count as free when the page itself says nothing.
// The answer is an internal field (src/data/essay-access.json); the site uses it only to order essays, never to label them.
//
//   node scripts/essays/access.mjs                 checks every New Yorker article (private/catalogues/tetw-new-yorker/list.json)
//                                                  and every essay in src/data/essays.json, skipping links checked in the last 30 days
//   --force            check everything again     --only=newyorker|ours      one group     --limit=N    stop after N fetches
// Gentle: one request at a time, 1.5 s apart, a plain user agent, no tricks. A page that refuses (403 and so on) stays unknown.
import fs from 'node:fs';
const OUT = 'src/data/essay-access.json';
const args = process.argv.slice(2);
const flag = (f) => args.includes(f);
const val = (k) => args.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const only = val('only'), limit = Number(val('limit')) || Infinity, force = flag('--force');
const UA = 'Granthalaya/1.0 (+https://mygranthalaya.vercel.app; essay access check)';
const MONTH = 30 * 86400_000;
const PAUSE = 1500;

// Sites where every page is open to read (checked by hand; add a site here only when it has no paywall or meter).
const NO_PAYWALL = new Set([
  'paulgraham.com', 'en.wikisource.org', 'hi.wikisource.org', 'gutenberg.org', 'www.gutenberg.org', 'waitbutwhy.com', 'www.pbs.org',
  'en.wikipedia.org', 'archive.org', 'www.marxists.org', 'www.orwellfoundation.com', 'ribbonfarm.com', 'www.poetryfoundation.org', 'slatestarcodex.com',
  'stripe.com', 'www.cs.virginia.edu', 'www.cs.cmu.edu', 'www.catb.org', 'www.dreamsongs.com', 'kk.org', 'gutenberg.net.au', 'teachingamericanhistory.org',
  'calteches.library.caltech.edu', 'users.drew.edu', 'www.africa.upenn.edu', 'www.maa.org', 'hakara.in',
]);

const ours = JSON.parse(fs.readFileSync('src/data/essays.json', 'utf8')).themes.flatMap((t) => t.items.map((e) => e.link));
let ny = [];
try { ny = JSON.parse(fs.readFileSync('private/catalogues/tetw-new-yorker/list.json', 'utf8')).map((x) => x.url); } catch { /* none yet */ }
const hk = JSON.parse(fs.readFileSync('src/data/hakara.json', 'utf8')).items.map((e) => e.link);   // Hakara's Marathi essays
const wanted = [...new Set([...(only === 'ours' || only === 'hakara' ? [] : ny), ...(only === 'newyorker' || only === 'hakara' ? [] : ours), ...(only && only !== 'hakara' ? [] : hk)])];
const known = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : {};
const today = new Date().toISOString().slice(0, 10);

const truth = (v) => (v === true || /^true$/i.test(String(v)) ? true : v === false || /^false$/i.test(String(v)) ? false : null);
/** what the page's schema.org data says: true (free), false (paywalled) or null (nothing said) */
function accessOf(html) {
  const nodes = [];
  const walk = (o) => { if (Array.isArray(o)) o.forEach(walk); else if (o && typeof o === 'object') { nodes.push(o); Object.values(o).forEach(walk); } };
  for (const m of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) { try { walk(JSON.parse(m[1])); } catch { /* skip a block that isn't JSON */ } }
  const article = /Article|WebPage|CreativeWork|BlogPosting/;
  const top = nodes.filter((n) => 'isAccessibleForFree' in n && article.test([].concat(n['@type'] ?? []).join(' ')));
  const a = top.map((n) => truth(n.isAccessibleForFree)).find((v) => v !== null);
  if (a != null) return a;
  const parts = nodes.filter((n) => 'isAccessibleForFree' in n).map((n) => truth(n.isAccessibleForFree)).filter((v) => v !== null);   // hasPart
  if (parts.includes(false)) return false;
  return parts.includes(true) ? true : null;
}

{
  const todo = wanted.filter((u) => force || !known[u] || Date.now() - Date.parse(known[u].checked) > MONTH).slice(0, limit);
  console.log(`${wanted.length} links, ${todo.length} to check`);
  let n = 0;
  for (const url of todo) {
    let access = 'unknown', how = 'page says nothing', status = '';
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html' }, redirect: 'follow', signal: AbortSignal.timeout(20000) });
      status = String(r.status);
      if (!r.ok) how = `HTTP ${r.status}`;
      else {
        const html = (await r.text()).slice(0, 3_000_000);
        const a = accessOf(html);
        if (a === true) { access = 'free'; how = 'schema'; }
        else if (a === false) { access = 'paywalled'; how = 'schema'; }
        else if (NO_PAYWALL.has(new URL(url).hostname)) { access = 'free'; how = 'site has no paywall'; }
      }
    } catch (e) { how = `could not fetch (${e.name})`; }
    if (access === 'unknown' && NO_PAYWALL.has(new URL(url).hostname)) { access = 'free'; how = 'site has no paywall'; }
    known[url] = { access, how, checked: today };
    n++;
    console.log(`${String(n).padStart(3)} ${access.padEnd(9)} ${how.padEnd(22)} ${url}`);
    if (n % 10 === 0) fs.writeFileSync(OUT, JSON.stringify(known, null, 1));
    await new Promise((r) => setTimeout(r, PAUSE));
  }
  fs.writeFileSync(OUT, JSON.stringify(known, null, 1));
  const c = { free: 0, paywalled: 0, unknown: 0 };
  for (const u of wanted) c[known[u]?.access ?? 'unknown']++;
  console.log(`\nfree ${c.free}, paywalled ${c.paywalled}, unknown ${c.unknown}`);
}
