// Everything the search box finds for some typed words: films, TV and people (TMDB), books and authors (Open Library, Google Books, the shops),
// our own essays and stories, and members, as the visitor may see them (the database's privacy and block rules apply, because `sb` is the
// visitor's own client). Used by the dropdown (/api/search?q=) and by the results page (/search/?q=), which asks for more of each (`big`).
import type { SupabaseClient } from '@supabase/supabase-js';
import { searchAll } from './tmdb';
import { searchBooks, type BookCard } from './books';
import { searchShopBooks } from './shopbooks';
import { norm, similarity } from '../fuzzy';
import { nearest, visibleMembers } from './localindex';
import { findEssays } from '../essays';

type Member = { username: string; display_name: string | null; avatar_url: string | null };

export async function searchEverything(sb: SupabaseClient | null | undefined, text: string, opts: { big?: boolean } = {}) {
  const big = !!opts.big, limit = big ? 24 : 8;
  const like = text.replace(/[%_\\,()]/g, ' ').trim();
  // a member's username can hold an underscore, which in a pattern means "any letter" unless it is escaped
  const likeUser = text.replace(/[%\\,()]/g, ' ').trim().replace(/_/g, '\\_');
  const [tm, bk, own, mem, close] = await Promise.all([
    searchAll(text, limit).catch(() => ({ titles: [], people: [], failed: true as boolean | undefined })),
    searchBooks(text, limit).catch(() => ({ books: [], authors: [] })),
    searchShopBooks(sb, like, big ? 24 : 5).catch(() => [] as BookCard[]),
    sb && like
      ? sb.from('profiles').select('username, display_name, avatar_url').or(`username.ilike.%${likeUser}%,display_name.ilike.%${like}%`).limit(big ? 12 : 4)
      : Promise.resolve({ data: [] as Member[] }),
    // the closest of our own titles and members, however it was spelt (kept in memory, so no database call most of the time)
    nearest(text).catch(() => ({ titles: [], members: [] })),
  ]);
  // a member whose username is exactly what was typed comes first
  const exact = (m: Member) => m.username.toLowerCase() === text.toLowerCase();
  const members = [...((mem.data ?? []) as Member[])].sort((a, b) => Number(exact(b)) - Number(exact(a))).map((p) => ({ username: p.username, name: p.display_name || p.username, avatar: p.avatar_url, href: `/@${p.username}/` }));
  // books from the two shops come first (Open Library has few in Marathi and Hindi); a book we already listed is not repeated
  const had = new Set(own.map((b) => b.key));
  const books = [...own, ...bk.books.filter((b) => !had.has(b.key))].slice(0, limit);
  // "Did you mean": our own records closest to what was typed. Shown when nothing else was found, or when one is a very close match that the other results missed.
  const shown = new Set<string>([...tm.titles.map((t: { href: string }) => t.href), ...books.map((b) => b.href), ...(tm.people ?? []).map((p: { href: string }) => p.href), ...bk.authors.map((a: { href: string }) => a.href)]);
  // the same name already among the results (another record of it, or the same one with another address) is not offered again
  const shownTitles = [...tm.titles.map((t: { title: string }) => ({ n: norm(t.title), by: '' })), ...books.map((b) => ({ n: norm(b.title), by: b.author ?? '' }))];
  const already = (t: { title: string; sub: string }) => shownTitles.some((x) => x.n === norm(t.title) && (!x.by || !t.sub || t.sub.split(' | ').some((p) => similarity(x.by, p) >= 0.6)));
  const seenMember = new Set(members.map((m) => m.href));
  const closeMembers = (await visibleMembers(sb, close.members)).filter((m) => !seenMember.has(m.doc.href));
  const nearAll = [
    ...close.titles.filter((t) => !shown.has(t.doc.href) && !already(t.doc)).map((t) => ({ score: t.score, href: t.doc.href, title: t.doc.title, sub: t.doc.sub, cover: t.doc.cover, kind: t.doc.kind })),
    ...closeMembers.map((m) => ({ score: m.score, href: m.doc.href, title: m.doc.name, sub: `@${m.doc.username}`, cover: m.doc.avatar, kind: 'member' as const })),
  ].sort((a, b) => b.score - a.score);
  const nothing = !tm.titles.length && !books.length && !members.length && !(tm.people ?? []).length && !bk.authors.length;
  const near = nearAll.filter((n, i) => (nothing ? true : n.score >= 0.75 && i < 3)).slice(0, 6).map(({ score, ...n }) => n);
  // our own essays, found by their title as written, in Roman letters, or by the writer (they open at the original, in a new tab)
  const essays = findEssays(text, big ? 24 : 4).map((e) => ({ href: e.link, title: e.title, sub: [e.author, e.year].filter(Boolean).join(' | '), tag: e.kind === 'story' ? 'Story' : 'Essay' }));
  return { ...tm, ...bk, books, essays, members, near, exactMember: ((mem.data ?? []) as Member[]).some(exact) };
}
