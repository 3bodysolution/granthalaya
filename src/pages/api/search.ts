// Search for the top bar.
//   ?q=paterson   films, TV, people (TMDB), books and authors (Open Library, then Google Books), and members here
//   ?u=sarthak    everything on one shelf that the visitor may see (for "On your shelf")
import type { APIRoute } from 'astro';
import { json } from '../../lib/http';
import { loadProfile, loadShelf, href, palette, radius, kind, fullTitle } from '../../lib/data';
import { searchAll } from '../../lib/catalog/tmdb';
import { searchBooks } from '../../lib/catalog/books';
export const prerender = false;
type Member = { username: string; display_name: string | null; avatar_url: string | null };

export const GET: APIRoute = async ({ locals, url }) => {
  const text = (url.searchParams.get('q') ?? '').trim().slice(0, 100);
  if (text) {
    if (text.length < 2) return json({ titles: [], people: [], books: [], authors: [], members: [] });
    const like = text.replace(/[%_\\,()]/g, ' ').trim();
    const [tm, bk, mem] = await Promise.all([
      searchAll(text).catch(() => ({ titles: [], people: [] })),
      searchBooks(text).catch(() => ({ books: [], authors: [] })),
      locals.supabase && like
        ? locals.supabase.from('profiles').select('username, display_name, avatar_url').or(`username.ilike.%${like}%,display_name.ilike.%${like}%`).limit(4)
        : Promise.resolve({ data: [] as Member[] }),
    ]);
    const members = ((mem.data ?? []) as Member[]).map((p) => ({ username: p.username, name: p.display_name || p.username, avatar: p.avatar_url, href: `/@${p.username}/` }));
    return new Response(JSON.stringify({ ...tm, ...bk, members }), { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, max-age=60' } });
  }
  const u = (url.searchParams.get('u') ?? '').toLowerCase();
  if (!locals.supabase || !u) return json([]);
  const found = await loadProfile(locals.supabase, u);
  if (!found || 'redirect' in found) return json([]);
  const seen = new Set<string>();
  const items = (await loadShelf(locals.supabase, found.profile)).filter((e) => !seen.has(e.id) && seen.add(e.id)).map((e) => ({
    title: fullTitle(e), creator: e.data.creator, kind: kind(e), href: href(e),
    bg: palette(e).bg, r: radius(e), year: String(e.data.year ?? e.data.date.getUTCFullYear()),
  }));
  return json(items);
};
