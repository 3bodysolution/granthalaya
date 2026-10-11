// The rows of posters on the home page and the Films and Books front pages: what's in each row, where its
// "See all" goes, and (when someone is signed in) which ones are already on their shelf.
import type { SupabaseClient } from '@supabase/supabase-js';
import { trending, discover, type Card } from './tmdb';
import { trendingBooks, browseBooks, type BookCard } from './books';
import { myMarks } from './onsite';

/** one poster in a row; `save` is what the bookmark sends, `status` is set when it's already on your shelf */
export interface RowItem {
  href: string; title: string; year?: number; poster?: string; kind: 'film' | 'tv' | 'book'; sub?: string;
  status?: string; save?: Record<string, unknown>;
}
export interface Row { title: string; href?: string; tone?: 'film' | 'book' | 'essay'; items: RowItem[] }

const daysAgo = (n: number) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
const safe = <T>(p: Promise<T>, empty: T) => p.catch(() => empty);
const MAX = 20;

export const filmItem = (c: Card): RowItem => ({
  href: c.href, title: c.title, year: c.year, poster: c.poster, kind: c.kind,
  save: c.kind === 'film' ? { kind: 'film', tmdbId: c.id, title: c.title, year: c.year, cover: c.poster } : undefined,
});
export const bookItem = (b: BookCard): RowItem => ({
  href: b.href, title: b.title, year: b.year, poster: b.cover, kind: 'book', sub: b.author,
  save: { kind: 'book', olKey: b.key, title: b.title, creator: b.author, year: b.year, cover: b.cover },
});
const films = (cards: Card[]) => cards.filter((c) => c.poster).slice(0, MAX).map(filmItem);
const books = (cards: BookCard[]) => cards.filter((b) => b.cover).slice(0, MAX).map(bookItem);
const list = (p: Promise<{ items: Card[] }>) => safe(p.then((r) => r.items), [] as Card[]);

/** the Films front page (or TV, with kind 'tv') */
export async function filmRows(kind: 'film' | 'tv'): Promise<Row[]> {
  if (kind === 'tv') {
    const [week, fresh, indian, korean, top] = await Promise.all([
      safe(trending('tv'), []),
      list(discover({ kind, streaming: true, since: daysAgo(365) })),
      list(discover({ kind, language: 'hi|mr|ta|te|ml|bn', since: daysAgo(3 * 365) })),
      list(discover({ kind, language: 'ko', genre: 18 })),
      list(discover({ kind, sort: 'top' })),
    ]);
    return [
      { title: 'Popular this week', href: '/films/?kind=tv&sort=popular', tone: 'film', items: films(week) },
      { title: 'New series streaming in India', tone: 'film', items: films(fresh) },
      { title: 'Indian series', href: '/films/?kind=tv&language=hi', tone: 'film', items: films(indian) },
      { title: 'Korean dramas', href: '/films/?kind=tv&language=ko&genre=drama', tone: 'film', items: films(korean) },
      { title: 'Highest rated', href: '/films/?kind=tv&sort=top', tone: 'film', items: films(top) },
    ];
  }
  const [week, fresh, hindi, marathi, south, top] = await Promise.all([
    safe(trending('film'), []),
    list(discover({ kind, streaming: true, since: daysAgo(365) })),
    list(discover({ kind, language: 'hi', since: daysAgo(2 * 365) })),
    list(discover({ kind, language: 'mr', sort: 'top' })),
    list(discover({ kind, language: 'ml|ta|te|kn', since: daysAgo(2 * 365) })),
    list(discover({ kind, sort: 'top' })),
  ]);
  return [
    { title: 'Popular this week', href: '/films/?sort=popular', tone: 'film', items: films(week) },
    { title: 'New on streaming in India', tone: 'film', items: films(fresh) },
    { title: 'New Hindi films', href: '/films/?language=hi', tone: 'film', items: films(hindi) },
    { title: 'Marathi films people love', href: '/films/?language=mr&sort=top', tone: 'film', items: films(marathi) },
    { title: 'New from the south', tone: 'film', items: films(south) },
    { title: 'Highest rated', href: '/films/?sort=top', tone: 'film', items: films(top) },
  ];
}

/** the Books front page */
export async function bookRows(): Promise<Row[]> {
  const pick = (p: Promise<{ items: BookCard[] }>) => safe(p.then((r) => r.items), [] as BookCard[]);
  const [week, fiction, top] = await Promise.all([
    safe(trendingBooks('weekly'), []),
    pick(browseBooks({ subject: 'fiction' })),
    pick(browseBooks({ sort: 'top' })),
  ]);
  return [
    { title: 'Popular this week', href: '/books/?sort=popular', tone: 'book', items: books(week) },
    { title: 'Fiction readers love', href: '/books/?subject=fiction', tone: 'book', items: books(fiction) },
    { title: 'Highest rated', href: '/books/?sort=top', tone: 'book', items: books(top) },
  ];
}

/** the home page: a little of everything */
export async function homeRows(): Promise<Row[]> {
  const [films_, books_, indian, series] = await Promise.all([
    safe(trending('film'), []),
    safe(trendingBooks('weekly'), []),
    list(discover({ kind: 'film', language: 'hi|mr|ml|ta|te|kn|bn', since: daysAgo(540) })),
    safe(trending('tv'), []),
  ]);
  return [
    { title: 'Popular films this week', href: '/films/', tone: 'film', items: films(films_) },
    { title: 'Popular books this week', href: '/books/', tone: 'book', items: books(books_) },
    { title: 'New Indian films', href: '/films/', tone: 'film', items: films(indian) },
    { title: 'Popular series this week', href: '/films/?kind=tv', tone: 'film', items: films(series) },
  ];
}

/** mark what's already on the visitor's shelf (one lookup for every row on the page) */
export async function markRows(sb: SupabaseClient | null | undefined, me: { id: string } | null, rows: Row[]): Promise<Row[]> {
  if (!sb || !me) return rows;
  const keys = rows.flatMap((r) => r.items.map((i) => {
    const s = i.save as any;
    return i.kind === 'book' ? { kind: 'book', ol: s?.olKey } : { kind: i.kind, tmdb: Number(i.href.match(/\/(\d+)-/)?.[1]) };
  })).filter((k) => k.ol || k.tmdb);
  const marks = await myMarks(sb, me, keys).catch(() => new Map<string, string>());
  if (!marks.size) return rows;
  return rows.map((r) => ({
    ...r,
    items: r.items.map((i) => {
      const k = i.kind === 'book' ? `book:${(i.save as any)?.olKey}` : `${i.kind}:${i.href.match(/\/(\d+)-/)?.[1]}`;
      return marks.has(k) ? { ...i, status: marks.get(k) } : i;
    }),
  }));
}
