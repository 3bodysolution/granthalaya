// Fetching from the outside catalogues (TMDB, Open Library, Google Books), with a time limit and a small
// memory of recent answers, so a busy page doesn't ask the same question twice in a few minutes.
// Server only. The base addresses can be pointed elsewhere for testing (TMDB_API_BASE and friends).
import { env } from '../supabase';

export const UA = 'Mozilla/5.0 (compatible; Granthalaya/1.0; +https://granthalaya-sarthak.vercel.app)';
export const base = {
  tmdb: () => env('TMDB_API_BASE') || 'https://api.themoviedb.org/3',
  ol: () => env('OPENLIBRARY_BASE') || 'https://openlibrary.org',
  gb: () => env('GOOGLE_BOOKS_BASE') || 'https://www.googleapis.com/books/v1',
};

type Saved = { at: number; ttl: number; value: unknown };
const memory = new Map<string, Saved>();
const MAX = 400;

/** JSON from a URL, or null if it fails or takes too long. Remembered for `ttl` seconds. */
export async function getJSON<T = any>(url: string, { ttl = 3600, ms = 6000 }: { ttl?: number; ms?: number } = {}): Promise<T | null> {
  const hit = memory.get(url);
  if (hit && Date.now() - hit.at < hit.ttl * 1000) return hit.value as T;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctl.signal, headers: { 'User-Agent': UA, Accept: 'application/json' } });
    if (!r.ok) return null;
    const value = (await r.json()) as T;
    if (memory.size >= MAX) memory.delete(memory.keys().next().value!);
    memory.set(url, { at: Date.now(), ttl, value });
    return value;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** a short, safe address name from any title: "Don't Look Up" → "dont-look-up" */
export const slug = (s: string) =>
  (s ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/['’]/g, '').replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/, '');

/** plain text from catalogue descriptions (they sometimes carry markdown or HTML) */
export function plain(s: unknown, max = 2400): string {
  if (typeof s !== 'string') {
    if (s && typeof s === 'object' && typeof (s as any).value === 'string') return plain((s as any).value, max);
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
