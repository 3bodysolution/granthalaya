// The short line under a title on a share card.
// TMDB's own tagline when a film or show has one; otherwise a free AI model writes one line (10 words at most)
// from the title's official summary only. It is saved on the title (`titles.tagline`), so it is made once.
import type { SupabaseClient } from '@supabase/supabase-js';
import { adminClient, env } from '../supabase';
import { film, show } from '../catalog/tmdb';
import { olBook, gbBook } from '../catalog/books';
import { askGemini, askGroq } from '../trivia.mjs';
import type { Entry } from '../data';

const MAX_WORDS = 10;

/** tidy a line: one sentence, no dashes, no quotes, and short enough; null if it can't be used */
export function tidyLine(raw: unknown): string | null {
  let s = String(raw ?? '').replace(/\s+/g, ' ').replace(/^["“”'‘’\s]+|["“”'‘’\s]+$/g, '').trim();
  if (/[—–]/.test(s)) s = s.replace(/\s*[—–]\s*/g, ', ');
  s = s.replace(/\.$/, '');
  if (s.length < 8 || s.split(' ').length > MAX_WORDS) return null;
  return s;
}

const prompt = (title: string, kind: string, summary: string) => `Write one short line about the ${kind} "${title}" for a share card.

Use ONLY the official summary below. Say what it is about in plain, specific words.
Rules:
- At most ${MAX_WORDS} words.
- No spoilers: nothing from the middle or the end of the story.
- No em dashes or en dashes. No quotation marks.
- Do not repeat the title. Do not start with "A story about".

Reply with JSON only: {"line": "..."}

SUMMARY:
${summary.slice(0, 1800)}`;

async function writeLine(title: string, kind: string, summary: string): Promise<string | null> {
  const keys = { gemini: env('GEMINI_API_KEY'), geminiModel: env('GEMINI_MODEL'), groq: env('GROQ_API_KEY'), groqModel: env('GROQ_MODEL') };
  if (!keys.gemini && !keys.groq) return null;
  const text = prompt(title, kind === 'tv' ? 'TV series' : kind, summary);
  let raw: string;
  try {
    if (!keys.gemini) throw new Error('no Gemini key');
    raw = await askGemini(keys.gemini, keys.geminiModel, text, 1);
  } catch (e) {
    if (!keys.groq) return null;
    raw = await askGroq(keys.groq, keys.groqModel, text, 1);
  }
  try { return tidyLine(JSON.parse(raw.replace(/^```(?:json)?|```$/g, '').trim()).line); } catch { return null; }
}

/** the official summary, from wherever the title comes from */
async function summaryOf(e: Entry, note?: string | null): Promise<{ tagline?: string; summary?: string }> {
  const d = e.data;
  if ((d.type === 'film' || d.type === 'tv') && d.tmdbId) {
    const p = d.type === 'film' ? await film(d.tmdbId) : await show(d.tmdbId);
    return { tagline: p?.tagline, summary: p?.overview };
  }
  if (d.type === 'book') {
    const gb = d.link?.match(/books\.google\.[a-z.]+\/books\?id=([A-Za-z0-9_-]{6,20})/)?.[1];
    const b = d.olKey ? await olBook(d.olKey) : gb ? await gbBook(gb) : null;
    return { summary: b?.description || note || undefined };
  }
  return {};
}

/**
 * The line for this title, or undefined (essays, no summary, no AI key). Never throws.
 * `sb` is the visitor's connection: the shared catalogue is readable by everyone.
 */
const inflight = new Map<string, Promise<string | undefined>>();   // the card and the share window ask together: write the line once
export function titleLine(sb: SupabaseClient, e: Entry): Promise<string | undefined> {
  let p = inflight.get(e.titleId);
  if (!p) { p = makeLine(sb, e).finally(() => inflight.delete(e.titleId)); inflight.set(e.titleId, p); }
  return p;
}
async function makeLine(sb: SupabaseClient, e: Entry): Promise<string | undefined> {
  try {
    // `tagline` is a column added by supabase/changes/005; before it exists, the select fails and we simply don't save
    const { data, error } = await sb.from('titles').select('tagline, note').eq('id', e.titleId).maybeSingle();
    const saved = error ? undefined : (data as { tagline?: string | null } | null)?.tagline;
    if (saved) return saved;
    if (e.data.type === 'essay') return undefined;

    const { tagline, summary } = await summaryOf(e, (data as { note?: string | null } | null)?.note);
    let line = tagline ? tagline.replace(/\s+/g, ' ').trim() : null;
    if (line && line.length > 90) line = null;
    if (!line && summary && summary.length > 40) line = await writeLine(e.data.title, e.data.type, summary);
    if (!line) return undefined;
    if (!error) await adminClient().from('titles').update({ tagline: line }).eq('id', e.titleId).is('tagline', null);
    return line;
  } catch (err) {
    console.error('Could not get a line for the share card', err);
    return undefined;
  }
}
