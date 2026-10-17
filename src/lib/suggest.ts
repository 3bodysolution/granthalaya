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

const PER_RUN = 10;
const ASK = 20;

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
interface Checked { title: string; original?: string; creator: string; year?: number; olKey?: string; cover?: string; via: 'Open Library' | 'Google Books' | 'Wikipedia' }

const prompt = (lang: Lang, skip: string[]) => `You are helping a book website suggest well-regarded ${LANGS[lang]} literature.
List ${ASK} real books originally written in ${LANGS[lang]}: novels, short story collections, memoirs, essays or poetry. Mix older classics and good modern books. Choose books a curious reader would enjoy, not only prize winners.
Only list books you are certain exist, with their real author. If you are not sure, leave it out.
Give each title the way it is usually written in English letters (for example "Yayati"), with the author's name in English letters, and the year it was first published if you know it.
Do not repeat any of these: ${skip.slice(0, 120).join('; ') || 'none yet'}.
Reply with JSON only: {"books": [{"title": "...", "author": "...", "year": 1959}]}`;

async function ask(text: string): Promise<Candidate[]> {
  const gemini = env('GEMINI_API_KEY'), groq = env('GROQ_API_KEY');
  if (!gemini && !groq) throw new Error('no AI key');
  let raw: string;
  try {
    if (!gemini) throw new Error('no Gemini key');
    raw = await askGemini(gemini, env('GEMINI_MODEL'), text, 2);
  } catch (e) {
    if (!groq) throw e;
    raw = await askGroq(groq, env('GROQ_MODEL'), text, 1);
  }
  const list = JSON.parse(raw.replace(/^```(?:json)?|```$/g, '').trim()).books;
  return (Array.isArray(list) ? list : [])
    .filter((b: any) => typeof b?.title === 'string' && typeof b?.author === 'string' && b.title.trim() && b.author.trim())
    .map((b: any) => ({ title: b.title.trim().slice(0, 200), author: b.author.trim().slice(0, 120), year: Number.isInteger(b.year) && b.year > 1000 && b.year < 2100 ? b.year : undefined }));
}

/** Is this a real book? Open Library first, then Google Books, then Wikipedia. */
export async function verify(c: Candidate): Promise<Checked | null> {
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
  const named = await ask(prompt(lang, seen.map((s) => `${s.title} by ${s.creator}`)));
  const fresh = named.filter((c) => !seen.some((s) => sameTitle(s.title, c.title) && hasAuthor(c.author, s.creator)));

  const started = Date.now();
  const kept: Checked[] = [];
  let dropped = 0;
  await inChunks(fresh, 4, async (c) => {
    const ok = await verify(c);
    if (!ok) { dropped++; return; }
    if (kept.length < PER_RUN && !kept.some((k) => sameTitle(k.title, ok.title) && hasAuthor(ok.creator, k.creator))) kept.push(ok);
  }, () => kept.length >= PER_RUN || Date.now() - started > 40_000);

  const added: { title: string; creator: string; via: string }[] = [];
  for (const k of kept) {
    if (!dry) {
      const id = await titleRecord(k, lang);
      if (!id) continue;
      const { error } = await db.from('book_suggestions').insert({ language: lang, title_id: id, checked_with: k.via });
      if (error) continue; // already there (maybe hidden)
    }
    added.push({ title: k.title, creator: k.creator, via: k.via });
  }
  return { language: lang, named: named.length, dropped, added };
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
