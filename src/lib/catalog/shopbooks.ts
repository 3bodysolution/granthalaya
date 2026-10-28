// Books from the two bookshops (Akshardhara and BookGanga, with their permission; scripts/shops): our own records in search
// and the Marathi and Hindi shelves on Books. Read as the visitor: the database shows only matched, unhidden rows.
import type { SupabaseClient } from '@supabase/supabase-js';
import { bookHref, type BookCard } from './books';
import { viaCover } from '../images';
import type { CatalogList, ListItem } from '../lists';

type Joined = { lists: string[]; language: string | null; title: { slug: string; title: string; creator: string | null; year: number | null; ol_key: string | null; cover_url: string | null } | null };
const COLS = 'lists, language, title:titles(slug, title, creator, year, ol_key, cover_url)';

/** the page for one of these books: the Open Library page if it has one, else our own record */
const hrefOf = (t: NonNullable<Joined['title']>) => (t.ol_key ? bookHref(t.ol_key, t.title) : `/book/${t.slug}/`);

export async function searchShopBooks(sb: SupabaseClient | null | undefined, like: string): Promise<BookCard[]> {
  if (!sb || !like) return [];
  const { data } = await sb.from('shop_books').select(COLS)
    .or(`title.ilike.%${like}%,original_title.ilike.%${like}%,author.ilike.%${like}%`).limit(12);
  const seen = new Set<string>();
  return ((data ?? []) as unknown as Joined[]).filter((r) => r.title && !seen.has(r.title.slug) && seen.add(r.title.slug)).slice(0, 5).map((r): BookCard => ({
    kind: 'book', key: r.title!.ol_key ?? r.title!.slug, title: r.title!.title, author: r.title!.creator ?? undefined, year: r.title!.year ?? undefined,
    cover: r.title!.cover_url ? viaCover(r.title!.cover_url, 200) : undefined, href: hrefOf(r.title!),
  }));
}

export const SHOP_LISTS = { 'shop-marathi': ['mr', 'Marathi books', 'mar'], 'shop-hindi': ['hi', 'Hindi books', 'hin'] } as const;
/**
 * The Marathi and Hindi books the two shops list, as lists like the prize lists: most-listed first, with a cover first.
 * They are the first part of the Marathi and Hindi sections on Books (not a section of their own). Empty until scripts/shops has run.
 */
export async function shopLists(sb: SupabaseClient | null | undefined): Promise<CatalogList[]> {
  if (!sb) return [];
  const { data } = await sb.from('shop_books').select(COLS).limit(1000);
  const rows = (data ?? []) as unknown as Joined[];
  return Object.entries(SHOP_LISTS).map(([slug, [lang, title]]) => {
    const seen = new Set<string>();
    const mine = rows.filter((r) => r.language === lang && r.title && !seen.has(r.title.slug) && seen.add(r.title.slug))
      .sort((a, b) => (Number(!!b.title!.cover_url) - Number(!!a.title!.cover_url)) || (b.lists.length - a.lists.length));
    return {
      slug, title, kind: 'book' as const,
      intro: `Popular ${title.split(' ')[0]} books.`,
      source: { name: 'Akshardhara and BookGanga', url: '' },
      items: mine.map((r): ListItem => ({
        year: 0, title: r.title!.title, creator: r.title!.creator || undefined, slug: r.title!.slug,
        ol: r.title!.ol_key ?? undefined, cover: r.title!.cover_url ?? undefined,
      })),
    };
  }).filter((l) => l.items.length);
}
