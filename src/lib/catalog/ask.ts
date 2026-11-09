// Search that understands requests: "best sports movies", "philosophy books", "Marathi novels about villages", "essays on writing".
// A small AI model (Groq, then Gemini) turns the words into FILTERS only (kind, genres, keywords, subjects, our essay themes, language,
// decade, sort); it never names a title, and nothing about the visitor is sent, only the typed words. Our own code checks every filter
// against a fixed list, then asks TMDB (discover), Open Library, the shops' books and our essays for the real results, so every result
// is a real record. The model has 3 seconds; if it fails or is slow, the caller shows the normal results alone.
import type { SupabaseClient } from '@supabase/supabase-js';
import { env } from '../supabase';
import { discover, keywordIds, FILM_GENRES, TV_GENRES } from './tmdb';
import { browseBooks, BOOK_LANGUAGES } from './books';
import { searchShopBooks, shopListBooks } from './shopbooks';
import { themes as essayThemes, allEssays, freeFirst, type Essay } from '../essays';
import { allowed } from '../ratelimit';

export type Kind = 'film' | 'tv' | 'book' | 'essay';
export interface Intent { kind: Kind; genres: string[]; keywords: string[]; subjects: string[]; themes: string[]; language?: string; decade?: number; sort?: 'top' | 'new' | 'popular' }
export interface Hit { href: string; title: string; sub: string; cover?: string; kind: Kind; external?: boolean }
export interface Answer { heading: string; items: Hit[] }

/* ——— does the text look like a request rather than a title? ——— */
const REQUEST = new Set(['best', 'top', 'good', 'great', 'greatest', 'finest', 'famous', 'popular', 'recommended', 'newest', 'latest', 'highest', 'rated', 'underrated', 'classic', 'classics', 'about', 'like', 'must', 'read', 'watch',
  'उत्तम', 'सर्वोत्तम', 'सर्वश्रेष्ठ', 'चांगले', 'चांगल्या', 'बद्दल', 'विषयी', 'वरील', 'अच्छी', 'अच्छे', 'बेहतरीन', 'सबसे', 'बारे']);
const KIND_WORDS = /^(films?|movies?|cinema|shows?|series|tv|books?|novels?|essays?|articles?|stories|poems|poetry|memoirs?|biograph(y|ies)|plays|चित्रपट\S*|सिनेमा\S*|मालिका\S*|पुस्तक\S*|कादंब[रऱ]\S*|निबंध\S*|लेख\S*|कथा\S*|कविता\S*|किताब\S*|उपन्यास\S*|फिल्म\S*|फ़िल्म\S*|निबंध|कहानी\S*)$/i;
const SUBJECT_WORDS = /^(fiction|history|philosophy|psychology|science|politics|religion|travel|humou?r|romance|thriller|horror|mystery|fantasy|comedy|crime|war|sports?|biography|poetry|nature|writing|work|freedom|india|village\S*|space|love|family|music|मराठी|हिंदी|हिन्दी|गाव\S*|प्रेम|युद्ध|इतिहास|तत्त्वज्ञान)$/i;
const LANGS = new RegExp(`^(${BOOK_LANGUAGES.map(([, n]) => n.toLowerCase()).join('|')})$`, 'i');
const DECADE = /^((19|20)\d0s?|\d0s)$/i;

export function looksLikeRequest(norm: string): boolean {
  const words = norm.split(' ').filter(Boolean);
  if (words.length < 2 || norm.length < 6 || norm.includes('@')) return false;
  const hasKind = words.some((w) => KIND_WORDS.test(w));
  const hasTopic = words.some((w) => SUBJECT_WORDS.test(w) || LANGS.test(w) || DECADE.test(w) || FILM_GENRES.some(([, n]) => n.toLowerCase() === w) || TV_GENRES.some(([, n]) => n.toLowerCase() === w));
  const asks = words.some((w) => REQUEST.has(w));
  return (asks && (hasKind || hasTopic || words.length >= 3)) || (hasKind && (hasTopic || words.length >= 2));
}
export const normalise = (q: string) => q.toLowerCase().normalize('NFC').replace(/[^\p{L}\p{M}\p{N} ]+/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);

