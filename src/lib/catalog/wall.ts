// The wall of posters and covers at the top of the home page. Picked once a day (the same pick for everyone) and kept in the
// memory of the running copy, so most visits do not call TMDB or the database; the home page draws it straight into its HTML. Films are about two thirds from our own film lists (classics, National
// Awards, Palme d'Or, Oscars) and a third from TMDB's weekly trending list, never horror or adult; no title appears twice. Books are the Marathi and Hindi books from the two shops and the list books that have a cover. A book the shop
// hid, or whose cover the shop hid, never comes back from the database, and shop covers only go through /api/cover.
import { createClient } from '@supabase/supabase-js';
import { env, supabaseReady } from '../supabase';
import { timedFetch } from '../timing';
import { tileImage, viaCover, SHOP_COVER } from '../images';
import { trending } from './tmdb';
import { waitUntil } from '@vercel/functions';
import { site } from '../../data/site';
import skip from '../../data/wall-skip.json';
import savedLines from '../../data/wall-lines.json';
import { listsOfKind, listTile, ownYear } from '../lists';

/** what a tile says about itself when it is touched: title, year, director or author, its page, what saving it needs, and the saved card line (`l`); `k` finds the line */
export interface Meta { t: string; y?: number; c?: string; h: string; s?: Record<string, unknown>; l?: string; k?: string }
/** [kind, src, srcset, meta] for one tile; kind is 'f' (film poster) or 'b' (book cover) */
export type WallTile = ['f' | 'b', string, string | undefined, Meta];
interface Pic { url: string; title: string; meta: Meta }
export interface Wall { tiles: WallTile[]; day: string; full: boolean }

// 4 rows of 24, every tile different: 80% films (about two thirds from our own film lists, a third from this week's trending), 30% books
export const ROWS = 4, PER_ROW = 24;
const TOTAL = ROWS * PER_ROW, FILMS = Math.round(TOTAL * 0.8), BOOKS = TOTAL - FILMS, FROM_LISTS = Math.round(FILMS * 2 / 3);
const HORROR = 27;
// list films that are horror or adult (scripts/lists/wall-skip.mjs), so the pick never has to ask TMDB about them
const SKIP = new Set<number>(skip as number[]);
// TMDB's own one-line taglines of the list films (same script); a cover with a line can turn over to show it
const LINES = savedLines as Record<string, string>;
const okLine = (l?: string) => (l && l.length >= 12 && !l.startsWith('.') && !/(\.\.\.|…)$/.test(l) ? l : undefined);
/** a source that is slow gives nothing rather than holding up the page */
const within = <T>(p: Promise<T>, ms: number, none: T): Promise<T> => Promise.race([p.catch(() => none), new Promise<T>((r) => setTimeout(() => r(none), ms))]);
const same = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
const IST = 5.5 * 3600 * 1000;
export const istDay = (now = Date.now()) => new Date(now + IST).toISOString().slice(0, 10);
/** the same shuffle for the same day */
function shuffled<T>(list: T[], seed: string): T[] {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 3432918353), h = (h << 13) | (h >>> 19);
  const rnd = () => { h = Math.imul(h ^ (h >>> 16), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); return ((h ^= h >>> 16) >>> 0) / 4294967296; };
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

/** the smallest picture that looks sharp in a tile (a tile is about 76 to 104 pixels wide) */
const posterTile = (p: Pic): WallTile => {
  const t = p.url.match(/^(https:\/\/image\.tmdb\.org\/t\/p\/)w\d+(\/.+)$/);
  return t ? ['f', `${t[1]}w154${t[2]}`, `${t[1]}w154${t[2]} 1x, ${t[1]}w185${t[2]} 2x`, p.meta] : ['f', p.url, undefined, p.meta];
};
const bookTile = (p: Pic): WallTile => ['b', SHOP_COVER.test(p.url) ? viaCover(p.url, 200) : tileImage(p.url).src, undefined, p.meta];

/** this week's trending films, without horror */
async function trendingFilms(): Promise<Pic[]> {
  const pages = await Promise.all([1, 2, 3].map((p) => trending('film', p).catch(() => [])));
  return pages.flat().filter((c) => c.poster && !c.genres?.includes(HORROR)).map((c) => ({
    url: c.poster!, title: c.title, meta: { t: c.title, y: c.year, h: c.href, k: `f:${c.id}`, s: { kind: 'film', tmdbId: c.id, title: c.title, year: c.year, cover: c.poster } },
  }));
}

