// Marathi and Hindi books, suggested each week by a free AI model (Gemini, then Groq).
// The model only names books. A book is kept only if Open Library, Google Books or Wikipedia
// has it too (same title, and the author's surname appears there), so an invented book is dropped.
// Run by the weekly cron through /api/suggest. Hidden suggestions stay in the table, so they never come back.
import { adminClient, env } from './supabase';
import { askGemini, askGroq, findWikipediaPage } from './trivia.mjs';
import { books as olSearch } from './lookup';
import { getJSON, slug as slugify } from './catalog/fetch';

export const LANGS = { mr: 'Marathi', hi: 'Hindi' } as const;
export type Lang = keyof typeof LANGS;

// A run aims for 30 new books. One question for 40 books is too much for the free models (Groq answers nothing), so it is three
// questions of 20 at once, each from a different side of the literature (about 5 seconds with Gemini's quick model), and a second
// set if fewer than 30 passed the checks and there is time. The function may run for 60 seconds, so the checking stops at about 48 and whatever passed is kept; the next run carries on.
const PER_RUN = 30;
const ASK = 20;
const BUDGET_MS = 48_000;
const SIDES = [
  'older classics (before 1960): novels, plays and well-known memoirs',
  'good books from 1960 to today, including recent ones, and books beyond the usual prize winners',
  'short story collections, essays, memoirs, poetry and humour',
];

const norm = (s = '') => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/&/g, ' and ').replace(/^(the|a|an)\s+/, '').replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ').trim();
const surname = (a = '') => norm(a).split(' ').filter((w) => w.length > 2).pop() ?? '';
const sameTitle = (a: string, b: string) => {
  const x = norm(a), y = norm(b);
  return !!x && !!y && (x === y || x.startsWith(y + ' ') || y.startsWith(x + ' '));
};
const hasAuthor = (author: string, ...seen: (string | undefined)[]) => {
  const s = surname(author);
  return !!s && seen.some((t) => norm(t).split(' ').includes(s));
};

// Open Library sometimes writes "Kosala कोसला": keep the English letters as the title and the other script as the original title
const DEVANAGARI = /[ऀ-ॿ]/;
const tidy = (s: string) => s.replace(/[ऀ-ॿ]+/g, ' ').replace(/\s+/g, ' ').replace(/[\s.,;]+$/, '').trim();
const own = (title: string) => ({ title: tidy(title) || title, original: DEVANAGARI.test(title) ? title.match(/[ऀ-ॿ][ऀ-ॿ\s]*/)?.[0].trim() : undefined });

interface Candidate { title: string; author: string; year?: number }
interface Checked { title: string; original?: string; creator: string; year?: number; olKey?: string; cover?: string; via: 'Open Library' | 'Google Books' | 'Wikipedia' | 'Our catalogue' }

const prompt = (lang: Lang, skip: string[], side = '') => `You are helping a book website suggest well-regarded ${LANGS[lang]} literature.
List ${ASK} real books originally written in ${LANGS[lang]}${side ? `, from this side of its literature: ${side}` : ': novels, short story collections, memoirs, essays or poetry. Mix older classics and good modern books'}. Choose books a curious reader would enjoy, not only prize winners.
Only list books you are certain exist, with their real author. If you are not sure, leave it out.
Give each title the way it is usually written in English letters (for example "Yayati"), with the author's name in English letters, and the year it was first published if you know it.
Do not repeat any of these: ${skip.slice(0, 250).join('; ') || 'none yet'}.
Reply with JSON only: {"books": [{"title": "...", "author": "...", "year": 1959}]}`;