/* ——— the model: filters only ——— */
const SUBJECTS = ['fiction', 'literary-fiction', 'historical-fiction', 'mystery', 'thriller', 'science-fiction', 'fantasy', 'romance', 'horror', 'short-stories', 'poetry', 'drama', 'essays', 'biography', 'autobiography', 'history', 'philosophy', 'psychology', 'self-help', 'science', 'politics', 'religion', 'travel', 'humor', 'graphic-novels'];
const LANG2: Record<string, string> = { mr: 'mar', hi: 'hin', en: 'eng', bn: 'ben', ta: 'tam', te: 'tel', ml: 'mal', kn: 'kan', gu: 'guj', pa: 'pan', ur: 'urd', or: 'ori', sa: 'san', ja: 'jpn', fr: 'fre', de: 'ger', es: 'spa', ru: 'rus', it: 'ita', pt: 'por', zh: 'chi', ko: 'kor', ar: 'ara', fa: 'per' };
const FILM_NAMES = FILM_GENRES.map(([, n]) => n), TV_NAMES = TV_GENRES.map(([, n]) => n);

const promptFor = (q: string) => `You turn a search request for a library site into filters. Reply with JSON only, never any title, person or work.

Request: "${q}"

JSON shape:
{"request": true or false, "kind": "film" | "tv" | "book" | "essay" | null, "genres": [], "keywords": [], "subjects": [], "themes": [], "language": null, "decade": null, "sort": null}

- request: true only if the words ask for a kind of thing (films, shows, books, essays) by topic, genre, language, decade or quality. false if the words look like the name of one specific title or person.
- kind: film for films and movies, tv for series and shows, book for books and novels and stories and poems, essay for essays and articles.
- genres: only from: films ${FILM_NAMES.join(', ')}; TV ${TV_NAMES.join(', ')}.
- keywords: up to 3 short English topic words that a film database tags with (for example sports, village, heist). Lower case, in the form a film database uses. Only for films and TV.
- subjects: up to 2 book subject names in lower case with hyphens (prefer: ${SUBJECTS.join(', ')}; or any other common library subject such as war, village-life, space, friendship). Only for books.
- themes: only from our essay themes: ${essayThemes.filter((t) => t.name !== 'Picks').map((t) => t.name).join(', ')}. Only for essays.
- language: two-letter code of the language of the works (mr Marathi, hi Hindi, en English, ta Tamil, ...), or null when none is asked for.
- decade: the first year of the decade asked for (1980 for "80s" or "1980s"), or null.
- sort: "top" for best, top, highest rated, greatest; "new" for newest, latest, recent; "popular" for popular; otherwise null.
The request may be in English, Marathi or Hindi.`;

async function groq(q: string, ms: number): Promise<string> {
  const key = env('GROQ_API_KEY');
  if (!key) throw new Error('no key');
  const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(ms),
    body: JSON.stringify({ model: env('GROQ_FAST_MODEL') || 'openai/gpt-oss-20b', temperature: 0, reasoning_effort: 'low', max_completion_tokens: 700, response_format: { type: 'json_object' }, messages: [{ role: 'user', content: promptFor(q) }] }),
  });
  if (!r.ok) throw new Error(`groq ${r.status}`);
  return (await r.json()).choices?.[0]?.message?.content ?? '';
}
async function gemini(q: string, ms: number): Promise<string> {
  const key = env('GEMINI_API_KEY');
  if (!key) throw new Error('no key');
  const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key }, signal: AbortSignal.timeout(ms),
    body: JSON.stringify({ contents: [{ parts: [{ text: promptFor(q) }] }], generationConfig: { temperature: 0, responseMimeType: 'application/json', thinkingConfig: { thinkingBudget: 0 } } }),
  });
  if (!r.ok) throw new Error(`gemini ${r.status}`);
  return (await r.json()).candidates?.[0]?.content?.parts?.map((p: any) => p.text ?? '').join('') ?? '';
}

