// Fetching from the outside catalogues (TMDB, Open Library, Google Books), with a time limit and a small
// memory of recent answers, so a busy page doesn't ask the same question twice in a few minutes.
// Server only. The base addresses can be pointed elsewhere for testing (TMDB_API_BASE and friends).
import { env } from '../supabase';
import { mark } from '../timing';

// for the Server-Timing header: which catalogue answered and a short form of the address (no keys)
const source = (url: string) => (url.includes('themoviedb') || url.includes('/3/') ? 'tmdb' : url.includes('openlibrary') ? 'ol' : url.includes('googleapis') ? 'gb' : 'ext');
const shortPath = (url: string) => { try { return new URL(url).pathname.replace(/^\/3\//, '').slice(0, 40); } catch { return ''; } };

export const UA = 'Mozilla/5.0 (compatible; Granthalaya/1.0; +https://granthalaya-sarthak.vercel.app)';
export const base = {
  tmdb: () => env('TMDB_API_BASE') || 'https://api.themoviedb.org/3',
  ol: () => env('OPENLIBRARY_BASE') || 'https://openlibrary.org',
  gb: () => env('GOOGLE_BOOKS_BASE') || 'https://www.googleapis.com/books/v1',
};

type Saved = { at: number; ttl: number; value: unknown };
const memory = new Map<string, Saved>();
const MAX = 400;

/** Open Library (and others) sometimes send letters with the accent as a separate mark ("a" + macron), which
 *  some fonts draw as a loose mark after the letter. Every string we take in is joined up (NFC). */
export function nfc<T>(v: T): T {
  if (typeof v === 'string') return v.normalize('NFC') as T;
  if (Array.isArray(v)) return v.map(nfc) as T;
  if (v && typeof v === 'object') {
    const o: Record<string, unknown> = {};
    for (const k of Object.keys(v)) o[k] = nfc((v as Record<string, unknown>)[k]);
    return o as T;
  }
  return v;
}

/** how a catalogue answered: it has the thing, it says there is no such thing, or it just failed (slow, busy, down, or refused us) */
export type Source = 'ok' | 'notfound' | 'failed';

/** thrown by the page loaders when a source failed (as opposed to saying "not found"), so a page can answer 503 instead of 404 */
export class SourceUnavailable extends Error {
  constructor(what = 'catalogue') { super(`${what} is not answering right now`); }
}

/** JSON from a URL and how it went. Remembered for `ttl` seconds (answers only). A busy answer (429, 5xx) is
 *  asked once more; a timeout is not unless `retry` is set (it would only double the wait), and "not found" (404, 410) is final. */
export async function getJSONResult<T = any>(url: string, { ttl = 3600, ms = 6000, retry = false }: { ttl?: number; ms?: number; retry?: boolean } = {}): Promise<{ data: T | null; state: Source }> {
  const hit = memory.get(url);
  const t0 = performance.now();
  const note = (tries: number, how: string) => mark(source(url), performance.now() - t0, `${shortPath(url)} ${how}${tries > 1 ? ` (${tries} tries)` : ''}`);
  if (hit && Date.now() - hit.at < hit.ttl * 1000) { note(0, 'memory'); return { data: hit.value as T, state: 'ok' }; }
  for (let attempt = 0; attempt < 2; attempt++) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), ms);
    try {
      const r = await fetch(url, { signal: ctl.signal, headers: { 'User-Agent': UA, Accept: 'application/json' } });
      if (!r.ok) {
        if (r.status === 404 || r.status === 410) { note(attempt + 1, String(r.status)); return { data: null, state: 'notfound' }; }
        if (attempt === 0 && (r.status === 429 || r.status >= 500)) { await new Promise((x) => setTimeout(x, 500)); continue; }
        note(attempt + 1, String(r.status));
        return { data: null, state: 'failed' }; // busy, down, or a refused key: not the same as "no such thing"
      }
      const value = nfc(await r.json()) as T;
      if (memory.size >= MAX) memory.delete(memory.keys().next().value!);
      memory.set(url, { at: Date.now(), ttl, value });
      note(attempt + 1, 'ok');
      return { data: value, state: 'ok' };
    } catch {
      if (retry && attempt === 0) continue; // only for answers that decide a whole page
      note(attempt + 1, 'failed');
      return { data: null, state: 'failed' }; // a timeout or a dropped connection: not asked again
    } finally {
      clearTimeout(timer);
    }
  }
  note(2, 'failed');
  return { data: null, state: 'failed' };
}

/** JSON from a URL, or null if it fails, says not found, or takes too long (for things a page can do without) */
export async function getJSON<T = any>(url: string, opts: { ttl?: number; ms?: number } = {}): Promise<T | null> {
  return (await getJSONResult<T>(url, opts)).data;
}

/** the answer that decides a whole page: null only when the source says it doesn't exist; a failure throws SourceUnavailable */
export async function getJSONOrThrow<T = any>(url: string, opts: { ttl?: number; ms?: number } = {}, what?: string): Promise<T | null> {
  const { data, state } = await getJSONResult<T>(url, { ...opts, retry: true }); // a page waits for this, so a timeout is tried once more
  if (state === 'failed') throw new SourceUnavailable(what);
  return data;
}

/** a short, safe address name from any title: "Don't Look Up" → "dont-look-up" */
export const slug = (s: string) =>
  (s ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/['’]/g, '').replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/, '');

/** plain text from catalogue descriptions (they sometimes carry markdown or HTML) */
export function plain(s: unknown, max = 2400): string {
  if (typeof s !== 'string') {
    if (s && typeof s === 'object' && typeof (s as { value?: unknown }).value === 'string') return plain((s as { value: string }).value, max);
    return '';
  }
  let t = s
    .replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n\n').replace(/<[^>]+>/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/\[([^\]]+)\]\[\d+\]/g, '$1').replace(/^\s*\[\d+\]:.*$/gm, '')
    .replace(/[*_]{1,2}([^*_]+)[*_]{1,2}/g, '$1').replace(/^-{3,}[\s\S]*$/m, '')
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim();
  if (t.length > max) t = t.slice(0, max).replace(/\s+\S*$/, '') + '…';
  return t;
}

export const yearOf = (d?: string | null) => (d && /^\d{4}/.test(d) ? +d.slice(0, 4) : undefined);
