// Covers for the cards: the poster is the main thing on a card, so it is fetched carefully.
// · only our own cover sources (TMDB, Open Library, Google Books) and the 20 old covers in /covers;
// · TMDB at the size the card needs (w500, or w342 for a half-size preview; never original, never over w780);
//   Open Library at -L (-M for a preview), following its redirect;
// · a copy is kept for days: in memory here, and, for the web sources, by Vercel's CDN through /api/cover;
// · one retry, then `undefined`: the caller must not hand out a card with a placeholder when the title has a cover.
import { waitUntil } from '@vercel/functions';
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
  (u.hostname === 'books.google.com' && u.pathname.startsWith('/books/content')) ||
  // the two bookshops, with their permission: only their own cover folders
  (u.hostname === 'cdn.shopify.com' && u.pathname.startsWith('/s/files/1/0800/1214/9058/')) ||
  (u.hostname === 'www.bookganga.com' && u.pathname.startsWith('/eBooks/Content/images/books/'));

const OLD = /^\/covers\/[\w.-]+\.(jpe?g|png)$/i;

/** the address to fetch for a title's stored cover, sized for the card; null when it is not one of ours */
export function coverAddress(src: string, big: boolean): URL | null {
  try {
    if (OLD.test(src)) return origin ? new URL(src, origin) : null;
    const u = new URL(src);
    if (u.protocol !== 'https:' || !coverAllowed(u)) return null;
    if (u.hostname === 'image.tmdb.org') u.pathname = u.pathname.replace(/\/t\/p\/(w\d+|original)\//, big ? '/t/p/w500/' : '/t/p/w342/');
    if (u.hostname === 'covers.openlibrary.org') u.pathname = u.pathname.replace(/-[SML]\.jpg$/, big ? '-L.jpg' : '-M.jpg');
    if (u.hostname === 'cdn.shopify.com') u.search = `?width=${big ? 700 : 400}`;   // Shopify resizes on request
    return u;
  } catch { return null; }
}

const MAX_BYTES = 4_000_000;
const ARCHIVE = /(^|\.)archive\.org$/;
/** an address we may fetch an image from: a cover source, or (only when reached by a redirect) archive.org, which Open Library hands its covers to */
const allowedHop = (u: URL, hop: number) =>
  u.protocol === 'https:' && !u.username && !u.password && !u.port && (coverAllowed(u) || (hop > 0 && ARCHIVE.test(u.hostname)));

/**
 * Fetch an image safely: only from allowed addresses, redirects followed by hand (at most 4, each one checked, so an allowed site
 * cannot send us somewhere else), only a JPEG or PNG (checked by its first bytes, not just its label), at most 4 MB (counted as it arrives).
 */
export async function safeImage(start: URL | string, ms: number): Promise<{ type: 'image/jpeg' | 'image/png'; body: Buffer } | undefined> {
  try {
    let u = new URL(start);
    const deadline = AbortSignal.timeout(ms);
    for (let hop = 0; hop < 5; hop++) {
      if (!allowedHop(u, hop)) return undefined;
      const r = await fetch(u, { signal: deadline, redirect: 'manual', headers: { 'User-Agent': 'Granthalaya/1.0 (share card)' } });
      if (r.status >= 300 && r.status < 400) {
        const to = r.headers.get('location');
        if (!to) return undefined;
        u = new URL(to, u);
        continue;
      }
      if (!r.ok || !r.body) return undefined;
      if (Number(r.headers.get('content-length') ?? 0) > MAX_BYTES) return undefined;
      const chunks: Uint8Array[] = [];
      let size = 0;
      for await (const c of r.body as unknown as AsyncIterable<Uint8Array>) {
        size += c.length;
        if (size > MAX_BYTES) { return undefined; }
        chunks.push(c);
      }
      const body = Buffer.concat(chunks);
      const type = body[0] === 0xff && body[1] === 0xd8 ? 'image/jpeg' : body[0] === 0x89 && body[1] === 0x50 ? 'image/png' : undefined;
      return type ? { type, body } : undefined;
    }
  } catch { /* too slow, or not an address */ }
  return undefined;
}

async function get(u: URL | string, ms: number): Promise<string | undefined> {
  try {
    const url = new URL(u);
    // our own old covers are plain files on this site; everything else goes through the safe fetch
    if (OLD.test(url.pathname) && origin && url.origin === new URL(origin).origin) {
      const r = await fetch(url, { signal: AbortSignal.timeout(ms) });
      const body = r.ok ? Buffer.from(await r.arrayBuffer()) : null;
      if (!body || body.length > MAX_BYTES) return undefined;
      const type = body[0] === 0xff && body[1] === 0xd8 ? 'jpeg' : body[0] === 0x89 && body[1] === 0x50 ? 'png' : undefined;
      return type ? `data:image/${type};base64,${body.toString('base64')}` : undefined;
    }
    // the copy route on this site answers with an image we already checked
    if (url.pathname === '/api/cover' && origin && url.origin === new URL(origin).origin) {
      const r = await fetch(url, { signal: AbortSignal.timeout(ms) });
      const body = r.ok ? Buffer.from(await r.arrayBuffer()) : null;
      if (!body || body.length > MAX_BYTES) return undefined;
      const type = body[0] === 0xff && body[1] === 0xd8 ? 'jpeg' : body[0] === 0x89 && body[1] === 0x50 ? 'png' : undefined;
      return type ? `data:image/${type};base64,${body.toString('base64')}` : undefined;
    }
    const img = await safeImage(url, ms);
    return img ? `data:${img.type};base64,${img.body.toString('base64')}` : undefined;
  } catch { return undefined; }
}

/** when a title is added or logged: ask for its cover through /api/cover in the background, at both card sizes, so Vercel's CDN
 *  holds it before anyone shares (a cold Open Library cover can take seconds). Nobody waits for it. */
export function warmCover(site: string, src?: string | null) {
  if (!src || OLD.test(src)) return;
  const job = Promise.all([true, false].map(async (big) => {
    const u = coverAddress(src, big);
    if (!u) return;
    const r = await fetch(`${site}/api/cover?u=${encodeURIComponent(u.href)}`, { signal: AbortSignal.timeout(15000) }).catch(() => null);
    await r?.arrayBuffer().catch(() => null);   // read it through, so the CDN keeps a whole copy
  }));
  try { waitUntil(job); } catch { /* not on Vercel: the promise just finishes on its own */ }
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
