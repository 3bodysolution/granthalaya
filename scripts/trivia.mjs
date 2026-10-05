// Fill in "Behind the film / book / show" facts for titles in the database that don't have them yet,
// using the same code the site uses when someone adds something.
//
//   npm run trivia                 every film, book and TV season without facts
//   npm run trivia -- --dry        only show what it would add, change nothing
//   npm run trivia -- paterson     only this title (its address name)
//   npm run trivia -- --force      redo titles that already have facts
//
// Needs PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY and GEMINI_API_KEY (or GROQ_API_KEY) in .env.
import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { getTrivia } from '../src/lib/trivia.mjs';

try {
  for (const line of fs.readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*"?([^"#]*?)"?\s*(#.*)?$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
} catch {}
const keys = { gemini: process.env.GEMINI_API_KEY, geminiModel: process.env.GEMINI_MODEL, groq: process.env.GROQ_API_KEY, groqModel: process.env.GROQ_MODEL };
if (!keys.gemini && !keys.groq) { console.log('No GEMINI_API_KEY or GROQ_API_KEY in .env, so there is nothing to do.'); process.exit(0); }
if (!process.env.PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SECRET_KEY) { console.log('Add PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY to .env first.'); process.exit(1); }
const db = createClient(process.env.PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });

const args = process.argv.slice(2);
const dry = args.includes('--dry'), force = args.includes('--force');
const only = args.filter((a) => !a.startsWith('--'));

let q = db.from('titles').select('id, slug, kind, title, year, creator, trivia').in('kind', ['film', 'book', 'tv']).order('created_at');
if (only.length) q = q.in('slug', only);
const { data: titles, error } = await q;
if (error) { console.log('Couldn’t read the titles:', error.message); process.exit(1); }

let added = 0, missed = 0;
for (const t of titles) {
  if (!force && Array.isArray(t.trivia) && t.trivia.length) continue;
  const r = await getTrivia({ title: t.title, year: t.year ?? undefined, creator: t.creator || undefined, type: t.kind }, { ...keys, tries: 3 });
  if (!r) { console.log(`✗  ${t.slug}: no facts found (no Wikipedia page, or the AI didn't answer).`); missed++; continue; }
  console.log(`✓  ${t.slug}  (${r.source})`);
  r.trivia.forEach((x, i) => console.log(`   ${i + 1}. ${x}`));
  added++;
  if (!dry) await db.from('titles').update({ trivia: r.trivia, trivia_source: r.source }).eq('id', t.id);
  await new Promise((ok) => setTimeout(ok, 1500)); // stay well inside the free limits
}
console.log(`\nDone: ${added} with facts${dry ? ' (dry run, nothing saved)' : ''}, ${missed} without.`);