/** the model's answer, checked against our own lists: anything not on a list is dropped. null when it isn't a usable request. */
export function checked(raw: string): Intent | null {
  let j: any;
  try { j = JSON.parse(raw.replace(/^```(?:json)?|```$/g, '').trim()); } catch { return null; }
  if (!j || j.request === false) return null;
  const kind = ['film', 'tv', 'book', 'essay'].includes(j.kind) ? (j.kind as Kind) : null;
  if (!kind) return null;
  const list = (v: unknown, n: number) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string').slice(0, n) : []) as string[];
  const names = kind === 'tv' ? TV_NAMES : FILM_NAMES;
  const genres = kind === 'film' || kind === 'tv' ? list(j.genres, 3).map((g) => names.find((n) => n.toLowerCase() === g.toLowerCase()) ?? (kind === 'tv' ? ({ action: 'Action & Adventure', adventure: 'Action & Adventure', 'science fiction': 'Sci-Fi & Fantasy', fantasy: 'Sci-Fi & Fantasy', war: 'War & Politics' } as Record<string, string>)[g.toLowerCase()] : undefined)).filter(Boolean) as string[] : [];
  const keywords = kind === 'film' || kind === 'tv' ? list(j.keywords, 3).map((k) => k.toLowerCase().trim()).filter((k) => /^[a-z][a-z -]{1,28}$/.test(k)) : [];
  const subjects = kind === 'book' ? list(j.subjects, 2).map((s) => s.toLowerCase().trim().replace(/[\s_]+/g, '-')).filter((s) => /^[a-z][a-z-]{1,40}$/.test(s)) : [];
  const themes = kind === 'essay' ? list(j.themes, 2).map((t) => essayThemes.find((x) => x.name.toLowerCase() === t.toLowerCase() && x.name !== 'Picks')?.name).filter(Boolean) as string[] : [];
  const lang = typeof j.language === 'string' ? j.language.toLowerCase().slice(0, 2) : '';
  const language = LANG2[lang] ? lang : undefined;
  const dc = Number(j.decade);
  const decade = Number.isInteger(dc) && dc >= 1900 && dc <= 2020 && dc % 10 === 0 ? dc : undefined;
  const sort = j.sort === 'top' || j.sort === 'new' || j.sort === 'popular' ? (j.sort as 'top' | 'new' | 'popular') : undefined;
  if (!genres.length && !keywords.length && !subjects.length && !themes.length && !language && !decade && !sort) return null;   // nothing to filter by
  return { kind, genres: [...new Set(genres)], keywords: [...new Set(keywords)], subjects: [...new Set(subjects)], themes: [...new Set(themes)], language, decade, sort };
}

const cache = new Map<string, { at: number; intent: Intent | null }>();   // each normalised query's filters, for a day
const DAY = 86400_000;

/** the filters for a request, from the cache or the model (3 seconds in all); null when it isn't a request or the model didn't answer */
export async function intentFor(norm: string, ip?: string): Promise<{ intent: Intent | null; how: string }> {
  const hit = cache.get(norm);
  if (hit && Date.now() - hit.at < DAY) return { intent: hit.intent, how: 'cache' };
  if (!allowed('ask-model', ip, 12, 10 * 60_000) || !allowed('ask-model-all', 'all', 400, 3600_000)) return { intent: null, how: 'rate limit' };
  const start = Date.now();
  let raw = '', how = 'groq', why = '';
  try { raw = await groq(norm, 2200); }
  catch (e) {
    why = e instanceof Error ? e.message : 'failed';
    how = 'gemini';
    const left = 3000 - (Date.now() - start);
    if (left < 600) return { intent: null, how: `too slow (groq: ${why})` };
    try { raw = await gemini(norm, left); } catch (e2) { return { intent: null, how: `model failed (groq: ${why}; gemini: ${e2 instanceof Error ? e2.message : 'failed'})` }; }   // not cached: try again next time
  }
  const intent = checked(raw);
  if (!intent && import.meta.env.DEV) console.log('[ask] no usable filters from', how, ':', raw.slice(0, 300));
  cache.set(norm, { at: Date.now(), intent });
  if (!intent && import.meta.env.DEV) how += ` (no usable filters: ${raw.slice(0, 250)})`;
  if (cache.size > 500) cache.delete(cache.keys().next().value!);
  return { intent, how };
}