async function ask(text: string): Promise<Candidate[]> {
  const gemini = env('GEMINI_API_KEY'), groq = env('GROQ_API_KEY');
  if (!gemini && !groq) throw new Error('no AI key');
  let raw: string;
  try {
    if (!gemini) throw new Error('no Gemini key');
    raw = await askGemini(gemini, env('GEMINI_MODEL'), text, 2, { fast: true });
  } catch (e) {
    if (!groq) throw e;
    raw = await askGroq(groq, env('GROQ_MODEL'), text, 1);
  }
  const list = JSON.parse(raw.replace(/^```(?:json)?|```$/g, '').trim()).books;
  return (Array.isArray(list) ? list : [])
    .filter((b: { title?: unknown; author?: unknown }): b is { title: string; author: string; year?: unknown } => typeof b?.title === 'string' && typeof b?.author === 'string' && !!b.title.trim() && !!b.author.trim())
    .map((b) => ({ title: b.title.trim().slice(0, 200), author: b.author.trim().slice(0, 120), year: typeof b.year === 'number' && Number.isInteger(b.year) && b.year > 1000 && b.year < 2100 ? b.year : undefined }));
}

/** Is this a real book? Open Library first, then Google Books, then Wikipedia. */
export async function verify(c: Candidate): Promise<Checked | null> {
  // a book our catalogue already has from a shop or Open Library (same title, same author's surname) is a real book
  try {
    const { data } = await adminClient().from('titles').select('title, creator, original_title, year, ol_key, cover_url, source').eq('kind', 'book').in('source', ['Akshardhara', 'BookGanga', 'Open Library'])
      .ilike('title', c.title.replace(/[%_\\]/g, (m) => `\\${m}`)).limit(10);
    const have = (data ?? []).find((r: any) => sameTitle(r.title, c.title) && hasAuthor(c.author, r.creator));
    if (have) return { title: have.title, creator: have.creator, year: have.year ?? undefined, olKey: have.ol_key ?? undefined, cover: have.cover_url ?? undefined, original: have.original_title ?? undefined, via: 'Our catalogue' };
  } catch { /* try the real sources */ }
  try {
    for (const q of [`${c.title} ${c.author}`, c.title]) {
      const hit = (await olSearch(q, 8)).find((h) => h.olKey && sameTitle(h.title, c.title) && hasAuthor(c.author, h.creator));
      if (hit) return { ...own(hit.title), creator: tidy(c.author), year: hit.year, olKey: hit.olKey, cover: hit.cover, via: 'Open Library' };
    }
  } catch { /* try the next source */ }
  try {
    const key = env('GOOGLE_BOOKS_API_KEY');
    const q = encodeURIComponent(`intitle:${c.title} inauthor:${c.author}`);
    const j = await getJSON<any>(`https://www.googleapis.com/books/v1/volumes?q=${q}&maxResults=6${key ? `&key=${key}` : ''}`);
    const v = (j?.items ?? []).map((i: any) => i.volumeInfo).find((i: any) => i?.title && sameTitle(i.title, c.title) && hasAuthor(c.author, ...(i.authors ?? [])));
    if (v) return { title: c.title, creator: tidy(c.author), year: /^\d{4}/.test(v.publishedDate ?? '') ? +v.publishedDate.slice(0, 4) : c.year, via: 'Google Books' };
  } catch { /* try the next source */ }
  try {
    const page = await findWikipediaPage({ title: c.title, year: c.year, type: 'book', creator: c.author });
    if (page && hasAuthor(c.author, page.text.slice(0, 6000))) return { title: c.title, creator: tidy(c.author), year: c.year, via: 'Wikipedia' };
  } catch { /* not found */ }
  return null;
}

async function inChunks<T>(items: T[], n: number, fn: (t: T) => Promise<void>, stop: () => boolean) {
  for (let i = 0; i < items.length && !stop(); i += n) await Promise.all(items.slice(i, i + n).map(fn));
}

/**
 * One weekly run for one language. With dry = true nothing is written: it only shows what would be added.
 * Returns what was added and how many of the model's books couldn't be checked.
 */
