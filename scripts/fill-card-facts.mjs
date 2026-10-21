// Writes the share card line (`titles.tagline`) and painting (`titles.card_bg`) for every title already in the catalogue, the same way
// the site does for a new title: TMDB's tagline when it has one, otherwise a short line from a free AI model; the painting is
// picked by the same AI call from the summary, genres and setting. Only empty fields are filled; nothing already there is replaced.
//
//   node scripts/fill-card-facts.mjs                dry run: counts the titles it would change, asks no AI, writes nothing
//   node scripts/fill-card-facts.mjs --write        does it (only when Sarthak asks for it in that message)
//   --limit=N                                       stops after N titles (a free AI allowance is limited; run it again to carry on)
//   --repick=slug,slug                              picks the painting again for those titles (replaces the saved one; with --write)
//
// Where the words come from:
//   · a real summary (TMDB, Open Library): TMDB's tagline, else a short AI line from it; the AI picks the painting;
//   · no summary but a note (a record made from one of our lists, src/data/lists): the note is the line, exactly as written (no AI);
//     the AI picks the painting from the note;
//   · neither: nothing is written (the genre rules choose the painting when a card is drawn, and there is no line).
//
// Needs PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY, TMDB_API_KEY and an AI key in .env. Nothing from .env is printed.
import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { askFacts } from '../src/lib/cards/facts-ai.mjs';

try {
  for (const line of fs.readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*"?([^"#]*?)"?\s*(#.*)?$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
} catch { /* no .env */ }
if (!process.env.PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SECRET_KEY) { console.log('Add PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY to .env first.'); process.exit(1); }
const write = process.argv.includes('--write');
const limit = Number(process.argv.find((a) => a.startsWith('--limit='))?.slice(8)) || Infinity;
const tmdb = process.env.TMDB_API_KEY;
const keys = { gemini: process.env.GEMINI_API_KEY, geminiModel: process.env.GEMINI_MODEL, groq: process.env.GROQ_API_KEY, groqModel: process.env.GROQ_MODEL };
const db = createClient(process.env.PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// every film, show and book still missing its line or its painting (essays have neither)
const rows = [];
for (let from = 0; ; from += 500) {
  const { data, error } = await db.from('titles').select('id, kind, slug, title, note, tmdb_id, ol_key, link, tagline, card_bg').in('kind', ['film', 'tv', 'book'])
    .or('tagline.is.null,card_bg.is.null').order('created_at').range(from, from + 499);
  if (error) { console.log('Could not read the catalogue:', error.message, '(is supabase/changes/005 and 006 applied?)'); process.exit(1); }
  rows.push(...data);
  if (data.length < 500) break;
}
const by = (f) => rows.filter(f).length;
console.log(`Titles that would change: ${rows.length}`);
console.log(`  films ${by((r) => r.kind === 'film')}, shows ${by((r) => r.kind === 'tv')}, books ${by((r) => r.kind === 'book')}`);
console.log(`  missing a line ${by((r) => !r.tagline)}, missing a painting ${by((r) => !r.card_bg)}`);
if (!write) { console.log('(dry run: nothing was asked and nothing was changed)'); process.exit(0); }
if (!keys.gemini && !keys.groq) { console.log('No AI key in .env.'); process.exit(1); }

async function getJSON(url) {
  for (let t = 0; t < 2; t++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'Granthalaya/1.0 (card facts)' }, signal: AbortSignal.timeout(20000) });
      if (r.ok) return await r.json();
      if (r.status === 404) return null;
    } catch { /* try again */ }
    await sleep(1000);
  }
  return null;
}
const text = (d) => (typeof d === 'string' ? d : d?.value ?? '');

/** the summary, TMDB's tagline and the genres of one title */
async function sourceOf(r) {
  if ((r.kind === 'film' || r.kind === 'tv') && r.tmdb_id) {
    const p = await getJSON(`https://api.themoviedb.org/3/${r.kind === 'film' ? 'movie' : 'tv'}/${r.tmdb_id}?api_key=${tmdb}&language=en-US`);
    return { tagline: p?.tagline, summary: p?.overview, genres: (p?.genres ?? []).map((g) => g.name) };
  }
  if (r.kind === 'book' && r.ol_key) {
    const w = await getJSON(`https://openlibrary.org/works/${r.ol_key}.json`);
    return { summary: text(w?.description), genres: (w?.subjects ?? []).slice(0, 10) };
  }
  return { genres: [] };
}

