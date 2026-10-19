// Books and authors: Open Library first (free, open data), Google Books when Open Library doesn't have it.
// Open Library is thin on Marathi and Hindi books, so search tries both, and anyone can add a book by hand.
import { env } from '../supabase';
import { base, getJSON, getJSONOrThrow, plain, slug, yearOf } from './fetch';

/* ——— languages: Open Library uses library (MARC) codes like "mar" and "fre" ——— */
const MARC_TO_ISO: Record<string, string> = {
  fre: 'fra', ger: 'deu', chi: 'zho', dut: 'nld', per: 'fas', cze: 'ces', gre: 'ell', rum: 'ron', arm: 'hye', geo: 'kat',
  bur: 'mya', mac: 'mkd', mao: 'mri', may: 'msa', slo: 'slk', tib: 'bod', wel: 'cym', alb: 'sqi', baq: 'eus', ice: 'isl',
};
const names = new Intl.DisplayNames(['en'], { type: 'language' });
export const bookLanguageName = (code?: string | null) => {
  if (!code) return undefined;
  try { return names.of(MARC_TO_ISO[code] ?? code) ?? code; } catch { return code; }
};
/** the languages people browse books in most here, with Open Library's codes */
export const BOOK_LANGUAGES: [string, string][] = [
  ['mar', 'Marathi'], ['hin', 'Hindi'], ['eng', 'English'], ['ben', 'Bengali'], ['tam', 'Tamil'], ['tel', 'Telugu'],
  ['mal', 'Malayalam'], ['kan', 'Kannada'], ['guj', 'Gujarati'], ['pan', 'Punjabi'], ['urd', 'Urdu'], ['ori', 'Odia'],
  ['asm', 'Assamese'], ['san', 'Sanskrit'], ['jpn', 'Japanese'], ['fre', 'French'], ['ger', 'German'], ['spa', 'Spanish'],
  ['rus', 'Russian'], ['ita', 'Italian'], ['por', 'Portuguese'], ['chi', 'Chinese'], ['kor', 'Korean'], ['ara', 'Arabic'], ['per', 'Persian'],
];

/* ——— addresses ——— */
export const bookHref = (key: string, title = '') => key.startsWith('gb-') ? `/book/${key}/` : `/book/${key.toLowerCase()}${slug(title) ? '-' + slug(title) : ''}/`;
export const authorHref = (key: string, name = '') => `/author/${key.toLowerCase()}${slug(name) ? '-' + slug(name) : ''}/`;
/** "ol45883w-piranesi" → { ol: "OL45883W" }, "gb-1Q7OAAAACAAJ" → { gb: "1Q7OAAAACAAJ" }, anything else → { slug } */
export function bookKey(param: string | undefined): { ol: string } | { gb: string } | { slug: string } | null {
  const p = String(param ?? '');
  let m = p.match(/^(ol\d{1,10}w)(?:-|$)/i);
  if (m) return { ol: m[1].toUpperCase() };
  m = p.match(/^gb-([A-Za-z0-9_-]{6,20})$/);
  if (m) return { gb: m[1] };
  return /^[a-z0-9]+(-[a-z0-9]+)*$/.test(p) ? { slug: p } : null;
}
export const authorKey = (param: string | undefined) => { const m = String(param ?? '').match(/^(ol\d{1,10}a)(?:-|$)/i); return m ? m[1].toUpperCase() : null; };

const cover = (id?: number | null, size: 'S' | 'M' | 'L' = 'L') => (id && id > 0 ? `https://covers.openlibrary.org/b/id/${id}-${size}.jpg` : undefined);
const gbCover = (links?: { thumbnail?: string; smallThumbnail?: string }) => {
  const u = links?.thumbnail ?? links?.smallThumbnail;
  return u ? u.replace(/^http:/, 'https:').replace(/&edge=curl/, '') : undefined;
};

/* ——— shapes ——— */
export interface BookCard { kind: 'book'; key: string; title: string; author?: string; year?: number; cover?: string; href: string }
export interface BookPage {
  kind: 'book'; key: string; title: string; subtitle?: string; authors: { key?: string; name: string; href?: string }[];
  year?: number; pages?: number; languages: { code: string; name: string }[]; subjects: { name: string; slug: string }[];
  description: string; cover?: string; publishers: string[]; editions?: number; readOnline?: string; source: 'Open Library' | 'Google Books';
  sourceLink: string; isbn?: string;
}