export async function suggestBooks(lang: Lang, { dry = false }: { dry?: boolean } = {}) {
  const db = adminClient();
  const { data: have, error: haveErr } = await db.from('book_suggestions').select('title:titles(title, creator)').eq('language', lang);
  if (haveErr && !dry) throw new Error(haveErr.message); // a dry run works before the table exists
  const seen = (have ?? []).map((r: any) => r.title).filter(Boolean) as { title: string; creator: string }[];
  const started = Date.now();
  const kept: Checked[] = [];
  const tried: Candidate[] = [];   // everything the model named this run, kept or not, so a second question doesn't bring the same ones back
  const droppedNames: string[] = [];
  let named = 0, dropped = 0;
  for (let round = 0; round < 2 && kept.length < PER_RUN && Date.now() - started < BUDGET_MS - 18_000; round++) {
    const skip = [...seen.map((s) => `${s.title} by ${s.creator}`), ...kept.map((k) => `${k.title} by ${k.creator}`), ...tried.map((c) => `${c.title} by ${c.author}`)];
    const answers = await Promise.allSettled(SIDES.map((side) => ask(prompt(lang, skip, side))));
    if (answers.every((a) => a.status === 'rejected')) throw (answers[0] as PromiseRejectedResult).reason;
    const batch = answers.flatMap((a) => (a.status === 'fulfilled' ? a.value : []));
    named += batch.length;
    const fresh = batch.filter((c) => !seen.some((s) => sameTitle(s.title, c.title) && hasAuthor(c.author, s.creator)) && !tried.some((t) => sameTitle(t.title, c.title) && hasAuthor(c.author, t.author)));
    tried.push(...fresh);
    await inChunks(fresh, 8, async (c) => {
      const ok = await verify(c);
      if (!ok) { dropped++; droppedNames.push(`${c.title} by ${c.author}`); return; }
      if (kept.length < PER_RUN && !kept.some((k) => sameTitle(k.title, ok.title) && hasAuthor(ok.creator, k.creator))) kept.push(ok);
    }, () => kept.length >= PER_RUN || Date.now() - started > BUDGET_MS);
  }

  const added: { title: string; creator: string; via: string; year?: number }[] = [];
  for (const k of kept) {
    if (!dry) {
      const id = await titleRecord(k, lang);
      if (!id) continue;
      const { error } = await db.from('book_suggestions').insert({ language: lang, title_id: id, checked_with: k.via });
      if (error) continue; // already there (maybe hidden)
    }
    added.push({ title: k.title, creator: k.creator, via: k.via, year: k.year });
  }
  return { language: lang, named, dropped, added, ...(dry ? { notConfirmed: droppedNames, seconds: Math.round((Date.now() - started) / 1000) } : {}) };
}

/** the catalogue row for a checked book: one that's already there, or a new one */
async function titleRecord(k: Checked, lang: Lang): Promise<string | null> {
  const db = adminClient();
  if (k.olKey) {
    const { data } = await db.from('titles').select('id').eq('ol_key', k.olKey).maybeSingle();
    if (data) return data.id;
  }
  const { data: same } = await db.from('titles').select('id, title, creator').eq('kind', 'book').ilike('title', k.title.replace(/[%_\\]/g, (m) => `\\${m}`)).limit(20);
  const old = (same ?? []).find((r: any) => hasAuthor(k.creator, r.creator));
  if (old) return old.id;
  const base = slugify(k.title) || 'untitled', by = slugify(surname(k.creator));
  const tries = [base, by ? `${base}-${by}` : '', ...Array.from({ length: 10 }, (_, i) => `${base}-${i + 2}`)].filter(Boolean);
  const { data: taken } = await db.from('titles').select('slug').in('slug', tries);
  const used = new Set((taken ?? []).map((r: any) => r.slug));
  const row = {
    kind: 'book', slug: tries.find((s) => !used.has(s)) ?? `${base}-${Date.now().toString(36)}`, title: k.title.slice(0, 300), creator: k.creator.slice(0, 200),
    original_title: k.original ?? null, year: k.olKey ? k.year ?? null : null, cover_url: k.cover ?? null, language: lang, ol_key: k.olKey ?? null,
    // our own record when no library has the book: never looked up on Open Library
    source: k.olKey ? 'Open Library' : 'Granthalaya lists', created_by: null,
  };
  const { data, error } = await db.from('titles').insert(row).select('id').single();
  return error || !data ? null : data.id;
}
