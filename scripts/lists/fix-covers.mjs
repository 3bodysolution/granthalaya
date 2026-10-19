// Finds list books whose cover is from an edition in another language (a German "Prophet Song") and swaps it
// for a cover from an edition in the book's own language (English unless the item says otherwise).
//   node scripts/lists/fix-covers.mjs          report only
//   node scripts/lists/fix-covers.mjs --write  change the list files
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';

const write = process.argv.includes('--write');
const dir = new URL('../../src/data/lists/', import.meta.url);
const fold = (s) => (s ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/^(the|a|an) /, '').replace(/[^a-z0-9]+/g, ' ').trim();
const lang3 = { en: 'eng', hi: 'hin', mr: 'mar', de: 'ger', fr: 'fre', es: 'spa', ru: 'rus', it: 'ita', ja: 'jpn', pt: 'por' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function editions(ol) {
  const out = [];
  for (let offset = 0; offset < 600; offset += 200) {
    let j = null;
    for (let t = 0; t < 3 && !j; t++) {
      try {
        const r = await fetch(`https://openlibrary.org/works/${ol}/editions.json?limit=200&offset=${offset}`, { headers: { 'User-Agent': 'Granthalaya/1.0 (cover check)' }, signal: AbortSignal.timeout(20000) });
        if (r.ok) j = await r.json(); else await sleep(1500);
      } catch { await sleep(1500); }
    }
    if (!j) break;
    out.push(...(j.entries ?? []));
    if (out.length >= (j.size ?? 0)) break;
  }
  return out;
}

const report = [];
for (const f of readdirSync(dir).filter((x) => x.endsWith('.json'))) {
  const path = new URL(f, dir);
  const list = JSON.parse(readFileSync(path, 'utf8'));
  if (list.kind !== 'book') continue;
  let changed = false;
  for (const it of list.items) {
    const m = it.cover?.match(/\/b\/id\/(\d+)-L/);
    if (!it.ol || !m) continue;
    const id = +m[1];
    const want = lang3[it.language ?? 'en'] ?? it.language ?? 'eng';
    const eds = await editions(it.ol); await sleep(250);
    const names = [fold(it.title), fold(it.original_title)].filter(Boolean);
    const lang = (e) => (e.languages ?? []).map((l) => l.key.replace('/languages/', ''));
    // an edition is fine if it is in English or the book's own language; one with no language tag must carry the book's title
    const same = (e) => names.some((n) => n && (fold(e.title).includes(n) || n.includes(fold(e.title))));
    const ok = (e) => (lang(e).length ? lang(e).some((l) => l === want || l === 'eng') : same(e));
    const good = (e) => e.covers?.some((c) => c > 0) && ok(e);
    const mine = eds.find((e) => e.covers?.includes(id));
    if (!mine) { report.push(`? ${f} ${it.year} ${it.title}: cover ${id} is not one of the first editions, left alone`); continue; }
    if (ok(mine)) continue;
    const better = eds.filter(good).sort((a, b) => (same(b) - same(a)) || (lang(b).includes('eng') - lang(a).includes('eng')) || String(b.publish_date).localeCompare(String(a.publish_date)))[0];
    report.push(`${better ? 'FIX' : 'NONE'} ${f} ${it.year} ${it.title}: ${lang(mine).join(',') || 'no language'} "${mine.title}"${better ? ` -> ${better.covers.find((c) => c > 0)} (${lang(better).join(',') || 'untagged'})` : ' (no English or own-language edition has a cover)'}`);
    if (better && write) { it.cover = `https://covers.openlibrary.org/b/id/${better.covers.find((c) => c > 0)}-L.jpg`; changed = true; }
  }
  if (changed) writeFileSync(path, JSON.stringify(list, null, 2) + '\n');
}
console.log(report.join('\n') || 'no mismatches');
console.log(`${report.filter((x) => x.startsWith('FIX')).length} to fix, ${report.filter((x) => x.startsWith('NONE')).length} with no alternative, ${report.filter((x) => x.startsWith('?')).length} unchecked`);
