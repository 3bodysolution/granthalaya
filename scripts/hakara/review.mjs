// Makes private/catalogues/hakara/review.html: every piece with its title, author, date, link, theme and gist, for Sarthak to check.
// Reads candidates.json (scripts/hakara/select.mjs) and drafts.json (themes, gists and Roman titles). Nothing is saved to the site.
//   node scripts/hakara/review.mjs
import fs from 'node:fs';
const dir = 'private/catalogues/hakara';
const { main, maybe, contents } = JSON.parse(fs.readFileSync(`${dir}/candidates.json`, 'utf8'));
const drafts = new Map(JSON.parse(fs.readFileSync(`${dir}/drafts.json`, 'utf8')).map((d) => [d.id, d]));
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const OLD = new Set(['Writing', 'Nature', 'Work', 'Freedom', 'India', 'Fiction']);
const rows = main.map((m) => ({ ...m, d: drafts.get(m.id) })).filter((m) => m.d);
const missing = main.filter((m) => !drafts.has(m.id));
const counts = {};
for (const r of rows) counts[r.d.theme] = (counts[r.d.theme] ?? 0) + 1;
const who = (m) => [esc(m.author), m.by && m.by !== m.author ? `<span class="sub">${esc(m.by)}</span>` : '', m.translator ? `<span class="sub">translated by ${esc(m.translator)}</span>` : ''].filter(Boolean).join('<br>');
const tr = (m, i) => `<tr class="${m.d.confidence === 'low' ? 'low' : ''}" data-theme="${esc(m.d.theme)}"><td class="n">${i + 1}</td>
<td><a href="${esc(m.link)}" target="_blank" rel="noopener">${esc(m.title)}</a><span class="sub">${esc(m.d.roman)}</span></td><td>${who(m)}</td><td class="nw">${esc(m.date)}</td>
<td><span class="tag ${OLD.has(m.d.theme) ? '' : 'new'}">${esc(m.d.theme)}</span></td><td>${esc(m.d.gist)}${m.d.confidence === 'low' ? ' <b class="flag">thin text: check</b>' : ''}</td></tr>`;
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Hakara essays: review</title><meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{font:15px/1.5 system-ui,sans-serif;margin:24px auto;max-width:1200px;padding:0 16px;color:#1f1c18;background:#f7ecdc}h1{font-size:26px}h2{margin-top:36px}
table{border-collapse:collapse;width:100%;background:#fcf5e8}th,td{border:1px solid #dcc9ac;padding:7px 9px;vertical-align:top;text-align:left}th{background:#efe0c9;position:sticky;top:0}
.sub{display:block;font-size:12.5px;color:#4a443d}.nw{white-space:nowrap}.n{color:#4a443d;text-align:right}.tag{background:#efe0c9;border-radius:999px;padding:2px 10px;font-size:13px;white-space:nowrap}.tag.new{background:#0f6a66;color:#fff}
tr.low{background:#fff1d6}.flag{color:#9a4b00;font-size:12px}a{color:#0f6a66}.chips button{margin:2px;padding:4px 10px;border-radius:999px;border:1px solid #dcc9ac;background:#fcf5e8;cursor:pointer;font:inherit}
.chips button.on{background:#1f1c18;color:#fff}.note{max-width:75ch;color:#4a443d}</style></head><body>
<h1>Hakara essays: review</h1>
<p class="note">${rows.length} Marathi essays and editorials of 600 words or more from hakara.in (categories Reflection / परामर्श and Editorial / संपादकीय), read through their public WordPress API. Gists are drafted from each title and the opening of the piece, so a few are modest; rows on a yellow background had too little text and need your eye. Dark-teal themes are new (existing themes: ${[...OLD].join(', ')}). Nothing is saved to the site yet.</p>
<div class="chips" id="chips"><button class="on" data-t="">All ${rows.length}</button>${Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([t, n]) => `<button data-t="${esc(t)}">${esc(t)} ${n}</button>`).join('')}</div>
<table id="main"><thead><tr><th>#</th><th>Title (Devanagari, as written) and Roman form</th><th>Author</th><th>Date</th><th>Theme</th><th>One-line gist</th></tr></thead><tbody>${rows.map(tr).join('\n')}</tbody></table>
${missing.length ? `<p>No draft for: ${missing.map((m) => esc(m.title)).join('; ')}</p>` : ''}
<h2>Left out: issue contents pages (${contents.length})</h2><ul>${contents.map((m) => `<li><a href="${esc(m.link)}" target="_blank" rel="noopener">${esc(m.title)}</a> (${esc(m.date)})</li>`).join('')}</ul>
<h2>Long Marathi pieces in other categories: your call (${maybe.length})</h2>
<p class="note">Stories (Narrative / आख्यान) and visual pieces (Panorama / दृश्यांगण) of 1000 words or more. They are not essays by Hakara's own sections, so they are not in the list above and have no gists. Tell me if any kinds should join.</p>
<table><thead><tr><th>#</th><th>Title</th><th>Author</th><th>Date</th><th>Section</th><th>Words</th></tr></thead><tbody>${maybe.map((m, i) => `<tr><td class="n">${i + 1}</td><td><a href="${esc(m.link)}" target="_blank" rel="noopener">${esc(m.title)}</a></td><td>${who(m)}</td><td class="nw">${esc(m.date)}</td><td>${esc(m.categories.filter((c) => /Panorama|दृश्यांगण|Narrative|आख्यान/.test(c)).join(', '))}</td><td class="n">${m.words}</td></tr>`).join('\n')}</tbody></table>
<script>const b=[...document.querySelectorAll('#chips button')];b.forEach(x=>x.onclick=()=>{b.forEach(y=>y.classList.toggle('on',y===x));document.querySelectorAll('#main tbody tr').forEach(r=>r.hidden=x.dataset.t&&r.dataset.theme!==x.dataset.t)})</script></body></html>`;
fs.writeFileSync(`${dir}/review.html`, html);
console.log(`review.html: ${rows.length} pieces, ${missing.length} without a draft, themes:`, counts);
