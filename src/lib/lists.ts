// Prize and classics lists: one JSON file each in src/data/lists, matched to the catalogue by scripts/lists/match.mjs.
import { bookHref } from './catalog/books';
import { filmHref } from './catalog/tmdb';
import type { RowItem } from './catalog/rows';

export interface ListItem {
  year: number; title: string; creator?: string; original_title?: string; language?: string; note?: string;
  pick?: boolean; release_year?: number; circa?: boolean; ol?: string; gb?: string; tmdb?: number; cover?: string;
}
export interface CatalogList {
  slug: string; title: string; kind: 'book' | 'film'; intro: string; source: { name: string; url: string }; items: ListItem[];
}

const files = import.meta.glob('../data/lists/*.json', { eager: true, import: 'default' }) as Record<string, CatalogList>;
const all = Object.values(files);

export const GROUPS: { name: string; slugs: string[] }[] = [
  { name: 'Book prizes', slugs: ['booker', 'international-booker', 'pulitzer-fiction', 'nobel-literature'] },
  { name: 'Indian book prizes', slugs: ['sahitya-akademi-marathi', 'sahitya-akademi-hindi', 'jnanpith'] },
  { name: 'Film awards', slugs: ['oscar-best-picture', 'palme-dor', 'national-best-feature', 'national-best-marathi'] },
  { name: 'Classics', slugs: ['marathi-classics', 'hindi-classics', 'world-classics', 'indian-cinema-classics'] },
];

export const getList = (slug: string) => all.find((l) => l.slug === slug);
export const listHref = (slug: string) => `/lists/${slug}/`;
export const listsOfKind = (kind: 'book' | 'film') => all.filter((l) => l.kind === kind);
export const isPrize = (l: CatalogList) => !GROUPS[3].slugs.includes(l.slug);

/** a list item as a poster tile; items we couldn't match have no link or bookmark */
export function listTile(l: CatalogList, i: ListItem): RowItem {
  const film = l.kind === 'film';
  const href = film ? (i.tmdb ? filmHref(i.tmdb, i.title) : '') : i.ol ? bookHref(i.ol, i.title) : i.gb ? bookHref(`gb-${i.gb}`) : '';
  const shown = film ? i.release_year ?? i.year : i.year;
  const save = !href || (!film && !i.ol) ? undefined : film
    ? { kind: 'film', tmdbId: i.tmdb, title: i.title, year: i.release_year ?? i.year, cover: i.cover }
    : { kind: 'book', olKey: i.ol, title: i.title, creator: i.creator, year: i.year, cover: i.cover };
  return {
    href, title: i.title, poster: i.cover, kind: film ? 'film' : 'book', save,
    year: i.circa ? undefined : shown,
    sub: [i.circa ? `c. ${shown}` : '', i.creator].filter(Boolean).join(' · ') || undefined,
  };
}
