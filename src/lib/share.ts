// The words that go with a share: the text sent with the link (WhatsApp, X) and the link preview's title and description.
// Parts we don't have are left out. No em dashes anywhere.
import type { Kind, Status } from './kinds';

export const SITE_DESCRIPTION = 'Keep a shelf of the books, films, shows and essays you love, in a hand-painted library.';

/** short addresses that redirect to the full page: /f/<tmdb id>, /t/<tmdb id>, /b/<key>, /c/<id> */
export function shortPath(t: { kind: Kind; tmdb_id?: number | null; ol_key?: string | null; slug?: string; link?: string | null }): string | null {
  if (t.kind === 'film') return t.tmdb_id ? `/f/${t.tmdb_id}` : null;
  if (t.kind === 'tv') return t.tmdb_id ? `/t/${t.tmdb_id}` : null;
  if (t.kind === 'book') {
    if (t.ol_key) return `/b/${t.ol_key.toLowerCase()}`;
    const gb = t.link?.match(/books\.google\.[a-z.]+\/books\?id=([A-Za-z0-9_-]{6,20})/)?.[1];
    if (gb) return `/b/gb-${gb}`;
    return t.slug ? `/b/${t.slug}` : null;
  }
  return null;
}

/** one line of text: no dashes (people's and the AI's words may carry them), no stray spaces */
export const calm = (s?: string | null) => (s ?? '').replace(/\s*[—–]\s*/g, ', ').replace(/\s+/g, ' ').trim();
/** ★★★★½ for 4.5 */
export const stars = (r?: number | null) => (r == null || r <= 0 ? '' : '★'.repeat(Math.floor(r)) + (r % 1 >= 0.5 ? '½' : ''));
const join = (...parts: (string | undefined | null | false)[]) => parts.filter(Boolean).join(' ');
const watchy = (k: Kind) => k === 'film' || k === 'tv';
const BY = { film: 'directed by', tv: 'created by', book: 'by', essay: 'by' } as Record<Kind, string>;

export interface TitleBits { kind: Kind; title: string; year?: number; creator?: string }
/** "Hope (2026)" for films and shows, "Orbital by Samantha Harvey" for books */
export const nameOf = (t: TitleBits) => watchy(t.kind) ? join(t.title, t.year ? `(${t.year})` : '') : join(t.title, t.creator ? `by ${t.creator}` : '');

/** the text for a title page you are on, or for a title that is not on your shelf: "Hope (2026), directed by Na Hong-jin. {line} {link}" */
export function pageText(t: TitleBits, line: string | undefined, link: string) {
  const who = watchy(t.kind) && t.creator ? `, ${BY[t.kind]} ${t.creator}` : '';
  return join(`${watchy(t.kind) ? join(t.title, t.year ? `(${t.year})` : '') : nameOf(t)}${who}.`, calm(line), link);
}

/** the text for a title on your shelf, by its status */
export function entryText(t: TitleBits, status: Status, rating: number | undefined, line: string | undefined, link: string) {
  const w = watchy(t.kind), name = nameOf(t), l = calm(line);
  if (status === 'done') return join(`${w ? 'Watched' : 'Read'} ${name}${rating ? ` and gave it ${stars(rating)}` : ''}.`, l, link);
  if (status === 'want') return join(`${name} is on my ${w ? 'watch' : 'reading'} list.`, l, link);
  if (status === 'reading' || status === 'watching') return join(`${w ? 'Watching' : 'Reading'} ${name} right now.`, link);
  return pageText(t, line, link);
}

export function yearText(year: number, books: number, films: number, link: string) {
  const parts = [books ? `${books} ${books === 1 ? 'book' : 'books'}` : '', films ? `${films} ${films === 1 ? 'film' : 'films'}` : ''].filter(Boolean);
  const what = [books ? 'books' : '', films ? 'films' : ''].filter(Boolean).join(' and ') || 'books and films';
  return join(`My ${year} in ${what}${parts.length ? `: ${parts.join(' and ')}` : ''}.`, link);
}

export function collectionText(name: string, books: number, films: number, link: string) {
  const n = books + films;
  const what = books && films ? 'books and films' : books ? (books === 1 ? 'book' : 'books') : (films === 1 ? 'film' : 'films');
  return join(`${name}, ${n} ${what} I've put together.`, link);
}

/* ——— link previews (og:title and og:description) ——— */
export interface Og { title: string; description: string }
export const DEFAULT_OG: Og = { title: 'Granthalaya', description: SITE_DESCRIPTION };

export function filmOg(kind: 'film' | 'tv', t: { title: string; year?: number }, line: string | undefined, creators: string): Og {
  return {
    title: join(t.title, t.year ? `(${t.year})` : ''),
    description: join(calm(line) && `${calm(line).replace(/\.$/, '')}.`, creators && `${kind === 'tv' ? 'Created' : 'Directed'} by ${creators}.`, `See where it's streaming in India, and keep it on your shelf.`),
  };
}
export function bookOg(t: { title: string; year?: number }, author: string, line: string | undefined): Og {
  return {
    title: join(t.title, author && `by ${author}`),
    description: join(calm(line) && `${calm(line).replace(/\.$/, '')}.`, t.year && `First published ${t.year}.`, `Read what it's about, and keep it on your shelf.`),
  };
}
/** the first words of a note, without the formatting marks */
export function noteStart(note: string, max = 160) {
  const s = calm(note.replace(/[*_`>#]|\[([^\]]*)\]\([^)]*\)/g, '$1'));
  return s.length > max ? s.slice(0, max - 1).replace(/\s+\S*$/, '') + '…' : s;
}
export function entryOg(name: string, t: TitleBits, status: Status, rating: number | undefined, note: string, line: string | undefined): Og {
  const w = watchy(t.kind);
  const verb = status === 'done' ? (w ? 'watched' : 'read') : status === 'want' ? (w ? 'wants to watch' : 'wants to read')
    : status === 'watching' ? 'is watching' : status === 'reading' ? 'is reading' : 'logged';
  const n = noteStart(note);
  return {
    title: join(`${name} ${verb} ${t.title}`, stars(rating)),
    description: n || join(calm(line) && `${calm(line).replace(/\.$/, '')}.`, `See ${name}'s shelf on Granthalaya.`),
  };
}
export const profileOg = (name: string, books: number, films: number, essays: number): Og => ({
  title: `${name}'s shelf on Granthalaya`,
  description: `${books} ${books === 1 ? 'book' : 'books'}, ${films} ${films === 1 ? 'film' : 'films'} and ${essays} ${essays === 1 ? 'essay' : 'essays'}, kept in a hand-painted library.`,
});
export const yearOg = (name: string, year: number, books: number, films: number, hours: number, favourite?: string): Og => ({
  title: `${name}'s ${year} in books and films`,
  description: join(`${books} ${books === 1 ? 'book' : 'books'}, ${films} ${films === 1 ? 'film' : 'films'}${hours ? ` and about ${hours} ${hours === 1 ? 'hour' : 'hours'} of film` : ''}.`, favourite && `Favourite: ${favourite}.`),
});
export function collectionOg(name: string, by: string, intro: string, titles: number): Og {
  const first = calm(intro.replace(/[*_`>#]|\[([^\]]*)\]\([^)]*\)/g, '$1')).match(/^.*?[.!?](?=\s|$)/)?.[0] ?? calm(intro);
  return { title: `${name}, a collection by ${by}`, description: join(first, `${titles} ${titles === 1 ? 'title' : 'titles'}.`) };
}
