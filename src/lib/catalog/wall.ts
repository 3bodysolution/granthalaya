// The wall of posters and covers at the top of the home page. Picked once a day (the same pick for everyone), kept in the
// memory of the running copy, and served from /api/wall, which Vercel's CDN keeps until the next morning (India time),
// so a visit does not call TMDB or the database. Films are about two thirds from our own film lists (classics, National
// Awards, Palme d'Or, Oscars) and a third from TMDB's weekly trending list, never horror or adult; no title appears twice. Books are the Marathi and Hindi books from the two shops and the list books that have a cover. A book the shop
// hid, or whose cover the shop hid, never comes back from the database, and shop covers only go through /api/cover.
import { createClient } from '@supabase/supabase-js';
import { env, supabaseReady } from '../supabase';
import { timedFetch } from '../timing';
import { tileImage, viaCover, SHOP_COVER } from '../images';
import { trending, filmGenres } from './tmdb';
import { listsOfKind } from '../lists';

/** [kind, src, srcset] for one tile; kind is 'f' (film poster) or 'b' (book cover) */
export type WallTile = ['f' | 'b', string, string | undefined];
export interface Wall { tiles: WallTile[]; day: string; full: boolean }

// 120 tiles at most, every one different: 70% films (about two thirds from our own film lists, a third from this week's trending), 30% books
const TOTAL = 120, FILMS = 84, BOOKS = 36, FROM_LISTS = 56;
const HORROR = 27;
const same = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
const IST = 5.5 * 3600 * 1000;
export const istDay = (now = Date.now()) => new Date(now + IST).toISOString().slice(0, 10);
/** seconds until the next morning in India */
export const untilTomorrow = (now = Date.now()) => Math.max(300, Math.round((Math.floor((now + IST) / 86400000) * 86400000 + 86400000 - (now + IST)) / 1000));

/** the same shuffle for the same day */
function shuffled<T>(list: T[], seed: string): T[] {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 3432918353), h = (h << 13) | (h >>> 19);
  const rnd = () => { h = Math.imul(h ^ (h >>> 16), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); return ((h ^= h >>> 16) >>> 0) / 4294967296; };
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

const bookTile = (url: string): WallTile => SHOP_COVER.test(url)
  ? ['b', viaCover(url, 200), viaCover(url, 200) === viaCover(url, 360) ? undefined : `${viaCover(url, 200)} 1x, ${viaCover(url, 360)} 2x`]
  : (({ src, srcset }) => ['b', src, srcset] as WallTile)(tileImage(url));

/** this week's trending films, without horror */
async function trendingFilms(): Promise<{ id: number; poster: string }[]> {
  const pages = await Promise.all([1, 2, 3].map((p) => trending('film', p).catch(() => [])));
  return pages.flat().filter((c) => c.poster && !c.genres?.includes(HORROR)).map((c) => ({ id: c.id, poster: c.poster! }));
}

/** films from our own film lists, with horror and adult films left out (checked with TMDB; a film TMDB doesn't answer for is left out too) */
async function listFilms(day: string): Promise<{ id: number; poster: string }[]> {
  const pool = shuffled(listsOfKind('film').flatMap((l) => l.items).filter((i) => i.tmdb && i.cover), day + 'l');
  const kept: { id: number; poster: string }[] = [], seen = new Set<number>();
  for (let at = 0; at < pool.length && kept.length < FROM_LISTS; at += 20) {
    const batch = pool.slice(at, at + 20).filter((i) => !seen.has(i.tmdb!) && seen.add(i.tmdb!));
    const info = await Promise.all(batch.map((i) => filmGenres(i.tmdb!).catch(() => null)));
    batch.forEach((i, k) => { const g = info[k]; if (g && !g.adult && !g.genres.includes(HORROR) && kept.length < FROM_LISTS) kept.push({ id: i.tmdb!, poster: i.cover! }); });
  }
  return kept;
}

/** covers of the shops' Marathi and Hindi books, then list books; read without anyone's sign-in, so only what is public */
async function bookCovers(): Promise<{ url: string; title: string }[]> {
  const out: { url: string; title: string }[] = [];
  if (supabaseReady()) {
    const sb = createClient(env('PUBLIC_SUPABASE_URL'), env('PUBLIC_SUPABASE_PUBLISHABLE_KEY'), { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: timedFetch } });
    const { data } = await sb.from('shop_books').select('title:titles(title, cover_url)').eq('hidden', false).eq('cover_hidden', false).limit(1000);
    for (const r of (data ?? []) as unknown as { title: { title: string; cover_url: string | null } | null }[]) if (r.title?.cover_url) out.push({ url: r.title.cover_url, title: r.title.title });
  }
  // list books: their own covers (Open Library, Google Books); a shop's cover is only taken from the database above, where a hide is respected
  for (const l of listsOfKind('book')) for (const i of l.items) if (i.cover && !SHOP_COVER.test(i.cover) && /^https:\/\//.test(i.cover) && (i.language === 'mr' || i.language === 'hi' || /marathi|hindi/.test(l.slug))) out.push({ url: i.cover, title: i.title });
  return out;
}

/** films and books spread evenly: with 30% books, a book comes about every third or fourth tile */
function interleave(films: WallTile[], books: WallTile[]): WallTile[] {
  if (!films.length) return books;
  const n = films.length + books.length, out: WallTile[] = [];
  let f = 0, b = 0;
  for (let i = 0; i < n; i++) {
    const wantBook = b < books.length && (f >= films.length || Math.floor((i + 1) * 0.3) > Math.floor(i * 0.3));
    out.push(wantBook ? books[b++] : films[f++]);
  }
  return out;
}

let kept: { wall: Wall; at: number } | null = null;

export async function loadWall(): Promise<Wall> {
  const day = istDay();
  if (kept && kept.wall.day === day && (kept.wall.full || Date.now() - kept.at < 10 * 60_000)) return kept.wall;
  const [fromLists, fromTrending, covers] = await Promise.all([listFilms(day).catch(() => []), trendingFilms().catch(() => []), bookCovers().catch(() => [])]);
  // about two thirds from the lists, a third from trending; no film twice
  const seenFilm = new Set<number>(), want = Math.round(FILMS / 3);
  const poster = (c: { id: number; poster: string }) => !seenFilm.has(c.id) && seenFilm.add(c.id);
  const lists = fromLists.filter(poster);
  const films = shuffled([...lists, ...shuffled(fromTrending, day + 't').filter(poster).slice(0, lists.length ? want : FILMS)], day + 'f')
    .slice(0, FILMS).map((c): WallTile => { const t = tileImage(c.poster); return ['f', t.src, t.srcset]; });
  // without any film (TMDB is down) the wall is books only; otherwise 30% books, no book twice (by cover or by name)
  const seenBook = new Set<string>();
  const unique = shuffled(covers, day + 'b').filter((b) => { const k = same(b.title); return !seenBook.has(b.url) && !seenBook.has(k) && seenBook.add(b.url) && seenBook.add(k); });
  const books = unique.slice(0, films.length ? Math.min(BOOKS, Math.round(films.length * 3 / 7)) : TOTAL).map((b) => bookTile(b.url));
  const wall: Wall = { tiles: interleave(films, books), day, full: films.length >= 40 && books.length > 0 };
  kept = { wall, at: Date.now() };
  return wall;
}
