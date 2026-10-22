// Lines to taglines (supabase/changes/009): each entry with lines gets one of them as its review's tagline.
// Which line: the one pinned to the profile if it's on that entry, else the person's own line, else the first by position.
// Only lines up to 140 characters can be a tagline; quotes count too. highlights and pinned_line are left untouched.
//
//   node scripts/lines-to-taglines.mjs            dry run (the default): counts, lists every tagline and the lines too long, writes nothing
//   node scripts/lines-to-taglines.mjs --write    does it (only when Sarthak asks for it in that message, after 009 is applied)
//
// Safe to repeat: only entries whose tagline is still empty are filled.
// Needs PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY in .env. Nothing from .env is printed. The dry run also works before 009.
import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';

try {
  for (const line of fs.readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*"?([^"#]*?)"?\s*(#.*)?$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
} catch { /* no .env */ }
const need = ['PUBLIC_SUPABASE_URL', 'SUPABASE_SECRET_KEY'].filter((k) => !process.env[k]);
if (need.length) { console.log(`Add ${need.join(', ')} to .env first.`); process.exit(1); }
const write = process.argv.includes('--write');
const db = createClient(process.env.PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
const MAX = 140;

const { data: probe, error: pe } = await db.from('logs').select('*').limit(1);
if (pe) { console.log('Could not read the shelves:', pe.message); process.exit(1); }
const applied = !probe.length || 'tagline' in probe[0];
if (write && !applied) { console.log('supabase/changes/009 is not applied yet. Apply it first.'); process.exit(1); }

const [{ data: hl, error: he }, { data: det, error: de }] = await Promise.all([
  db.from('highlights').select(`id, body, mine, position, log:logs(id, ${applied ? 'tagline, ' : ''}user_id, title:titles(title, season), profile:profiles!logs_user_id_fkey(username))`).order('position'),
  db.from('profile_details').select('id, pinned_line'),
]);
if (he || de) { console.log('Could not read the lines:', (he ?? de).message); process.exit(1); }
const pinned = new Set((det ?? []).map((d) => d.pinned_line).filter(Boolean));

const byLog = new Map();
for (const h of hl ?? []) if (h.log) byLog.set(h.log.id, [...(byLog.get(h.log.id) ?? []), h]);
const plan = [], tooLong = [], hasOne = [], none = [];
for (const [, lines] of byLog) {
  const log = lines[0].log;
  const name = `@${log.profile?.username} · ${log.title?.title}${log.title?.season ? `, season ${log.title.season}` : ''}`;
  for (const h of lines) if ([...h.body].length > MAX) tooLong.push({ name, h });
  if (log.tagline) { hasOne.push(name); continue; }
  const fits = lines.filter((h) => [...h.body].length <= MAX).sort((a, b) => a.position - b.position);
  const pick = fits.find((h) => pinned.has(h.id)) ?? fits.find((h) => h.mine) ?? fits[0];
  if (!pick) { none.push(name); continue; }
  plan.push({ id: log.id, name, h: pick, why: pinned.has(pick.id) ? 'pinned' : pick.mine ? 'their own line' : 'first line' });
}

console.log(`${hl?.length ?? 0} lines on ${byLog.size} entries.${applied ? '' : ' (009 not applied yet, so every tagline counts as empty.)'}`);
console.log(`\nWould set ${plan.length} tagline(s):`);
for (const p of plan) console.log(`  ${p.name} (${p.why}, ${[...p.h.body].length} characters)\n    "${p.h.body}"`);
if (hasOne.length) console.log(`\nAlready have a tagline, left alone: ${hasOne.length}`);
if (tooLong.length) {
  console.log(`\nLines over ${MAX} characters (never used as a tagline; they stay in the old lines table):`);
  for (const { name, h } of tooLong) console.log(`  ${name} (${[...h.body].length} characters)\n    "${h.body.slice(0, 160)}${h.body.length > 160 ? '…' : ''}"`);
}
if (none.length) console.log(`\nEntries with no line short enough, so no tagline: ${none.join('; ')}`);

if (!write) { console.log('\n(dry run: nothing was changed. --write sets these.)'); process.exit(0); }
let n = 0;
for (const p of plan) {
  // only while still empty, so a tagline written in the meantime is kept
  const { data, error } = await db.from('logs').update({ tagline: p.h.body }).eq('id', p.id).eq('tagline', '').select('id');
  if (error) { console.log(`  ${p.name}: ${error.message}`); continue; }
  n += data?.length ?? 0;
}
console.log(`\nSet ${n} tagline(s).`);
