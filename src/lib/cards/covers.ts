// Covers for the cards: the poster is the main thing on a card, so it is fetched carefully.
// · only our own cover sources (TMDB, Open Library, Google Books) and the 20 old covers in /covers;
// · TMDB at the size the card needs (w500, or w342 for a half-size preview; never original, never over w780);
//   Open Library at -L (-M for a preview), following its redirect;
// · a copy is kept for days: in memory here, and, for the web sources, by Vercel's CDN through /api/cover;
// · one retry, then `undefined`: the caller must not hand out a card with a placeholder when the title has a cover.
import { mark } from '../timing';

/** thrown when a title has a cover we could not get in time: no card is made (it would carry a placeholder) */
export class CoverMissing extends Error { constructor() { super('The cover could not be fetched in time'); } }

const DAYS = 3;
const copies = new Map<string, { data: string; at: number }>();
let origin = '';
/** the site's own address (for the old covers and the cover copy route); set by each card route from its request */
export const setOrigin = (o: string) => { origin = o; };

export const coverAllowed = (u: URL) =>
  (u.hostname === 'image.tmdb.org' && /^\/t\/p\/(w\d+|original)\//.test(u.pathname)) ||
  u.hostname === 'covers.openlibrary.org' ||
  (u.hostname === 'books.google.com' && u.pathname.startsWith('/books/content'));

const OLD = /^\/covers\/[\w.-]+\.(jpe?g|png)$/i;

/** the address to fetch for a title's stored cover, sized for the card; null when it is not one of ours */
export function coverAddress(src: string, big: boolean): URL | null {
  try {
    if (OLD.test(src)) return origin ? new URL(src, origin) : null;
    const u = new URL(src);
    if (u.protocol !== 'https:' || !coverAllowed(u)) return null;
    if (u.hostname === 'image.tmdb.org') u.pathname = u.pathname.replace(/\/t\/p\/(w\d+|original)\//, big ? '/t/p/w500/' : '/t/p/w342/');
    if (u.hostname === 'covers.openlibrary.org') u.pathname = u.pathname.replace(/-[SML]\.jpg$/, big ? '-L.jpg' : '-M.jpg');
    return u;
  } catch { return null; }
}

const asData = (b: Buffer) => {
  if (b.length > 4_000_000) return undefined;
  const type = b[0] === 0xff && b[1] === 0xd8 ? 'jpeg' : b[0] === 0x89 && b[1] === 0x50 ? 'png' : undefined;
  return type ? `data:image/${type};base64,${b.toString('base64')}` : undefined;
};

async function get(u: URL | string, ms: number): Promise<string | undefined> {
  try {
    const r = await fetch(u, { signal: AbortSignal.timeout(ms), redirect: 'follow', headers: { 'User-Agent': 'Granthalaya/1.0 (share card)' } });
    return r.ok ? asData(Buffer.from(await r.arrayBuffer())) : undefined;
  } catch { return undefined; }
}

/** a cover as a data address satori can draw; `undefined` when there is none or it could not be had (the caller decides what that means) */
export async function coverData(src?: string, big = true): Promise<string | undefined> {
  if (!src) return undefined;
  const t = performance.now();
  const u = coverAddress(src, big);
  if (!u) { mark('poster', 0, 'not one of ours'); return undefined; }
  const key = u.href;
  const hit = copies.get(key);
  if (hit && Date.now() - hit.at < DAYS * 86400_000) { mark('poster', performance.now() - t, 'memory'); return hit.data; }

  // a web cover: first the CDN's copy (quick when anyone has had this cover lately), then the source itself.
  // an old cover (our own file): the file, twice. Open Library covers hop through archive.org (two redirects) and can take 3 to 4
  // seconds, so they get longer; everything must still finish well inside the share window's 8 seconds.
  const slow = u.hostname === 'covers.openlibrary.org';
  const budget = slow ? 6000 : 5000, first = slow ? 4200 : 2500;
  const web = !OLD.test(src);
  const tries: [string, (ms: number) => Promise<string | undefined>][] = web && origin
    ? [['cdn', (ms) => get(`${origin}/api/cover?u=${encodeURIComponent(key)}`, ms)], ['direct', (ms) => get(u, ms)]]
    : [['direct', (ms) => get(u, ms)], ['direct again', (ms) => get(u, ms)]];
  for (const [i, [how, run]] of tries.entries()) {
    const left = budget - (performance.now() - t);
    if (i && left < 1200) break;
    const data = await run(i ? Math.min(2500, left) : first);
    if (data) {
      copies.set(key, { data, at: Date.now() });
      if (copies.size > 60) copies.delete(copies.keys().next().value!);
      mark('poster', performance.now() - t, how);
      return data;
    }
  }
  mark('poster', performance.now() - t, 'failed');
  return undefined;
}
