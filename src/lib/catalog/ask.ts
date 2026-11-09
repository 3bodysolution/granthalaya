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
import { parseSimple } from './wordlist';

export type Kind = 'film' | 'tv' | 'book' | 'essay';
export interface Intent { kind: Kind; genres: string[]; keywords: string[]; subjects: string[]; themes: string[]; language?: string; decade?: number; sort?: 'top' | 'new' | 'popular'; form?: 'story' }
export interface Hit { href: string; title: string; sub: string; cover?: string; kind: Kind; external?: boolean; tag?: string }
export interface Answer { heading: string; items: Hit[] }

/* ——— does the text look like a request rather than a title? ——— */
const REQUEST = new Set(['best', 'top', 'good', 'great', 'greatest', 'finest', 'famous', 'popular', 'recommended', 'newest', 'latest', 'highest', 'rated', 'underrated', 'classic', 'classics', 'about', 'like', 'must', 'read', 'watch',
  'उत्तम', 'सर्वोत्तम', 'सर्वश्रेष्ठ', 'चांगले', 'चांगल्या', 'बद्दल', 'विषयी', 'वरील', 'अच्छी', 'अच्छे', 'बेहतरीन', 'सबसे', 'बारे']);
const KIND_WORDS = /^(films?|movies?|cinema|shows?|series|tv|books?|novels?|essays?|articles?|stories|poems|poetry|memoirs?|biograph(y|ies)|plays|चित्रपट\S*|सिनेमा\S*|मालिका\S*|पुस्तक\S*|कादंब[रऱ]\S*|निबंध\S*|लेख\S*|कथा\S*|कविता\S*|किताब\S*|उपन्यास\S*|फिल्म\S*|फ़िल्म\S*|निबंध|कहानी\S*)$/i;
const SUBJECT_WORDS = /^(documentarS*|animatS*|comedS*|fiction|history|philosophy|psychology|science|politics|religion|travel|humou?r|romance|thriller|horror|mystery|fantasy|comedy|crime|war|sports?|biography|poetry|nature|writing|work|freedom|india|village\S*|space|love|family|music|मराठी|हिंदी|हिन्दी|गाव\S*|प्रेम|युद्ध|इतिहास|तत्त्वज्ञान)$/i;
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
  const noun = i.form === 'story' ? 'stories' : NOUN[i.kind];
  const lead = [i.decade ? `${i.decade}s` : '', langName(i.language) ?? '', topics.map((t) => t.toLowerCase()).join(' and ')].filter(Boolean).join(' ');
  return `${cap(lead.trim() ? `${lead} ${noun}` : noun)}, ${SORT_TEXT[sort]}`;
}

/** fewer good results than this and the block is not shown at all (a short, wrong list is worse than none) */
const ENOUGH = 4;
let lastDebug = '';   // dev only: what the last request did, shown in the answer's `how`

/** TMDB keywords that mark what is not a film or show in the usual sense (found once, kept in memory) */
let unwanted: Promise<number[]> | null = null;
const unwantedKeywordIds = () => (unwanted ??= Promise.all(['stand-up comedy', 'stand-up specials', 'stand-up comedian', 'music video', 'concert', 'concert film', 'live concert', 'music concert', 'short film']
  .map((t) => keywordIds(t).catch(() => [] as number[]))).then((a) => [...new Set(a.flat())]));

/* Films and TV: TMDB discover. "Highest rated" needs a real number of votes: about 300 for English, 20 for Indian and other languages
   (Marathi films rarely have more on TMDB). Adult titles are always left out (discover is asked with include_adult=false). */