/** how much of the film part each list gives; the Marathi list is kept small because its posters can read as book covers at a glance */
const LIST_SHARE: Record<string, number> = { 'oscar-best-picture': 0.3, 'palme-dor': 0.15, 'indian-cinema-classics': 0.2, 'national-best-feature': 0.2, 'national-best-marathi': 0.15 };

/** films from our own film lists: the TMDB id and poster saved in the list files, minus horror and adult ones, a share from each list */
function listFilms(day: string, count: number): Pic[] {
  const seen = new Set<number>(), picked: Pic[] = [], rest: Pic[] = [];
  for (const l of listsOfKind('film')) {
    const own = shuffled(l.items, day + l.slug).filter((i) => i.tmdb && i.cover && !SKIP.has(i.tmdb) && !seen.has(i.tmdb) && seen.add(i.tmdb)).map((i): Pic => {
      const r = listTile(l, i);
      return { url: i.cover!, title: i.title, meta: { t: i.title, y: r.year, c: i.creator, h: r.href, s: r.save, k: `f:${i.tmdb}`, l: okLine(LINES[i.tmdb!]) } };
    });
    const take = Math.round(count * (LIST_SHARE[l.slug] ?? 0.1));
    picked.push(...own.slice(0, take)); rest.push(...own.slice(take));
  }
  // a list that is short, or one with no share, leaves room that the others fill
  return [...picked, ...shuffled(rest, day + 'r')].slice(0, count);
}

/** the shops' Marathi and Hindi books, then list books; read without anyone's sign-in, so only what is public */
async function bookCovers(): Promise<Pic[]> {
  const out: Pic[] = [];
  if (supabaseReady()) {
    const sb = createClient(env('PUBLIC_SUPABASE_URL'), env('PUBLIC_SUPABASE_PUBLISHABLE_KEY'), { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: timedFetch } });
    const { data } = await sb.from('shop_books').select('title:titles(title, creator, year, slug, cover_url)').eq('hidden', false).eq('cover_hidden', false).limit(1000);
    type Row = { title: { title: string; creator: string; year: number | null; slug: string; cover_url: string | null } | null };
    for (const { title: t } of (data ?? []) as unknown as Row[]) if (t?.cover_url) {
      out.push({ url: t.cover_url, title: t.title, meta: { t: t.title, y: t.year ?? undefined, c: t.creator || undefined, h: `/book/${t.slug}/`, k: `s:${t.slug}`, s: { kind: 'book', title: t.title, creator: t.creator || undefined, year: t.year ?? undefined, cover: t.cover_url } } });
    }
  }
  // list books: their own covers (Open Library, Google Books); a shop's cover is only taken from the database above, where a hide is respected
  for (const l of listsOfKind('book')) for (const i of l.items) {
    if (!i.cover || SHOP_COVER.test(i.cover) || !/^https:\/\//.test(i.cover) || !(i.language === 'mr' || i.language === 'hi' || /marathi|hindi/.test(l.slug))) continue;
    const r = listTile(l, i);
    if (!r.href) continue;
    out.push({ url: i.cover, title: i.title, meta: { t: i.title, y: ownYear(l, i), c: i.creator, h: r.href, s: r.save, k: i.ol ? `o:${i.ol}` : i.slug ? `s:${i.slug}` : undefined } });
  }
  return out;
}