const keep = (v) => (v && String(v).trim().length > 40 ? String(v).trim() : null);
const ask = (r, summary, genres, needLine) => askFacts({ title: r.title, kind: r.kind, genres, summary, needLine }, keys).catch(() => null);

// the painting again, for titles whose pick looked wrong
const repick = (process.argv.find((a) => a.startsWith('--repick='))?.slice(9) ?? '').split(',').filter(Boolean);
for (const slug of repick) {
  const { data: r } = await db.from('titles').select('id, kind, slug, title, note, tmdb_id, ol_key, tagline, card_bg').eq('slug', slug).maybeSingle();
  if (!r) { console.log(`  ${slug}: not found`); continue; }
  const src = await sourceOf(r);
  const text = keep(src.summary) ?? r.note;
  if (!text) { console.log(`  ${r.title}: nothing to go on`); continue; }
  const ai = await ask(r, text, src.genres, false);
  if (ai?.bg) { await db.from('titles').update({ card_bg: ai.bg }).eq('id', r.id); console.log(`  ${r.title}: [${r.card_bg ?? 'none'}] -> [${ai.bg}]`); }
  else console.log(`  ${r.title}: no answer, kept [${r.card_bg ?? 'none'}]`);
  await sleep(3500);
}
if (repick.length && !process.argv.includes('--all')) process.exit(0);

let changed = 0, done = 0, stopped = false;
const tally = { line: 0, paintingOnly: 0, nothing: 0 };
for (const r of rows) {
  if (done >= limit) break;
  done++;
  const src = await sourceOf(r);
  const summary = keep(src.summary);
  let line = r.tagline || (src.tagline && src.tagline.trim().length <= 90 ? src.tagline.trim() : null);
  let bg = r.card_bg || null;
  if (summary) {
    if (!line || !bg) {
      const ai = await ask(r, summary, src.genres, true);
      if (!ai) { console.log(`  no AI answer for "${r.title}": stopping (the allowance may be used up; run it again later)`); stopped = true; break; }
      line ||= ai.line;
      bg ||= ai.bg;
      await sleep(3500);   // a free allowance is a few calls a minute
    }
  } else if (r.note) {
    if (!line && r.note.length <= 140 && !/^translated by/i.test(r.note)) line = r.note;   // exactly as written; "Translated by ..." is a credit, not a description
    if (!bg) {
      const ai = await ask(r, r.note, [], false);
      if (!ai) { console.log(`  no AI answer for "${r.title}": stopping (the allowance may be used up; run it again later)`); stopped = true; break; }
      bg ||= ai.bg;
      await sleep(3500);
    }
  }
  const set = {};
  if (line && !r.tagline) set.tagline = line;
  if (bg && !r.card_bg) set.card_bg = bg;
  if (!Object.keys(set).length) { tally.nothing++; continue; }
  const { error: e1 } = set.tagline ? await db.from('titles').update({ tagline: set.tagline }).eq('id', r.id).is('tagline', null) : { error: null };
  const { error: e2 } = set.card_bg ? await db.from('titles').update({ card_bg: set.card_bg }).eq('id', r.id).is('card_bg', null) : { error: null };
  if (!e1 && !e2) {
    changed++;
    tally[set.tagline ? 'line' : 'paintingOnly']++;
    console.log(`  ${r.title}: ${set.tagline ? `"${set.tagline}"` : '(no line)'} ${set.card_bg ? `[${set.card_bg}]` : ''}`);
  }
}
console.log(`Done: ${changed} titles changed (${tally.line} got a line, ${tally.paintingOnly} only a painting), ${tally.nothing} nothing to write, ${done} looked at${stopped ? ', stopped early' : ''}.`);