/* ——— from filters to real results ——— */
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const NOUN = { film: 'films', tv: 'TV shows', book: 'books', essay: 'essays' } as const;
const SORT_TEXT = { top: 'highest rated first', new: 'newest first', popular: 'most popular first' } as const;
const langName = (two?: string) => (two ? BOOK_LANGUAGES.find(([c]) => c === LANG2[two])?.[1] : undefined);
export function headingFor(i: Intent, applied: { subjects?: string[]; keywords?: string[] } = {}): string {
  const sort = i.kind === 'book' && i.sort === 'top' ? 'popular' : i.sort ?? 'popular';
  const topics = [...i.genres, ...(applied.keywords ?? i.keywords), ...(applied.subjects ?? i.subjects).map((s) => s.replace(/-/g, ' ')), ...i.themes.map((t) => t.toLowerCase())];
  const lead = [i.decade ? `${i.decade}s` : '', langName(i.language) ?? '', topics.map((t) => t.toLowerCase()).join(' and ')].filter(Boolean).join(' ');
  return `${cap(lead.trim() ? `${lead} ${NOUN[i.kind]}` : NOUN[i.kind])}, ${SORT_TEXT[sort]}`;
}

let lastDebug = '';   // dev only: what the last request did, shown in the answer's `how`
async function screen(i: Intent): Promise<{ items: Hit[]; applied: { genres: string[]; keywords: string[] } } | null> {
  const kind = i.kind as 'film' | 'tv';
  const names = kind === 'tv' ? TV_GENRES : FILM_GENRES;
  // a keyword that only repeats a genre ("action", "drama") adds nothing
  const wordsOfGenres = new Set(names.flatMap(([, n]) => n.toLowerCase().split(/[^a-z]+/)).concat(i.genres.flatMap((g) => g.toLowerCase().split(/[^a-z]+/))));
  const kws = i.keywords.filter((k) => !wordsOfGenres.has(k));
  const idOf = (g: string) => names.find(([, n]) => n === g)?.[0];
  // "best" needs enough votes to mean something, but a Marathi or Hindi film rarely has many on TMDB
  const minVotes = i.sort === 'top' && !i.language ? (kind === 'tv' ? 400 : 1500) : undefined;
  // all the filters first, then looser (genres alone, then keywords alone): the heading says what was really applied
  // (at most one keyword beside a genre, or the heading and the results get too narrow: "sci-fi and space and future and alien")
  const attempts: { genres: string[]; keywords: string[] }[] = i.genres.length
    ? [{ genres: i.genres, keywords: kws.slice(0, 1) }, ...(kws.length ? [{ genres: i.genres, keywords: [] as string[] }] : []), ...(kws.length ? [{ genres: [] as string[], keywords: kws.slice(0, 2) }] : [])]
    : [{ genres: [], keywords: kws.slice(0, 2) }];
  for (const at of attempts) {
    const genres = at.genres.map(idOf).filter((x): x is number => !!x);
    const keywords = [...new Set((await Promise.all(at.keywords.map((k) => keywordIds(k).catch(() => [] as number[])))).flat())];
    if (at.keywords.length && !keywords.length && !genres.length) continue;
    const { items, failed, total } = await discover({ kind, genres, keywords, language: i.language, decade: i.decade, sort: i.sort ?? 'popular', minVotes, retry: true });
    if (import.meta.env.DEV) lastDebug += ` screen ${JSON.stringify({ genres, keywords, minVotes })} items ${items.length} total ${total} failed ${failed};`;
    const hits = items.filter((c) => c.poster).slice(0, 8).map((c): Hit => ({ href: c.href, title: c.title, sub: [c.year, kind === 'tv' ? 'TV' : 'Film'].filter(Boolean).join(' | '), cover: c.poster, kind }));
    if (hits.length >= 3) return { items: hits, applied: at };
  }
  return null;
}

