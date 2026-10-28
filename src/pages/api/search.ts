// Search for the top bar.
//   ?q=paterson   films, TV, people (TMDB), books and authors (Open Library, then Google Books), and members here
//   ?u=sarthak    everything on one shelf that the visitor may see (for "On your shelf")
import type { APIRoute } from 'astro';
import { json } from '../../lib/http';
import { loadProfile, loadShelf, href, palette, radius, kind, fullTitle, coverSrc } from '../../lib/data';
import { searchAll } from '../../lib/catalog/tmdb';
import { searchBooks, type BookCard } from '../../lib/catalog/books';
import { searchShopBooks } from '../../lib/catalog/shopbooks';
export const prerender = false;
type Member = { username: string; display_name: string | null; avatar_url: string | null };

export const GET: APIRoute = async ({ locals, url }) => {
  const text = (url.searchParams.get('q') ?? '').trim().slice(0, 100);
  if (text) {
    if (text.length < 2) return json({ titles: [], people: [], books: [], authors: [], members: [] });
    const like = text.replace(/[%_\\,()]/g, ' ').trim();
    // a member's username can hold an underscore, which in a pattern means "any letter" unless it is escaped
    const likeUser = text.replace(/[%\\,()]/g, ' ').trim().replace(/_/g, '\\_');
    const [tm, bk, own, mem] = await Promise.all([
      searchAll(text).catch(() => ({ titles: [], people: [], failed: true as boolean | undefined })),
      searchBooks(text).catch(() => ({ books: [], authors: [] })),
      searchShopBooks(locals.supabase, like).catch(() => [] as BookCard[]),
      locals.supabase && like
        ? locals.supabase.from('profiles').select('username, display_name, avatar_url').or(`username.ilike.%${likeUser}%,display_name.ilike.%${like}%`).limit(4)
        : Promise.resolve({ data: [] as Member[] }),
    ]);
    // a member whose username is exactly what was typed comes first
    const exact = (m: Member) => m.username.toLowerCase() === text.toLowerCase();
    const members = [...((mem.data ?? []) as Member[])].sort((a, b) => Number(exact(b)) - Number(exact(a))).map((p) => ({ username: p.username, name: p.display_name || p.username, avatar: p.avatar_url, href: `/@${p.username}/` }));
    // books from the two shops come first (Open Library has few in Marathi and Hindi); a book we already listed is not repeated
    const had = new Set(own.map((b) => b.key));
    const books = [...own, ...bk.books.filter((b) => !had.has(b.key))].slice(0, 8);
    return new Response(JSON.stringify({ ...tm, ...bk, books, members, exactMember: ((mem.data ?? []) as Member[]).some(exact) }), { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, max-age=60' } });
  }
  const u = (url.searchParams.get('u') ?? '').toLowerCase();
  if (!locals.supabase || !u) return json([]);
  const found = await loadProfile(locals.supabase, u);
  if (!found || 'redirect' in found) return json([]);
  const seen = new Set<string>();
  const items = (await loadShelf(locals.supabase, found.profile)).filter((e) => !seen.has(e.id) && seen.add(e.id)).map((e) => ({
    title: fullTitle(e), creator: e.data.creator, kind: kind(e), href: href(e),
    bg: palette(e).bg, r: radius(e), cover: coverSrc(e) ?? '', year: String(e.data.year ?? e.data.date.getUTCFullYear()),
  }));
  return json(items);
};