async function screen(i: Intent, limit = 8): Promise<{ items: Hit[]; applied: { genres: string[]; keywords: string[] } } | null> {
  const kind = i.kind as 'film' | 'tv';
  const names = kind === 'tv' ? TV_GENRES : FILM_GENRES;
  // a keyword that only repeats a genre ("action", "drama") adds nothing
  const wordsOfGenres = new Set(names.flatMap(([, n]) => n.toLowerCase().split(/[^a-z]+/)).concat(i.genres.flatMap((g) => g.toLowerCase().split(/[^a-z]+/))));
  const kws = i.keywords.filter((k) => !wordsOfGenres.has(k));
  const idOf = (g: string) => names.find(([, n]) => n === g)?.[0];
  const english = !i.language || i.language === 'en';
  // No sort word means highest rated, with the vote minimum (popularity alone puts obscure titles first). Newest needs 30 votes too.
  const sort = i.sort ?? 'top';
  // (about 300 votes for English; a request with only a broad genre, like animation, has so many titles that 2500 votes are asked of a film and 600 of a show)
  const broad = !i.keywords.length && !i.decade && !i.language;
  const minVotes = sort === 'top' ? (english ? (broad ? (kind === 'film' ? 2500 : 600) : 300) : 20) : sort === 'new' ? 30 : undefined;
  // short films, music videos, stand-up specials and concert films are left out unless the request is for them
  const wants = [...i.keywords, ...i.genres].join(' ').toLowerCase();
  const allowShort = /stand|concert|music video|short|^music$|music/.test(wants);
  const without = allowShort ? [] : await unwantedKeywordIds();
  // all the filters first, then looser (at most one keyword beside a genre, genres alone, then keywords alone): the heading says what was applied
  const attempts: { genres: string[]; keywords: string[] }[] = i.genres.length
    ? [{ genres: i.genres, keywords: kws.slice(0, 1) }, ...(kws.length ? [{ genres: i.genres, keywords: [] as string[] }] : []), ...(kws.length ? [{ genres: [] as string[], keywords: kws.slice(0, 2) }] : [])]
    : [{ genres: [], keywords: kws.slice(0, 2) }];
  for (const at of attempts) {
    const genres = at.genres.map(idOf).filter((x): x is number => !!x);
    const keywords = [...new Set((await Promise.all(at.keywords.map((k) => keywordIds(k).catch(() => [] as number[])))).flat())];
    if (at.keywords.length && !keywords.length && !genres.length) continue;
    // the high bar for a broad request first; a small genre (documentaries) that can't fill the list at that bar is asked again at 1000, then 300 votes
    const floors = minVotes && minVotes > 300 ? [minVotes, ...(minVotes > 1000 ? [1000] : []), 300] : [minVotes];
    let used = floors[0];
    let found = await discover({ kind, genres, keywords, language: i.language, decade: i.decade, sort, minVotes: floors[0], retry: true, ms: 3500, released: true, minRuntime: allowShort ? undefined : 40, without });
    for (const v of floors.slice(1)) {
      if (found.items.filter((c) => c.poster).length >= ENOUGH) break;
      used = v;
      found = await discover({ kind, genres, keywords, language: i.language, decade: i.decade, sort, minVotes: v, retry: true, ms: 3500, released: true, minRuntime: allowShort ? undefined : 40, without });
    }
    // the results page asks for up to 48: TMDB gives 20 a page, so a second page is asked for when the first was full
    if (limit > 20 && found.items.length >= 20) {
      const more = await discover({ kind, genres, keywords, language: i.language, decade: i.decade, sort, minVotes: used, retry: true, ms: 3500, released: true, minRuntime: allowShort ? undefined : 40, without, page: 2 }).catch(() => null);
      if (more) found = { ...found, items: [...found.items, ...more.items] };
    }
    const { items, failed, total } = found;
    if (import.meta.env.DEV) lastDebug += ` screen ${JSON.stringify({ genres, keywords, minVotes })} items ${items.length} total ${total} failed ${failed};`;
    const thisYear = new Date().getFullYear();
    const hits = items.filter((c) => c.poster && (!c.year || c.year <= thisYear)).slice(0, limit).map((c): Hit => ({ href: c.href, title: c.title, sub: [c.year, kind === 'tv' ? 'TV' : 'Film'].filter(Boolean).join(' | '), cover: c.poster, kind }));
    if (hits.length >= ENOUGH) return { items: hits, applied: at };
  }
  return null;
}

/* Books: a book is shown only when the subject is one of its main subjects and it is a well-known book (many editions or ratings),
   and for Marathi and Hindi with no subject asked for, the shops' books come first (Open Library has few). */
