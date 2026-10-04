// Add "Behind the film / book" facts to entries that don't have them yet,
// using the same code the site uses when you save something new.
//
//   npm run trivia                 fill in every film and book that has no facts
//   npm run trivia -- --dry        only show what it would add, change nothing
//   npm run trivia -- paterson     only this entry (its file name)
//   npm run trivia -- --force      redo entries that already have facts
//
// Needs GEMINI_API_KEY (or GROQ_API_KEY) in the .env file in this folder.
import fs from 'node:fs';
import path from 'node:path';
import { getTrivia } from '../src/lib/trivia.mjs';

try {
  for (const line of fs.readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*"?([^"#]*?)"?\s*(#.*)?$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
} catch {}
const keys = { gemini: process.env.GEMINI_API_KEY, geminiModel: process.env.GEMINI_MODEL, groq: process.env.GROQ_API_KEY, groqModel: process.env.GROQ_MODEL, tries: 4 };
if (!keys.gemini && !keys.groq) { console.log('No GEMINI_API_KEY or GROQ_API_KEY in .env, so there is nothing to do.'); process.exit(0); }

const args = process.argv.slice(2);
const dry = args.includes('--dry'), force = args.includes('--force');
const only = args.filter((a) => !a.startsWith('--'));
const LIB = 'src/content/library';

const field = (fm, k) => { const m = fm.match(new RegExp(`^${k}:\\s*(.*)$`, 'm')); return m ? m[1].trim().replace(/^["']|["']$/g, '') : undefined; };
let added = 0, missed = 0;
for (const f of fs.readdirSync(LIB).filter((x) => x.endsWith('.md'))) {
  const slug = f.replace(/\.md$/, '');
  if (only.length && !only.includes(slug)) continue;
  const file = path.join(LIB, f);
  const text = fs.readFileSync(file, 'utf8');
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) continue;
  let fm = m[1];
  const type = field(fm, 'type');
  if (type !== 'film' && type !== 'book') continue;
  if (/^trivia:/m.test(fm) && !force) continue;
  const item = { title: field(fm, 'title'), year: Number(field(fm, 'year')) || undefined, creator: field(fm, 'creator'), type };
  if (added + missed) await new Promise((r) => setTimeout(r, 1500)); // stay well inside the free limits
  const t = await getTrivia(item, keys);
  if (!t) { console.log(`✗  ${slug}: no facts found (no Wikipedia page, or the AI didn't answer).`); missed++; continue; }
  console.log(`✓  ${slug}  (${t.source})`);
  t.trivia.forEach((x, i) => console.log(`   ${i + 1}. ${x}`));
  added++;
  if (dry) continue;
  // replace any old facts, then add the new ones at the end of the front matter
  fm = fm.replace(/^trivia:\r?\n(?:\s+- .*\r?\n?)*/m, '').replace(/^triviaSource:.*\r?\n?/m, '').replace(/\s*$/, '');
  fm += '\ntrivia:\n' + t.trivia.map((x) => `  - ${JSON.stringify(x)}`).join('\n') + `\ntriviaSource: ${JSON.stringify(t.source)}`;
  fs.writeFileSync(file, text.replace(m[0], `---\n${fm}\n---`));
}
console.log(`\nDone: ${added} with facts${dry ? ' (dry run, nothing saved)' : ''}, ${missed} without.`);
