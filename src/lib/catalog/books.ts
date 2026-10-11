// Books and authors: Open Library first (free, open data), Google Books when Open Library doesn't have it.
// Open Library is thin on Marathi and Hindi books, so search tries both, and anyone can add a book by hand.
import { env } from '../supabase';
import { base, getJSON, plain, slug, yearOf } from './fetch';

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
const gbCover = (links: any) => {
  const u: string | undefined = links?.thumbnail ?? links?.smallThumbnail;
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

/* ——— one book ——— */
export async function olBook(olid: string): Promise<BookPage | null> {
  const [w, s] = await Promise.all([
    getJSON(ol(`/works/${olid}.json`), { ttl: 43200 }),
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
  return {
    kind: 'book', key: olid, title: w.title, subtitle: w.subtitle || d.subtitle || undefined,
    authors: authorNames.slice(0, 4).map((name, i) => ({ key: authorKeys[i], name, href: authorKeys[i] ? authorHref(authorKeys[i], name) : undefined })),
    year: d.first_publish_year ?? yearOf(w.first_publish_date?.match(/\d{4}/)?.[0]), pages: d.number_of_pages_median || undefined,
    languages: langs.map((c) => ({ code: c, name: bookLanguageName(c)! })),
    subjects: subjects([...(w.subjects ?? []), ...(d.subject ?? [])]),
    description: plain(w.description, 2000), cover: cover(d.cover_i ?? w.covers?.find((c: number) => c > 0)),
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
  const v = await getJSON(gbUrl(`/volumes/${encodeURIComponent(id)}`), { ttl: 43200 });
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
    getJSON(ol(`/authors/${olid}.json`), { ttl: 86400 }),
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
export interface BookFilters { subject?: string; language?: string; year?: number; decade?: number; sort?: 'popular' | 'top' | 'new'; page?: number }
export async function browseBooks(f: BookFilters): Promise<{ items: BookCard[]; total: number; pages: number }> {
  const parts: string[] = [];
  if (f.subject) parts.push(`subject:"${f.subject.replace(/-/g, ' ').replace(/"/g, '')}"`);
  if (f.language) {
    // Open Library lists a work under every language it has been translated into, so "Marathi" alone brings back
    // Harry Potter. Asking for the language's own literature subjects as well keeps it to books written in it.
    const code = f.language.replace(/[^a-z]/g, '');
    const name = BOOK_LANGUAGES.find(([c]) => c === code)?.[1];
    parts.push(`language:${code}`);
    if (name && code !== 'eng') parts.push(`(${['fiction', 'literature', 'poetry', 'drama', 'essays', 'short stories'].map((k) => `subject:"${name} ${k}"`).join(' OR ')})`);
  }
  if (f.year) parts.push(`first_publish_year:${f.year}`);
  else if (f.decade) parts.push(`first_publish_year:[${f.decade} TO ${f.decade + 9}]`);
  if (!parts.length) parts.push('subject:fiction');
  const sort = f.sort === 'top' ? 'rating' : f.sort === 'new' ? 'new' : 'editions';
  const page = Math.min(Math.max(f.page ?? 1, 1), 100);
  const j = await getJSON(ol(`/search.json?q=${encodeURIComponent(parts.join(' '))}&sort=${sort}&fields=${SEARCH_FIELDS}&limit=36&page=${page}`), { ttl: 21600, ms: 9000 });
  const total = j?.numFound ?? 0;
  // books with a cover first, keeping Open Library's order within each group
  const items: BookCard[] = (j?.docs ?? []).map(card).filter((b: BookCard) => b.key);
  return { items: [...items.filter((b) => b.cover), ...items.filter((b) => !b.cover)], total, pages: Math.ceil(Math.min(total, 3600) / 36) };
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
    const extra = (g?.items ?? []).map((v: any): BookCard | null => {
      const i = v.volumeInfo;
      if (!i?.title || !v.id) return null;
      return { kind: 'book', key: `gb-${v.id}`, title: i.title, author: i.authors?.[0], year: yearOf(i.publishedDate), cover: gbCover(i.imageLinks), href: bookHref(`gb-${v.id}`) };
    }).filter(Boolean) as BookCard[];
    const have = new Set(books.map((b) => slug(b.title)));
    books = [...books, ...extra.filter((b) => !have.has(slug(b.title)))];
  }
  const authors = (a?.docs ?? []).filter((x: any) => x.key && x.name && (x.work_count ?? 0) > 0)
    .map((x: any) => ({ key: x.key, name: x.name, href: authorHref(x.key, x.name), works: x.work_count }));
  return { books: books.slice(0, 8), authors: authors.slice(0, 3) };
}