async function shelves(i: Intent, sb: SupabaseClient | null | undefined, limit = 8): Promise<{ hits: Hit[]; applied: string[] }> {
  const code = i.language ? LANG2[i.language] : undefined;
  const indian = code === 'mar' || code === 'hin';
  const subject = i.subjects[0];
  const fictionish = !subject || subject === 'fiction' || subject === 'literary-fiction';
  const toHit = (b: { href: string; title: string; author?: string; year?: number; cover?: string }): Hit => ({ href: b.href, title: b.title, sub: [b.author, b.year].filter(Boolean).join(' | '), cover: b.cover, kind: 'book' });
  const sort = i.sort === 'new' ? 'new' : 'popular';   // Open Library's own star ratings are too thin to order by, so "best" means most read
  let hits: Hit[] = [];
  if (indian && fictionish) hits = (await shopListBooks(sb, code === 'mar' ? 'mr' : 'hi', limit).catch(() => [])).map(toHit);
  if (!indian || !fictionish || hits.length < limit) {
    const r = await browseBooks({ subject, language: code, decade: i.decade, sort, main: !!subject }).catch(() => null);
    const seen = new Set(hits.map((h) => h.href));
    hits = [...hits, ...(r?.items ?? []).filter((b) => b.cover && !seen.has(b.href)).map(toHit)];
  }
  hits = hits.slice(0, limit);
  if (import.meta.env.DEV) lastDebug += ` books ${hits.length};`;
  return { hits: hits.length >= ENOUGH ? hits : [], applied: subject && hits.length >= ENOUGH ? [subject] : [] };
}

/* Essays and stories: our own, from the essays data (the Marathi ones are Hakara's). "essays" leaves stories out, and the story form keeps only them. */
const themesOf = (e: Essay) => essayThemes.filter((t) => t.items.some((x) => x.link === e.link)).map((t) => t.name);
function essays(i: Intent, limit = 8): Hit[] {
  const want = new Set(i.themes);
  let pool: Essay[] = allEssays.filter((e) => (i.form === 'story' ? e.kind === 'story' : e.kind !== 'story'));
  if (want.size) pool = pool.filter((e) => themesOf(e).some((t) => want.has(t)));
  if (i.language === 'mr') pool = pool.filter((e) => e.language === 'mr');
  else if (i.language === 'en') pool = pool.filter((e) => e.language !== 'mr');
  else if (i.language) pool = [];
  if (i.decade) pool = pool.filter((e) => e.year != null && e.year >= i.decade! && e.year < i.decade! + 10);
  pool = i.sort === 'new' ? [...pool].sort((a, b) => (b.year ?? 0) - (a.year ?? 0)) : freeFirst(pool);
  return pool.slice(0, limit).map((e) => ({ href: e.link, title: e.title, sub: [e.author, e.year].filter(Boolean).join(' | '), kind: 'essay' as const, external: true, tag: e.kind === 'story' ? 'Story' : 'Essay' }));
}

/** the filters, made into a heading and up to 8 real results; null when fewer than 4 good ones remain */
export async function resultsFor(i: Intent, sb: SupabaseClient | null | undefined, limit = 8): Promise<Answer | null> {
  if (i.kind === 'film' || i.kind === 'tv') {
    const r = await screen(i, limit);
    return r ? { heading: headingFor({ ...i, genres: r.applied.genres, sort: i.sort ?? 'top' }, { keywords: r.applied.keywords }), items: r.items } : null;
  }
  if (i.kind === 'book') {
    const { hits, applied } = await shelves(i, sb, limit);
    return hits.length ? { heading: headingFor(i, { subjects: applied }), items: hits } : null;
  }
  const items = essays(i, limit);
  return items.length >= ENOUGH ? { heading: headingFor(i), items } : null;
}

/** the whole thing for one typed request; never throws. The word list reads common requests (no AI); the model is asked only for the rest. */
export async function answerRequest(raw: string, sb: SupabaseClient | null | undefined, ip?: string, limit = 8): Promise<{ answer: Answer | null; how: string }> {
  try {
    const norm = normalise(raw);
    if (!looksLikeRequest(norm)) return { answer: null, how: 'not a request' };
    let intent = parseSimple(norm), how = 'word list';
    if (!intent) ({ intent, how } = await intentFor(norm, ip));
    if (!intent) return { answer: null, how };
    lastDebug = '';
    const answer = await resultsFor(intent, sb, limit);
    return { answer, how: !answer && import.meta.env.DEV ? `${how}; filters ${JSON.stringify(intent)};${lastDebug}` : how };
  } catch { return { answer: null, how: 'error' }; }
}