// The line on the back of a cover is only ever a real one: TMDB's own tagline (saved for the list films in wall-lines.json) or the tagline of a
// site owner's own public review (never a spoiler, never another member's: those aren't moderated before they reach the home page).
// `titles.tagline` is not used, because it can be written by an AI. A cover with neither shows its title, year and director or author on the back instead.
let reviewLines: { at: number; byKey: Map<string, string> } | null = null;
async function reviewTaglines(): Promise<Map<string, string>> {
  if (reviewLines && Date.now() - reviewLines.at < 3600_000) return reviewLines.byKey;
  const byKey = new Map<string, string>();
  if (supabaseReady()) {
    const sb = createClient(env('PUBLIC_SUPABASE_URL'), env('PUBLIC_SUPABASE_PUBLISHABLE_KEY'), { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: timedFetch } });
    // read as nobody, so only what the database shows to everyone, and only from the site owner's own shelf
    const { data } = await sb.from('logs').select('tagline, title:titles(kind, tmdb_id, ol_key, slug), owner:profiles!logs_user_id_fkey!inner(username)').eq('owner.username', site.founder).neq('tagline', '').eq('spoiler', false).order('created_at', { ascending: false }).limit(500);
    type Row = { tagline: string; title: { kind: string; tmdb_id: number | null; ol_key: string | null; slug: string } | null };
    for (const { tagline, title: t } of (data ?? []) as unknown as Row[]) {
      if (!t || !tagline.trim()) continue;
      const key = t.kind === 'film' && t.tmdb_id ? `f:${t.tmdb_id}` : t.ol_key ? `o:${t.ol_key}` : `s:${t.slug}`;
      if (!byKey.has(key)) byKey.set(key, tagline.trim());
    }
  }
  reviewLines = { at: Date.now(), byKey };
  return byKey;
}
async function addLines(tiles: WallTile[]): Promise<void> {
  const byKey = await reviewTaglines();
  for (const t of tiles) { const r = t[3].k ? byKey.get(t[3].k) : undefined; if (r) t[3] = { ...t[3], l: r }; }
}

/** films and books spread evenly: with 20% books, a book comes about every fifth tile */
function interleave(films: WallTile[], books: WallTile[]): WallTile[] {
  if (!films.length) return books;
  const n = films.length + books.length, share = books.length / n, out: WallTile[] = [];
  let f = 0, b = 0;
  for (let i = 0; i < n; i++) {
    const wantBook = b < books.length && (f >= films.length || Math.floor((i + 1) * share) > Math.floor(i * share));
    out.push(wantBook ? books[b++] : films[f++]);
  }
  return out;
}

/** the wall from what is at hand: list films, trending films if there are any, and books */
function build(day: string, fromTrending: Pic[], covers: Pic[]): Wall {
  // about two thirds from the lists and a third from trending; with no trending, list films fill the rest. No film twice
  const seenFilm = new Set<string>();
  const poster = (c: Pic) => !seenFilm.has(c.meta.k!) && seenFilm.add(c.meta.k!);
  const trend = shuffled(fromTrending, day + 't').slice(0, FILMS - FROM_LISTS);
  const lists = listFilms(day, FILMS - trend.length).filter(poster);
  const films = shuffled([...lists, ...trend.filter(poster)], day + 'f').slice(0, FILMS).map(posterTile);
  // 20% books, no book twice (by cover or by name)
  const seenBook = new Set<string>();
  const unique = shuffled(covers, day + 'b').filter((b) => { const k = same(b.title); return !seenBook.has(b.url) && !seenBook.has(k) && seenBook.add(b.url) && seenBook.add(k); });
  const books = unique.slice(0, films.length ? Math.min(BOOKS, Math.round(films.length / 4)) : TOTAL).map(bookTile);
  return { tiles: interleave(films, books), day, full: fromTrending.length > 0 && films.length >= 40 && books.length > 0 };
}

let kept: Wall | null = null;                               // today's full pick
let books: { day: string; covers: { url: string; title: string }[]; at: number } | null = null;
let trying: Promise<void> | null = null, triedAt = 0;

async function booksToday(day: string) {
  if (!books || books.day !== day || (!books.covers.length && Date.now() - books.at > 5 * 60_000)) {
    books = { day, covers: await within(bookCovers(), 1500, []), at: Date.now() };
  }
  return books.covers;
}

/**
 * Today's wall, without ever waiting for TMDB. When the full pick (with this week's trending films) isn't made yet, the wall is built
 * at once from list films and books, and the trending films are fetched in the background (waitUntil) for the next visitor.
 */
export async function loadWall(): Promise<Wall> {
  const day = istDay();
  if (kept?.day === day) return kept;
  const covers = await booksToday(day);
  if (!trying && Date.now() - triedAt > 5 * 60_000) {
    triedAt = Date.now();
    trying = (async () => {
      const trend = await within(trendingFilms(), 4000, []);
      const wall = build(day, trend, books?.day === day ? books.covers : covers);
      await within(addLines(wall.tiles), 3000, undefined);
      if (wall.full) kept = wall;
    })().catch(() => {}).finally(() => { trying = null; });
    try { waitUntil(trying); } catch { /* not on Vercel: the promise just finishes on its own */ }
  }
  const wall = build(day, [], covers);
  await within(addLines(wall.tiles), 1200, undefined);
  return wall;
}
