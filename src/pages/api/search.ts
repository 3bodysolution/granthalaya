// Search for the top bar.
//   ?q=paterson   films, TV, people (TMDB), books and authors (Open Library, then Google Books), and members here
//   ?u=sarthak    everything on one shelf that the visitor may see (for "On your shelf")
import type { APIRoute } from 'astro';
import { json } from '../../lib/http';
import { loadProfile, loadShelf, href, palette, radius, kind, fullTitle, coverSrc } from '../../lib/data';
import { searchAll } from '../../lib/catalog/tmdb';
import { searchBooks, type BookCard } from '../../lib/catalog/books';
import { searchShopBooks } from '../../lib/catalog/shopbooks';
import { norm, similarity } from '../../lib/fuzzy';
import { nearest, visibleMembers } from '../../lib/catalog/localindex';
import { answerRequest } from '../../lib/catalog/ask';
export const prerender = false;
type Member = { username: string; display_name: string | null; avatar_url: string | null };

export const GET: APIRoute = async ({ locals, url, clientAddress }) => {
  // a request like "best sports movies": the AI turns the words into filters, we find the real results (only the typed words are used,
  // nothing about the visitor). Asked for separately so the normal results never wait for it.
  const ask = (url.searchParams.get('ask') ?? '').trim().slice(0, 100);
  if (ask) {
    let ip: string | undefined;
    try { ip = clientAddress; } catch { ip = undefined; }
    const { answer, how } = await answerRequest(ask, locals.supabase, ip);
    return new Response(JSON.stringify({ answer, how }), { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, max-age=300' } });
  }
  const text = (url.searchParams.get('q') ?? '').trim().slice(0, 100);
  if (text) {
    if (text.length < 2) return json({ titles: [], people: [], books: [], authors: [], members: [] });
    const like = text.replace(/[%_\\,()]/g, ' ').trim();
    // a member's username can hold an underscore, which in a pattern means "any letter" unless it is escaped
    const likeUser = text.replace(/[%\\,()]/g, ' ').trim().replace(/_/g, '\\_');
    const [tm, bk, own, mem, close] = await Promise.all([
      searchAll(text).catch(() => ({ titles: [], people: [], failed: true as boolean | undefined })),
      searchBooks(text).catch(() => ({ books: [], authors: [] })),
      searchShopBooks(locals.supabase, like).catch(() => [] as BookCard[]),
      locals.supabase && like
        ? locals.supabase.from('profiles').select('username, display_name, avatar_url').or(`username.ilike.%${likeUser}%,display_name.ilike.%${like}%`).limit(4)
        : Promise.resolve({ data: [] as Member[] }),
      // the closest of our own titles and members, however it was spelt (kept in memory, so no database call most of the time)
      nearest(text).catch(() => ({ titles: [], members: [] })),
    ]);
    // a member whose username is exactly what was typed comes first
    const exact = (m: Member) => m.username.toLowerCase() === text.toLowerCase();
    const members = [...((mem.data ?? []) as Member[])].sort((a, b) => Number(exact(b)) - Number(exact(a))).map((p) => ({ username: p.username, name: p.display_name || p.username, avatar: p.avatar_url, href: `/@${p.username}/` }));
    // books from the two shops come first (Open Library has few in Marathi and Hindi); a book we already listed is not repeated
    const had = new Set(own.map((b) => b.key));
    const books = [...own, ...bk.books.filter((b) => !had.has(b.key))].slice(0, 8);
    // "Did you mean": our own records closest to what was typed. Shown when nothing else was found, or when one is a very close match that the other results missed.
    const shown = new Set<string>([...tm.titles.map((t: { href: string }) => t.href), ...books.map((b) => b.href), ...(tm.people ?? []).map((p: { href: string }) => p.href), ...bk.authors.map((a: { href: string }) => a.href)]);
    // the same name already among the results (another record of it, or the same one with another address) is not offered again
    const shownTitles = [...tm.titles.map((t: { title: string }) => ({ n: norm(t.title), by: '' })), ...books.map((b) => ({ n: norm(b.title), by: b.author ?? '' }))];
    const already = (t: { title: string; sub: string }) => shownTitles.some((x) => x.n === norm(t.title) && (!x.by || !t.sub || t.sub.split(' | ').some((p) => similarity(x.by, p) >= 0.6)));
    const seenMember = new Set(members.map((m) => m.href));
    const closeMembers = (await visibleMembers(locals.supabase, close.members)).filter((m) => !seenMember.has(m.doc.href));
    const nearAll = [
      ...close.titles.filter((t) => !shown.has(t.doc.href) && !already(t.doc)).map((t) => ({ score: t.score, href: t.doc.href, title: t.doc.title, sub: t.doc.sub, cover: t.doc.cover, kind: t.doc.kind })),
      ...closeMembers.map((m) => ({ score: m.score, href: m.doc.href, title: m.doc.name, sub: `@${m.doc.username}`, cover: m.doc.avatar, kind: 'member' as const })),
    ].sort((a, b) => b.score - a.score);
    const nothing = !tm.titles.length && !books.length && !members.length && !(tm.people ?? []).length && !bk.authors.length;
    const near = nearAll.filter((n, i) => (nothing ? true : n.score >= 0.75 && i < 3)).slice(0, 6).map(({ score, ...n }) => n);
    return new Response(JSON.stringify({ ...tm, ...bk, books, members, near, exactMember: ((mem.data ?? []) as Member[]).some(exact) }), { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, max-age=60' } });
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
