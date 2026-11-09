// Makes private/catalogues/hakara/review.html for Sarthak: the final Hakara essays and stories as they will show on the site, and every change
// made after his first review (what was removed, which authors and translators changed, which titles and gists changed, which gists are now empty).
// Reads src/data/hakara.json and hakara-stories.json (scripts/hakara/build.mjs) and the first review's data (candidates-v1.json, drafts-v1.json).
//   node scripts/hakara/review.mjs
import fs from 'node:fs';
const dir = 'private/catalogues/hakara';
const read = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const cand = read(`${dir}/candidates-v1.json`), drafts = new Map(read(`${dir}/drafts-v1.json`).map((d) => [d.id, d]));
const essays = read('src/data/hakara.json').items, stories = read('src/data/hakara-stories.json').items;
const oldMain = new Map(cand.main.map((m, i) => [m.link, { ...m, n: i + 1 }]));
const oldStory = new Map(cand.maybe.map((m, i) => [m.link, { ...m, n: i + 1 }]));
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const a = (e) => `<a href="${esc(e.link)}" target="_blank" rel="noopener">${esc(e.title)}</a>`;
const credit = (e) => [esc(e.author), e.with ? `<span class="sub">${esc(e.with)}</span>` : '', e.translator ? `<span class="sub">translated by ${esc(e.translator)}</span>` : ''].filter(Boolean).join('<br>');
const keptLinks = new Set(essays.map((e) => e.link));
const removed = cand.main.map((m, i) => ({ ...m, n: i + 1 })).filter((m) => !keptLinks.has(m.link));
const why = { 1: 'English version of #6; the Marathi post (#6) stays, with its Marathi title', 30: 'an English-language conversation (Shanta Gokhale), not a Marathi piece', 48: 'not an essay (Call 10 page)', 53: 'a poem', 55: 'a poem' };
const changedCredit = essays.map((e) => ({ e, o: oldMain.get(e.link) })).filter(({ e, o }) => o && (e.translator || e.with || e.author !== o.author));
const changedTitle = essays.map((e) => ({ e, o: oldMain.get(e.link) })).filter(({ e, o }) => o && e.title !== o.title);
const gistRows = essays.map((e) => ({ e, o: oldMain.get(e.link) })).filter(({ e, o }) => o && drafts.get(o.id)?.gist !== e.note);
const emptyE = essays.filter((e) => !e.note), emptyS = stories.filter((e) => !e.note);
const th = (cells) => `<tr>${cells.map((c) => `<th>${c}</th>`).join('')}</tr>`;
const td = (cells) => `<tr>${cells.map((c) => `<td>${c}</td>`).join('')}</tr>`;
const table = (head, rows) => `<table><thead>${th(head)}</thead><tbody>${rows.join('\n')}</tbody></table>`;
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Hakara: review 2</title><meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{font:15px/1.5 system-ui,sans-serif;margin:24px auto;max-width:1250px;padding:0 16px;color:#1f1c18;background:#f7ecdc}h1{font-size:26px}h2{margin-top:38px}
table{border-collapse:collapse;width:100%;background:#fcf5e8;margin-top:8px}th,td{border:1px solid #dcc9ac;padding:7px 9px;vertical-align:top;text-align:left}th{background:#efe0c9}
.sub{display:block;font-size:12.5px;color:#4a443d}.nw{white-space:nowrap}a{color:#0f6a66}.none{color:#9a4b00}.old{color:#7a7266;text-decoration:line-through}.note{max-width:80ch;color:#4a443d}</style></head><body>
<h1>Hakara: review of the changes</h1>
<p class="note"><b>${essays.length} essays</b>, <b>${stories.length} stories</b>. Gists left empty (the card then shows just "Hakara" and the year): ${emptyE.length} essays, ${emptyS.length} stories. Numbers like #12 are the row numbers of the first review page (essays and stories counted separately).</p>

<h2>Essays removed (${removed.length})</h2>
${table(['#', 'Title', 'Why'], removed.map((m) => td([m.n, `<a href="${esc(m.link)}" target="_blank" rel="noopener">${esc(m.title)}</a>`, esc(why[m.n] ?? '')])))}

<h2>Essays: authors and translators (${changedCredit.length} rows changed)</h2>
<p class="note">The original writer is now the author; the translator shows apart ("translated by"). Before = who the website had posted it as.</p>
${table(['#', 'Title', 'Before', 'Author now', 'Translator', 'Other credit'], changedCredit.map(({ e, o }) => td([o.n, a(e), `<span class="old">${esc(o.author)}</span>`, esc(e.author), esc(e.translator ?? ''), esc(e.with ?? '')])))}

<h2>Essays: titles cleaned (${changedTitle.length})</h2>
${table(['#', 'Before', 'Now'], changedTitle.map(({ e, o }) => td([o.n, `<span class="old">${esc(o.title)}</span>`, a(e)])))}

<h2>Essays: gists rewritten or emptied (${gistRows.length})</h2>
<p class="note">No gist starts with "Reflection on" or "Editorial on" any more, none mentions how it was made, and the 7 thin ones have none.</p>
${table(['#', 'Title', 'Before', 'Now'], gistRows.map(({ e, o }) => td([o.n, a(e), `<span class="old">${esc(drafts.get(o.id)?.gist)}</span>`, e.note ? esc(e.note) : '<span class="none">no gist (Hakara and the year)</span>'])))}

<h2>All essays as they will show (${essays.length})</h2>
${table(['Title', 'Author', 'Year', 'Theme', 'Gist'], essays.map((e) => td([`${a(e)}<span class="sub">${esc(e.roman)}</span>`, credit(e), e.year, esc(e.theme ?? ''), e.note ? esc(e.note) : '<span class="none">no gist</span>'])))}

<h2>New: Stories from Hakara (${stories.length})</h2>
<p class="note">From the long Narrative / आख्यान and Panorama / दृश्यांगण pieces. The two English versions of Marathi pieces (#9 Touch and #59 A Tale of the Fallen Spoon) are left out. Gists say only the setup or subject, never an ending. Themes only where obvious. #53's Marathi translation came from Philip Gabriel's English translation of Murakami's Japanese story.</p>
${table(['#', 'Title', 'Author', 'Year', 'Theme', 'Gist'], stories.map((e) => td([oldStory.get(e.link)?.n ?? '', `${a(e)}<span class="sub">${esc(e.roman)}</span>`, credit(e), e.year, esc(e.theme ?? ''), e.note ? esc(e.note) : '<span class="none">no gist</span>'])))}
</body></html>`;
fs.writeFileSync(`${dir}/review.html`, html);
console.log(`review.html: ${essays.length} essays, ${stories.length} stories; removed ${removed.length}; credits changed ${changedCredit.length}; titles ${changedTitle.length}; gists ${gistRows.length}; empty gists ${emptyE.length} + ${emptyS.length}`);