// subjects that describe the copy, not the book
const JUNK = /^(accessible book|protected daisy|in library|lending library|large type books|open library staff picks|internet archive wishlist|overdrive|nyt:|new york times|reading level|award:|fiction, general|general|literature|translations into|spanish language materials|long now manual|textbooks?|juvenile works|ficción)/i;
function subjects(list: string[] | undefined) {
  const seen = new Set<string>();
  const out: { name: string; slug: string }[] = [];
  for (const raw of list ?? []) {
    const name = raw.replace(/\s*\(.*?\)\s*/g, ' ').replace(/[,.;]+$/, '').trim();
    const s = slug(name);
    if (!s || s.length < 3 || name.length > 40 || JUNK.test(name) || /--|\d{4}/.test(raw) || seen.has(s)) continue;
    seen.add(s);
    out.push({ name: name[0].toUpperCase() + name.slice(1), slug: s });
    if (out.length >= 10) break;
  }
  return out;
}

/** publisher names worth showing: Open Library has placeholders like "None", "[s.n.]" and stray letters */
function publishers(list: unknown): string[] {
  const out: string[] = [];
  for (const raw of Array.isArray(list) ? list : []) {
    const p = String(raw).trim().replace(/^\[|\]$/g, '');
    if (p.length < 3 || !/[aeiouy]/i.test(p) || /^(none|unknown|n\.?\s?a\.?|s\.\s?n\.?|publisher not identified|self|various)$/i.test(p)) continue;
    if (!out.some((x) => x.toLowerCase() === p.toLowerCase())) out.push(p);
    if (out.length >= 3) break;
  }
  return out;
}
/** a birth or death date only if it has a year in it ("1940", "22 January 1953"), not ".·" */
const lifeDate = (v: unknown) => (typeof v === 'string' && /\d{3,4}/.test(v) ? v.trim().replace(/[\s.,·-]+$/, '') : undefined);

const SEARCH_FIELDS = 'key,title,subtitle,author_name,author_key,first_publish_year,number_of_pages_median,language,subject,cover_i,edition_count,ebook_access,publisher,isbn';
const ol = (path: string) => base.ol() + path;

/** Open Library's cover for a work is whichever edition came first, and that can be a translation (a German Prophet Song).
 *  If it comes from an edition in another language, take an English edition's cover instead. */
async function ownCover(olid: string, title: string, id?: number): Promise<number | undefined> {
  if (!id) return id;
  const eds: any[] = (await getJSON(ol(`/works/${olid}/editions.json?limit=100`), { ttl: 43200, ms: 3000 }))?.entries ?? [];
  const fold = (t: string) => slug(t).replace(/-/g, ' ');
  const t = fold(title);
  const langs = (e: any): string[] => (e.languages ?? []).map((l: any) => String(l.key).replace('/languages/', ''));
  const fine = (e: any) => (langs(e).length ? langs(e).includes('eng') : fold(e.title ?? '').includes(t));
  const mine = eds.find((e) => e.covers?.includes(id));
  if (!mine || fine(mine)) return id;
  return eds.find((e) => fine(e) && e.covers?.some((c: number) => c > 0))?.covers.find((c: number) => c > 0) ?? id;
}

/* ——— one book ——— */
export async function olBook(olid: string): Promise<BookPage | null> {
  const [w, s] = await Promise.all([
    getJSONOrThrow(ol(`/works/${olid}.json`), { ttl: 43200 }, 'Open Library'),
    getJSON(ol(`/search.json?q=${encodeURIComponent(`key:/works/${olid}`)}&fields=${SEARCH_FIELDS}&limit=1`), { ttl: 43200 }),
  ]);
  if (!w?.title) return null;
  const d = s?.docs?.[0] ?? {};
  const authorKeys: string[] = d.author_key ?? (w.authors ?? []).map((a: any) => String(a.author?.key ?? '').replace('/authors/', '')).filter(Boolean);
  let authorNames: string[] = d.author_name ?? [];
  if (!authorNames.length && authorKeys.length) {
    const found = await Promise.all(authorKeys.slice(0, 3).map((k) => getJSON(ol(`/authors/${k}.json`), { ttl: 86400 })));
    authorNames = found.map((a) => a?.name).filter(Boolean);
  }
  const langs = [...new Set<string>(d.language ?? [])].slice(0, 6);
  const coverId = await ownCover(olid, w.title, d.cover_i ?? w.covers?.find((c: number) => c > 0));
  return {
    kind: 'book', key: olid, title: w.title, subtitle: w.subtitle || d.subtitle || undefined,
    authors: authorNames.slice(0, 4).map((name, i) => ({ key: authorKeys[i], name, href: authorKeys[i] ? authorHref(authorKeys[i], name) : undefined })),
    year: d.first_publish_year ?? yearOf(w.first_publish_date?.match(/\d{4}/)?.[0]), pages: d.number_of_pages_median || undefined,
    languages: langs.map((c) => ({ code: c, name: bookLanguageName(c)! })),
    subjects: subjects([...(w.subjects ?? []), ...(d.subject ?? [])]),
    description: plain(w.description, 2000), cover: cover(coverId),
    publishers: publishers(d.publisher), editions: d.edition_count || undefined,
    readOnline: d.ebook_access === 'public' || d.ebook_access === 'borrowable' ? `https://openlibrary.org/works/${olid}` : undefined,
    source: 'Open Library', sourceLink: `https://openlibrary.org/works/${olid}`, isbn: d.isbn?.[0],
  };
}

