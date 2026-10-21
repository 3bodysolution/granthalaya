// What a share card needs to know about a title that a catalogue can't give: a short line under the title, and which of our
// 11 paintings suits it. TMDB's own tagline is the line when a film or show has one; otherwise a free AI model writes one (10 words
// at most) from the title's official summary only. The same AI call also picks the painting from the summary, genres and setting.
// Both are saved on the title (`titles.tagline`, `titles.card_bg`), so the AI is asked once.
// A card never waits for the AI: it draws with what is saved and the AI step runs in the background for next time.
import type { SupabaseClient } from '@supabase/supabase-js';
import { waitUntil } from '@vercel/functions';
import { adminClient, env } from '../supabase';
import { film, show } from '../catalog/tmdb';
import { olBook, gbBook } from '../catalog/books';
import { askGemini, askGroq } from '../trivia.mjs';
import { BACKGROUNDS, isBackground, type Background } from './backgrounds';
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

const WHAT = `cinema = film and the cinema, documentaries; fair = music, animation, fun, festivals, plays, graphic novels; fields = comedy, family, village life, countryside, self-help; forest = horror, fantasy, myth, dark woods; fort = history, war, western, biography, politics, forts and old cities; noir = thriller, crime, mystery, night in the city; rain = action, adventure, monsoon, coast road and storms; reading = essays, psychology, quiet books, libraries and ideas; sea = romance, poetry, travel, beaches and the coast; stars = science fiction, science, philosophy, religion, space and the night sky; wada = drama, family sagas, literary fiction, short stories, memoir, old houses`;

const prompt = (title: string, kind: string, genres: string[], summary: string) => `Two jobs for the ${kind} "${title}", for a share card.

Use ONLY the official summary and genres below.
1. "line": one short line saying what it is about, in plain, specific words. At most ${MAX_WORDS} words. No spoilers (nothing from the middle or the end). No em dashes or en dashes. No quotation marks. Do not repeat the title. Do not start with "A story about".
2. "background": the one painting that suits it best, judged from the summary, the genres and where and when it is set. It must be exactly one of: ${BACKGROUNDS.join(', ')}.
What the paintings are: ${WHAT}.

Reply with JSON only: {"line": "...", "background": "..."}

GENRES: ${genres.join(', ') || 'none listed'}
SUMMARY:
${summary.slice(0, 1800)}`;

async function ask(title: string, kind: string, genres: string[], summary: string): Promise<{ line: string | null; bg: Background | null } | null> {
  const keys = { gemini: env('GEMINI_API_KEY'), geminiModel: env('GEMINI_MODEL'), groq: env('GROQ_API_KEY'), groqModel: env('GROQ_MODEL') };
  if (!keys.gemini && !keys.groq) return null;
  const text = prompt(title, kind === 'tv' ? 'TV series' : kind, genres, summary);
  let raw: string;
  try {
    if (!keys.gemini) throw new Error('no Gemini key');
    raw = await askGemini(keys.gemini, keys.geminiModel, text, 1);
  } catch (e) {
    if (!keys.groq) return null;
    raw = await askGroq(keys.groq, keys.groqModel, text, 1);
  }
  try {
    const j = JSON.parse(raw.replace(/^```(?:json)?|```$/g, '').trim());
    const bg = String(j.background ?? '').toLowerCase().trim();
    return { line: tidyLine(j.line), bg: isBackground(bg) ? bg : null };   // anything but one of the 11 names is ignored
  } catch { return null; }
}

/** the official summary and genres, from wherever the title comes from */
async function sourceOf(e: Entry, note?: string | null): Promise<{ tagline?: string; summary?: string; genres: string[] }> {
  const d = e.data;
  if ((d.type === 'film' || d.type === 'tv') && d.tmdbId) {
    const p = d.type === 'film' ? await film(d.tmdbId) : await show(d.tmdbId);
    return { tagline: p?.tagline, summary: p?.overview, genres: (p?.genres ?? []).map((g) => g.name) };
  }
  if (d.type === 'book') {
    const gb = d.link?.match(/books\.google\.[a-z.]+\/books\?id=([A-Za-z0-9_-]{6,20})/)?.[1];
    const b = d.olKey ? await olBook(d.olKey) : gb ? await gbBook(gb) : null;
    return { summary: b?.description || note || undefined, genres: (b?.subjects ?? []).map((s) => s.name) };
  }
  return { genres: [] };
}

export interface Saved { line?: string; bg?: Background; note?: string; bgColumn: boolean }
/** what is already saved on the title; fast (one small database read). `bgColumn` is false before supabase/changes/006 is run */
export async function savedFacts(sb: SupabaseClient, titleId: string): Promise<Saved> {
  try {
    let { data, error } = await sb.from('titles').select('tagline, note, card_bg').eq('id', titleId).maybeSingle();
    const bgColumn = !error;
    if (error) ({ data, error } = await sb.from('titles').select('tagline, note').eq('id', titleId).maybeSingle());
    const r = data as { tagline?: string | null; note?: string | null; card_bg?: string | null } | null;
    return { line: r?.tagline || undefined, bg: isBackground(r?.card_bg) ? (r!.card_bg as Background) : undefined, note: r?.note ?? undefined, bgColumn };
  } catch { return { bgColumn: false }; }
}

const inflight = new Map<string, Promise<void>>();   // the card and the share window ask together: do it once

/** the AI step: write the line and pick the painting, then save both. Never throws. Slow, so only run it in the background. */
export function fillFacts(sb: SupabaseClient, e: Entry): Promise<void> {
  let p = inflight.get(e.titleId);
  if (!p) { p = doFill(sb, e).finally(() => inflight.delete(e.titleId)); inflight.set(e.titleId, p); }
  return p;
}
async function doFill(sb: SupabaseClient, e: Entry) {
  try {
    if (e.data.type === 'essay') return;
    const saved = await savedFacts(sb, e.titleId);
    if (saved.line && (saved.bg || !saved.bgColumn)) return;
    const { tagline, summary, genres } = await sourceOf(e, saved.note);
    let line = saved.line ?? (tagline ? tagline.replace(/\s+/g, ' ').trim() : null);
    if (line && line.length > 90) line = null;
    let bg = saved.bg ?? null;
    if ((!line || !bg) && summary && summary.length > 40) {
      const ai = await ask(e.data.title, e.data.type, genres, summary);
      line ||= ai?.line ?? null;
      bg ||= ai?.bg ?? null;
    }
    const admin = adminClient();
    if (line && !saved.line) await admin.from('titles').update({ tagline: line }).eq('id', e.titleId).is('tagline', null);
    if (bg && !saved.bg && saved.bgColumn) await admin.from('titles').update({ card_bg: bg }).eq('id', e.titleId).is('card_bg', null);
  } catch (err) {
    console.error('Could not fill in the share card facts', err);
  }
}

/** run something after the response is sent (on Vercel), or just let it finish */
export function later(job: Promise<unknown>) {
  try { waitUntil(job); } catch { /* not on Vercel: the promise just finishes on its own */ }
}

/**
 * What a card uses right now: the saved line and painting. Nothing here waits for the AI: when either is missing,
 * the AI step is started in the background so the next card has them.
 */
export async function cardFacts(sb: SupabaseClient, e: Entry): Promise<{ line?: string; bg?: Background }> {
  const s = await savedFacts(sb, e.titleId);
  if (e.data.type !== 'essay' && (!s.line || (!s.bg && s.bgColumn))) later(fillFacts(sb, e));
  return { line: s.line, bg: s.bg };
}
