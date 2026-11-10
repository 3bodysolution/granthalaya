// The numbers behind "2026 so far" on a shelf. Counts finished things only; TV counts with films, a show once.
// Hours and pages only use titles that have a runtime or page count, and say so: nothing is guessed.
import { monthNames, type Entry } from './data';

export type Bucket = 'book' | 'film' | 'essay';
const bucket = (e: Entry): Bucket => (e.data.type === 'tv' ? 'film' : e.data.type) as Bucket;
const yearOf = (e: Entry) => e.data.date.getUTCFullYear();

/** which year to show: the one asked for if it has entries, else this year, else the latest year that has any (named, so it reads as "last year") */
export function pickYear(flat: Entry[], asked: number, now = new Date()) {
  const done = flat.filter((e) => e.data.status === 'done');
  const years = [...new Set(done.map(yearOf))].sort((a, b) => b - a);
  const thisYear = now.getUTCFullYear();
  const year = years.includes(asked) ? asked : years.includes(thisYear) ? thisYear : years[0];
  return { years, year: year as number | undefined, thisYear };
}

export interface Month { name: string; book: number; film: number; essay: number; sum: number; future: boolean }
export interface YearNumbers {
  year: number; total: number; nBooks: number; nEssays: number; nFilms: number; nShows: number;
  months: Month[]; maxMonth: number;
  filmMin: number; filmsKnown: number; filmCount: number; pageSum: number; booksKnown: number; bookCount: number;
  fav?: Entry;
}

export function yearNumbers(flat: Entry[], year: number, now = new Date()): YearNumbers {
  const inYear = flat.filter((e) => e.data.status === 'done' && yearOf(e) === year);
  const end = year === now.getUTCFullYear() ? Date.UTC(year, now.getUTCMonth(), now.getUTCDate()) : Date.UTC(year, 11, 31);
  const months = monthNames.map((name, i) => {
    const from = Date.UTC(year, i, 1), to = Date.UTC(year, i + 1, 1);
    const k = { book: 0, film: 0, essay: 0 };
    for (const e of inYear) { const t = e.data.date.getTime(); if (t >= from && t < to) k[bucket(e)]++; }
    return { name, ...k, sum: k.book + k.film + k.essay, future: from > end };
  });
  const films = inYear.filter((e) => bucket(e) === 'film');
  const books = inYear.filter((e) => e.data.type === 'book');
  const filmsWith = films.filter((e) => e.data.runtime);
  const booksWith = books.filter((e) => e.data.pages);
  const rated = inYear.filter((e) => e.data.rating != null)
    .sort((a, b) => b.data.rating! - a.data.rating! || Number(b.data.loved) - Number(a.data.loved) || b.data.date.getTime() - a.data.date.getTime());
  return {
    year, total: inYear.length,
    nBooks: books.length, nEssays: inYear.filter((e) => e.data.type === 'essay').length,
    nFilms: inYear.filter((e) => e.data.type === 'film').length,
    nShows: new Set(inYear.filter((e) => e.data.type === 'tv').map((e) => e.showId ?? e.data.title)).size,
    months, maxMonth: Math.max(4, ...months.map((m) => m.sum)),
    filmMin: filmsWith.reduce((s, e) => s + e.data.runtime!, 0), filmsKnown: filmsWith.length, filmCount: films.length,
    pageSum: booksWith.reduce((s, e) => s + e.data.pages!, 0), booksKnown: booksWith.length, bookCount: books.length,
    // a favourite is something rated well: with only a 2-star film rated, there is none
    fav: rated[0] && (rated[0].data.rating ?? 0) >= 3.5 ? rated[0] : undefined,
  };
}
