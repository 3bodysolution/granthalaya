// Prize and classics lists: one JSON file each in src/data/lists, matched to the catalogue by scripts/lists/match.mjs.
import { bookHref } from './catalog/books';
import { shownYear } from './catalog/known-years';
import { filmHref } from './catalog/tmdb';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { RowItem } from './catalog/rows';

export interface ListItem {
  year: number; title: string; creator?: string; original_title?: string; language?: string; note?: string;
  pick?: boolean; release_year?: number; circa?: boolean; ol?: string; gb?: string; tmdb?: number; cover?: string;
  /** a book that Open Library and Google Books don't have: our own catalogue record (scripts/lists/make-records.mjs) */
  slug?: string;
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

/** the year on our own record of a book: the year it came out for classics, none for prizes (their year is the prize's) */
export const ownYear = (l: Pick<CatalogList, 'slug'>, i: Pick<ListItem, 'year'>) => (l.slug.endsWith('-classics') ? i.year : undefined);

/** a list item as a poster tile; items we couldn't match have no link or bookmark */
export function listTile(l: CatalogList, i: ListItem): RowItem {
  const film = l.kind === 'film';
  const href = film ? (i.tmdb ? filmHref(i.tmdb, i.title) : '') : i.ol ? bookHref(i.ol, i.title) : i.gb ? bookHref(`gb-${i.gb}`) : i.slug ? `/book/${i.slug}/` : '';
  const shown = film ? i.release_year ?? i.year : i.year;
  const save = !href || (!film && !i.ol && !i.slug) ? undefined : film
    ? { kind: 'film', tmdbId: i.tmdb, title: i.title, year: i.release_year ?? i.year, cover: i.cover }
    : i.slug
      // our own record: saving finds it again by title and author, so it carries no year (the year here is the prize's)
      ? { kind: 'book', title: i.title, creator: i.creator, year: ownYear(l, i), cover: i.cover }
      : { kind: 'book', olKey: i.ol, title: i.title, creator: i.creator, year: i.year, cover: i.cover };
  return {
    href, search: href ? undefined : i.title, title: i.title, poster: i.cover, kind: film ? 'film' : 'book', save,
    year: i.circa || !shown ? undefined : shown,
    sub: [i.circa ? `c. ${shown}` : '', i.creator].filter(Boolean),
  };
}

/**
 * A list file keeps the covers it was matched with; a book it has no cover for may have got one in our catalogue since (a shop's, saved by
 * scripts/lists/list-covers.mjs). Items with no cover of their own take the catalogue record's (found by its slug).
 */
export async function fillCovers(sb: SupabaseClient | null | undefined, list: CatalogList): Promise<CatalogList> {
  const slugs = list.items.filter((i) => !i.cover && i.slug).map((i) => i.slug!);
  if (!sb || !slugs.length) return list;
  const { data } = await sb.from('titles').select('slug, cover_url').in('slug', slugs).not('cover_url', 'is', null);
  const cover = new Map((data ?? []).map((r: { slug: string; cover_url: string }) => [r.slug, r.cover_url]));
  return { ...list, items: list.items.map((i) => (i.slug && !i.cover && cover.has(i.slug) ? { ...i, cover: cover.get(i.slug) } : i)) };
}

/** a list shown in place on the Books or Films page, under the filters (the shareable page is `listHref`) */
export const listBrowseHref = (l: Pick<CatalogList, 'slug' | 'kind'>) => `/${l.kind === 'film' ? 'films' : 'books'}/?list=${l.slug}`;
/** the list in the address, if it exists and belongs on this page */
export const pickList = (slug: string | null | undefined, kind: 'book' | 'film') => {
  const l = slug ? getList(slug) : undefined;
  return l && l.kind === kind ? l : undefined;
};
/** the decades a list has items in, newest first, for the Decade filter */
export const listDecades = (l: CatalogList): [string, string][] =>
  [...new Set(l.items.filter((i) => i.year).map((i) => i.year - (i.year % 10)))].sort((a, b) => b - a).map((d) => [String(d), `${d}s`]);

/**
 * The Marathi and Hindi books suggested each week (lib/suggest.ts): a list like the others, read from the database.
 * Newest suggestions first. Hidden ones are left out by the database itself. Empty until the first run.
 */
export const SUGGESTED = { 'suggested-marathi': ['mr', 'Marathi books to try'], 'suggested-hindi': ['hi', 'Hindi books to try'] } as const;
export async function suggestedLists(sb: SupabaseClient | null | undefined): Promise<CatalogList[]> {
  if (!sb) return [];
  const { data } = await sb.from('book_suggestions').select('language, checked_with, title:titles(slug, title, creator, year, ol_key, cover_url, description, description_source)')
    .order('created_at', { ascending: false }).limit(300);
  return Object.entries(SUGGESTED).map(([slug, [lang, title]]) => ({
    slug, title, kind: 'book' as const,
    intro: `Well-regarded ${title.split(' ')[0]} books, suggested by an AI model each week. Each one is checked against Open Library, Google Books or Wikipedia before it appears.`,
    source: { name: 'Suggested by an AI model, checked against real sources', url: '' },
    items: ((data ?? []) as unknown as { language: string; title: { slug: string; title: string; creator: string | null; year: number | null; ol_key: string | null; cover_url: string | null; description: string | null; description_source: string | null } | null }[]).filter((r) => r.language === lang && r.title).map((r): ListItem => ({
      // the same year the book's page shows (first publication, not a later edition's)
      year: shownYear({ slug: r.title!.slug, ol: r.title!.ol_key }, r.title!.year, r.title!.description, r.title!.description_source) ?? 0, title: r.title!.title, creator: r.title!.creator || undefined, slug: r.title!.slug,
      ol: r.title!.ol_key ?? undefined, cover: r.title!.cover_url ?? undefined,
    })),
  })).filter((l) => l.items.length);
}