async function shelves(i: Intent, sb: SupabaseClient | null | undefined): Promise<{ hits: Hit[]; applied: string[] }> {
  const code = i.language ? LANG2[i.language] : undefined;
  const toHit = (b: { href: string; title: string; author?: string; year?: number; cover?: string }): Hit => ({ href: b.href, title: b.title, sub: [b.author, b.year].filter(Boolean).join(' | '), cover: b.cover, kind: 'book' });
  // Open Library's own star ratings are too thin to order books by (Dork Diaries comes first for travel), so "best" means most read
  const sort = i.sort === 'new' ? 'new' : 'popular';
  // most-specific first, then looser: the heading says what was really applied
  const attempts: string[][] = i.subjects.length ? [i.subjects.slice(0, 1), []] : [[]];
  for (const subs of attempts) {
    const [first] = subs;
    const r = await browseBooks({ subject: first, language: code, decade: i.decade, sort }).catch(() => null);
    let hits = (r?.items ?? []).filter((b) => b.cover).slice(0, 8).map(toHit);
    // Marathi and Hindi: the shops' books are the best we have, so they come first when no subject is asked for
    if (code === 'mar' || code === 'hin') {
      const shop = !first ? await shopListBooks(sb, code === 'mar' ? 'mr' : 'hi').catch(() => []) : [];
      const seen = new Set(shop.map((b) => b.href));
      hits = [...shop.map(toHit), ...hits.filter((b) => !seen.has(b.href))].slice(0, 8);
    }
    if (hits.length >= 3) return { hits, applied: subs };
  }
  return { hits: [], applied: [] };
}

function essays(i: Intent): Hit[] {
  const want = new Set(i.themes);
  let pool: Essay[] = want.size ? allEssays.filter((e) => themesOf(e).some((t) => want.has(t))) : allEssays;
  if (i.language === 'mr') pool = pool.filter((e) => e.language === 'mr');
  else if (i.language && i.language !== 'en') pool = [];
  if (i.decade) pool = pool.filter((e) => e.year != null && e.year >= i.decade! && e.year < i.decade! + 10);
  if (i.sort === 'new') pool = [...pool].sort((a, b) => (b.year ?? 0) - (a.year ?? 0));
  else pool = freeFirst(pool);
  return pool.slice(0, 8).map((e) => ({ href: e.link, title: e.title, sub: [e.author, e.year].filter(Boolean).join(' | '), kind: 'essay' as const, external: true }));
}
const themesOf = (e: Essay) => essayThemes.filter((t) => t.items.some((x) => x.link === e.link)).map((t) => t.name);

/** the filters, made into a heading and up to 8 real results; null when there is nothing worth showing */
export async function resultsFor(i: Intent, sb: SupabaseClient | null | undefined): Promise<Answer | null> {
  if (i.kind === 'film' || i.kind === 'tv') {
    const r = await screen(i);
    return r ? { heading: headingFor({ ...i, genres: r.applied.genres }, { keywords: r.applied.keywords }), items: r.items } : null;
  }
  if (i.kind === 'book') {
    const { hits, applied } = await shelves(i, sb);
    return hits.length ? { heading: headingFor(i, { subjects: applied }), items: hits } : null;
  }
  const items = essays(i);
  return items.length >= 2 ? { heading: headingFor(i), items } : null;
}

/** the whole thing for one typed request; never throws */
export async function answerRequest(raw: string, sb: SupabaseClient | null | undefined, ip?: string): Promise<{ answer: Answer | null; how: string }> {
  try {
    const norm = normalise(raw);
    if (!looksLikeRequest(norm)) return { answer: null, how: 'not a request' };
    const { intent, how } = await intentFor(norm, ip);
    if (!intent) return { answer: null, how };
    lastDebug = '';
    const answer = await resultsFor(intent, sb);
    return { answer, how: !answer && import.meta.env.DEV ? `${how}; filters ${JSON.stringify(intent)};${lastDebug}` : how };
  } catch { return { answer: null, how: 'error' }; }
}
