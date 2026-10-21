// What a share card needs to know about a title that a catalogue can't give: a short line under the title, and which of our
// 11 paintings suits it. TMDB's own tagline is the line when a film or show has one; otherwise a free AI model writes one (10 words
// at most) from the title's official summary only. The same AI call also picks the painting from the summary, genres and setting
// (src/lib/cards/facts-ai.mjs). Both are saved on the title (`titles.tagline`, `titles.card_bg`), so the AI is asked once.
// A card never waits for the AI: it draws with what is saved. The AI step runs in the background, when a title is added to the
// catalogue or logged (like the trivia facts), and as a catch-up when a card finds something missing.
import type { SupabaseClient } from '@supabase/supabase-js';
import { waitUntil } from '@vercel/functions';
import { adminClient, env } from '../supabase';
import { film, show } from '../catalog/tmdb';
import { olBook, gbBook } from '../catalog/books';
import { askFacts, tidyLine as tidy } from './facts-ai.mjs';
import { isBackground, type Background } from './backgrounds';
import type { Entry } from '../data';
import type { Kind } from '../kinds';

export const tidyLine: (raw: unknown) => string | null = tidy;

/** the title, as much as the AI step needs to find its summary */
export interface Subject { titleId: string; title: string; type: Kind; tmdbId?: number | null; olKey?: string | null; link?: string | null }
const subjectOf = (e: Entry): Subject => ({ titleId: e.titleId, title: e.data.title, type: e.data.type, tmdbId: e.data.tmdbId, olKey: e.data.olKey, link: e.data.link });

/** the official summary and genres, from wherever the title comes from */
async function sourceOf(s: Subject, note?: string | null): Promise<{ tagline?: string; summary?: string; genres: string[] }> {
  if ((s.type === 'film' || s.type === 'tv') && s.tmdbId) {
    const p = s.type === 'film' ? await film(s.tmdbId) : await show(s.tmdbId);
    return { tagline: p?.tagline, summary: p?.overview, genres: (p?.genres ?? []).map((g) => g.name) };
  }
  if (s.type === 'book') {
    const gb = s.link?.match(/books\.google\.[a-z.]+\/books\?id=([A-Za-z0-9_-]{6,20})/)?.[1];
    const b = s.olKey ? await olBook(s.olKey) : gb ? await gbBook(gb) : null;
    return { summary: b?.description || note || undefined, genres: (b?.subjects ?? []).map((x) => x.name) };
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

const inflight = new Map<string, Promise<void>>();   // the card, the share window and a new log may ask together: do it once

/** the AI step: write the line and pick the painting, then save both. Never throws. Slow, so only run it in the background. */
export function fillFacts(s: Subject): Promise<void> {
  let p = inflight.get(s.titleId);
  if (!p) { p = doFill(s).finally(() => inflight.delete(s.titleId)); inflight.set(s.titleId, p); }
  return p;
}
async function doFill(s: Subject) {
  try {
    if (s.type === 'essay') return;
    const admin = adminClient();
    const saved = await savedFacts(admin, s.titleId);
    if (saved.line && (saved.bg || !saved.bgColumn)) return;
    const { tagline, summary, genres } = await sourceOf(s, null);   // a real summary: TMDB's or Open Library's
    let line = saved.line ?? (tagline ? tagline.replace(/\s+/g, ' ').trim() : null);
    if (line && line.length > 90) line = null;
    let bg: Background | null = saved.bg ?? null;
    const keys = { gemini: env('GEMINI_API_KEY'), geminiModel: env('GEMINI_MODEL'), groq: env('GROQ_API_KEY'), groqModel: env('GROQ_MODEL') };
    if (summary && summary.length > 40) {
      if (!line || !bg) {
        const ai = await askFacts({ title: s.title, kind: s.type, genres, summary }, keys);
        line ||= ai?.line ?? null;
        bg ||= isBackground(ai?.bg) ? (ai!.bg as Background) : null;   // anything but one of the 11 names is ignored
      }
    } else if (saved.note) {
      // no summary (a record made from one of our lists): the list's own note is the line, exactly as written (no AI, no guessing from
      // the title), and the AI only picks the painting from that note. No note at all: no line, and the genre rules choose the painting.
      if (!line && saved.note.length <= 140) line = saved.note;
      if (!bg) {
        const ai = await askFacts({ title: s.title, kind: s.type, genres: [], summary: saved.note, needLine: false }, keys);
        bg = isBackground(ai?.bg) ? (ai!.bg as Background) : null;
      }
    }
    if (line && !saved.line) await admin.from('titles').update({ tagline: line }).eq('id', s.titleId).is('tagline', null);
    if (bg && !saved.bg && saved.bgColumn) await admin.from('titles').update({ card_bg: bg }).eq('id', s.titleId).is('card_bg', null);
  } catch (err) {
    console.error('Could not fill in the share card facts', err);
  }
}

/** run something after the response is sent (on Vercel), or just let it finish */
export function later(job: Promise<unknown>) {
  try { waitUntil(job); } catch { /* not on Vercel: the promise just finishes on its own */ }
}

/** when a title is added to the catalogue or logged: make sure its line and painting get written, in the background */
export function ensureFactsLater(titleId: string) {
  later((async () => {
    try {
      const { data } = await adminClient().from('titles').select('id, kind, title, tmdb_id, ol_key, link').eq('id', titleId).maybeSingle();
      if (!data) return;
      await fillFacts({ titleId: data.id, title: data.title, type: data.kind as Kind, tmdbId: data.tmdb_id, olKey: data.ol_key, link: data.link });
    } catch (err) { console.error('Could not start the share card facts', err); }
  })());
}

/**
 * What a card uses right now: the saved line and painting. Nothing here waits for the AI: when either is missing,
 * the AI step is started in the background so the next card has them.
 */
export async function cardFacts(sb: SupabaseClient, e: Entry): Promise<{ line?: string; bg?: Background }> {
  const s = await savedFacts(sb, e.titleId);
  if (e.data.type !== 'essay' && (!s.line || (!s.bg && s.bgColumn))) later(fillFacts(subjectOf(e)));
  return { line: s.line, bg: s.bg };
}