const gbKey = () => env('GOOGLE_BOOKS_API_KEY');
const gbUrl = (path: string, params: Record<string, string> = {}) => {
  const u = new URL(base.gb() + path);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  if (gbKey()) u.searchParams.set('key', gbKey()!);
  return u.toString();
};
export async function gbBook(id: string): Promise<BookPage | null> {
  const v = await getJSONOrThrow(gbUrl(`/volumes/${encodeURIComponent(id)}`), { ttl: 43200 }, 'Google Books');
  const i = v?.volumeInfo;
  if (!i?.title) return null;
  const lang = i.language as string | undefined;
  return {
    kind: 'book', key: `gb-${id}`, title: i.title, subtitle: i.subtitle || undefined,
    authors: (i.authors ?? []).slice(0, 4).map((name: string) => ({ name })),
    year: yearOf(i.publishedDate), pages: i.pageCount || undefined,
    languages: lang ? [{ code: lang, name: bookLanguageName(lang)! }] : [],
    subjects: subjects((i.categories ?? []).flatMap((c: string) => c.split('/').map((x) => x.trim()))),
    description: plain(i.description, 2000), cover: gbCover(i.imageLinks), publishers: i.publisher ? [i.publisher] : [],
    source: 'Google Books', sourceLink: i.infoLink || `https://books.google.com/books?id=${id}`,
    isbn: (i.industryIdentifiers ?? []).find((x: any) => /ISBN/.test(x.type))?.identifier,
  };
}

/* ——— an author ——— */
export interface AuthorPage { key: string; name: string; bio: string; born?: string; died?: string; photo?: string; wikipedia?: string; books: BookCard[] }
export async function author(olid: string): Promise<AuthorPage | null> {
  const [a, s] = await Promise.all([
    getJSONOrThrow(ol(`/authors/${olid}.json`), { ttl: 86400 }, 'Open Library'),
    getJSON(ol(`/search.json?q=${encodeURIComponent(`author_key:${olid}`)}&sort=editions&fields=${SEARCH_FIELDS}&limit=60`), { ttl: 43200 }),
  ]);
  if (!a?.name) return null;
  const seen = new Set<string>();
  const books = (s?.docs ?? []).map(card).filter((b: BookCard) => {
    const k = slug(b.title);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const wiki = typeof a.wikipedia === 'string' ? a.wikipedia : (a.links ?? []).find((l: any) => /wikipedia\.org/.test(l.url ?? ''))?.url;
  return {
    key: olid, name: a.name, bio: plain(a.bio, 1600), born: lifeDate(a.birth_date), died: lifeDate(a.death_date),
    photo: a.photos?.find((p: number) => p > 0) ? `https://covers.openlibrary.org/a/id/${a.photos.find((p: number) => p > 0)}-L.jpg` : undefined,
    wikipedia: wiki && /^https:\/\/[a-z-]+\.wikipedia\.org\//.test(wiki) ? wiki : undefined, books,
  };
}

/* ——— lists and search ——— */
function card(d: any): BookCard {
  const key = String(d.key ?? '').replace('/works/', '');
  return { kind: 'book', key, title: d.title, author: d.author_name?.[0], year: d.first_publish_year, cover: cover(d.cover_i, 'L'), href: bookHref(key, d.title) };
}
/** what Open Library readers are opening this week: only books with a cover, each title once */
export async function trendingBooks(window: 'daily' | 'weekly' | 'monthly' = 'weekly'): Promise<BookCard[]> {
  const j = await getJSON(ol(`/trending/${window}.json?limit=40`), { ttl: 10800, ms: 8000 });
  const seen = new Set<string>();
  return (j?.works ?? []).map(card).filter((b: BookCard) => {
    const k = slug(b.title);
    if (!b.key || !b.cover || !k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export interface BookFilters { subject?: string; language?: string; year?: number; decade?: number; sort?: 'popular' | 'top' | 'new'; page?: number }
/* Open Library merges the subjects of every edition into the work, so a famous novel with thousands of editions
   is tagged with almost everything (Robinson Crusoe is "poetry"). Three things keep the lists honest:
   subject keys instead of free text, leaving fiction out of non-fiction subjects, and ordering "Popular" by what
   readers log on Open Library rather than by edition count. */
const NON_FICTION = new Set(['poetry', 'drama', 'essays', 'biography', 'autobiography', 'history', 'philosophy', 'psychology', 'self-help', 'science', 'politics', 'religion', 'travel']);
/* A genre needs two independent tags before a book is listed under it: the subject key and the matching shelf category that
   publishers and booksellers give a book (Open Library keeps it as a subject like "Fiction, science fiction, general").
   One tag alone is not enough: stray tags from other editions put Game of Thrones under Science fiction and The Hunger Games
   under Short stories. A shorter list that is right beats a long one that isn't. Only used without a language filter,
   because books in Indian languages don't carry the shelf category. */
const SHELF_CATEGORY: Record<string, string> = {
  'science-fiction': 'fiction, science fiction, general', fantasy: 'fiction, fantasy, general', mystery: 'fiction, mystery & detective, general',
  thriller: 'fiction, thrillers, general', romance: 'fiction, romance, general', horror: 'fiction, horror',
  'historical-fiction': 'fiction, historical, general', 'short-stories': 'fiction, short stories (single author)',
  humor: 'fiction, humorous, general', 'graphic-novels': 'comics & graphic novels, general',
};
/* Factual subjects have no second tag to ask for, so they are kept honest the other way round: a book tagged with a neighbouring
   subject as well (a self-help book is not Philosophy, a biography is not History, the Bible is not History) is left out. */
const NEIGHBOURS: Record<string, string[]> = {
  history: ['biography', 'self_help', 'self-help', 'self-help_techniques', 'religion', 'business', 'philosophy', 'juvenile_literature'],
  biography: ['self_help', 'self-help', 'self-help_techniques', 'religion', 'business', 'history', 'juvenile_literature'],
  autobiography: ['self_help', 'self-help', 'self-help_techniques', 'religion', 'business', 'juvenile_literature'],
  philosophy: ['self_help', 'self-help', 'self-help_techniques', 'business', 'biography', 'religion', 'juvenile_literature'],
  psychology: ['self_help', 'self-help', 'self-help_techniques', 'business', 'biography', 'religion'],
  science: ['self_help', 'self-help', 'self-help_techniques', 'religion', 'biography', 'philosophy', 'juvenile_literature'],
  politics: ['self_help', 'self-help', 'self-help_techniques', 'biography', 'religion', 'juvenile_literature'],
  religion: ['self_help', 'self-help', 'self-help_techniques', 'biography', 'business', 'history'],
  travel: ['romance', 'juvenile_fiction', 'self_help', 'self-help', 'self-help_techniques'],
};
const INDIAN = new Set(['mar', 'hin', 'ben', 'tam', 'tel', 'mal', 'kan', 'guj', 'pan', 'urd', 'ori', 'asm', 'san']);
const ENGLISH_LIT = ['English fiction', 'American fiction', 'English literature', 'American literature', 'English drama', 'English poetry'];

export async function browseBooks(f: BookFilters): Promise<{ items: BookCard[]; total: number; pages: number }> {
  const parts: string[] = [];
  const subject = f.subject?.replace(/[^a-z0-9-]/g, '');
  const code = f.language?.replace(/[^a-z]/g, '');
  if (subject) {
    const key = subject.replace(/-/g, '_');
    parts.push(subject.includes('-') ? `(subject_key:${key} OR subject_key:${subject})` : `subject_key:${key}`);
    if (NON_FICTION.has(subject)) parts.push('-subject_key:fiction');
    if (NEIGHBOURS[subject] && !f.language) parts.push(NEIGHBOURS[subject].map((k) => `-subject_key:${k}`).join(' '));
    if (SHELF_CATEGORY[subject] && !f.language) parts.push(`subject:"${SHELF_CATEGORY[subject]}"`);
  }
  if (code) {
    // Open Library lists a work under every language it has been translated into, so "Marathi" alone brings back
    // Harry Potter. Asking for the language's own literature (and not English or American literature) keeps it
    // to books written in it.
    const name = BOOK_LANGUAGES.find(([c]) => c === code)?.[1];
    parts.push(`language:${code}`);
    // (a Hindi self-help book isn't filed under Hindi literature, so factual subjects skip that part)
    const factual = subject && NON_FICTION.has(subject) && !['poetry', 'drama', 'essays'].includes(subject);
    if (name && code !== 'eng') {
      if (!factual) parts.push(`(${['fiction', 'literature', 'poetry', 'drama', 'essays', 'short stories'].map((k) => `subject:"${name} ${k}"`).join(' OR ')})`);
      parts.push(ENGLISH_LIT.map((k) => `-subject:"${k}"`).join(' '));
    }
  }
  if (f.year) parts.push(`first_publish_year:${f.year}`);
  else if (f.decade) parts.push(`first_publish_year:[${f.decade} TO ${f.decade + 9}]`);
  else if (f.sort === 'new') parts.push(`first_publish_year:[* TO ${new Date().getFullYear()}]`); // some records say 2098
  if (!subject && !code && !f.year && !f.decade) parts.push('subject_key:fiction');
  // few people log Indian-language books or plays on Open Library, so those stay ordered by editions
  const popular = (code && INDIAN.has(code)) || subject === 'drama' ? 'editions' : 'readinglog';
  const sort = f.sort === 'top' ? 'rating' : f.sort === 'new' ? 'new' : popular;
  const page = Math.min(Math.max(f.page ?? 1, 1), 100);
  const run = (q: string) => getJSON(ol(`/search.json?q=${encodeURIComponent(q)}&sort=${sort}&fields=${SEARCH_FIELDS}&limit=48&page=${page}`), { ttl: 21600, ms: 9000 });
  let j = await run(parts.join(' '));
  // a subject from a book page ("mahabharata", "indic-fiction") may not be a subject key: try it as words
  if (subject && j && !j.numFound) j = await run(parts.join(' ').replace(/\(subject_key:[^)]*\)|subject_key:[a-z0-9_]+/, `subject:"${subject.replace(/-/g, ' ')}"`));
  const total = j?.numFound ?? 0;
  // books with a cover first, keeping Open Library's order within each group
  const items: BookCard[] = (j?.docs ?? []).map(card).filter((b: BookCard) => b.key);
  return { items: [...items.filter((b) => b.cover), ...items.filter((b) => !b.cover)], total, pages: Math.ceil(Math.min(total, 3600) / 48) };
}

export async function searchBooks(text: string): Promise<{ books: BookCard[]; authors: { key: string; name: string; href: string; works?: number }[] }> {
  const t = text.trim().slice(0, 100);
  if (!t) return { books: [], authors: [] };
  const [s, a] = await Promise.all([
    getJSON(ol(`/search.json?q=${encodeURIComponent(t)}&fields=${SEARCH_FIELDS}&limit=8`), { ttl: 600 }),
    getJSON(ol(`/search/authors.json?q=${encodeURIComponent(t)}&limit=4`), { ttl: 600 }),
  ]);
  let books: BookCard[] = (s?.docs ?? []).map(card).filter((b: BookCard) => b.key);
  if (books.length < 3) {
    // Open Library is thin on Indian-language books: ask Google Books too
    const g = await getJSON(gbUrl('/volumes', { q: t, maxResults: '8', printType: 'books' }), { ttl: 600 });
    // Google Books pads thin answers with loosely related books, so keep only those whose title or author
    // shares a word with what was typed
    const fold = (x: string) => x.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const words = fold(t).split(/[^\p{L}\p{M}\p{N}]+/u).filter((w) => w.length >= 3);
    const extra = (g?.items ?? []).map((v: any): BookCard | null => {
      const i = v.volumeInfo;
      if (!i?.title || !v.id) return null;
      const hay = fold(`${i.title} ${i.subtitle ?? ''} ${(i.authors ?? []).join(' ')}`);
      if (words.length && !words.some((w) => hay.includes(w))) return null;
      return { kind: 'book', key: `gb-${v.id}`, title: i.title, author: i.authors?.[0], year: yearOf(i.publishedDate), cover: gbCover(i.imageLinks), href: bookHref(`gb-${v.id}`) };
    }).filter(Boolean) as BookCard[];
    const have = new Set(books.map((b) => slug(b.title)));
    books = [...books, ...extra.filter((b) => !have.has(slug(b.title)))];
  }
  const authors = (a?.docs ?? []).filter((x: any) => x.key && x.name && (x.work_count ?? 0) > 0)
    .map((x: any) => ({ key: x.key, name: x.name, href: authorHref(x.key, x.name), works: x.work_count }));
  return { books: books.slice(0, 8), authors: authors.slice(0, 3) };
}
