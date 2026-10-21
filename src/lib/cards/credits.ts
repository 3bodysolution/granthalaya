// Who made it, as one short phrase for cards: "Lana and Lilly Wachowski", "A, B and others".
import { film, show } from '../catalog/tmdb';
import { olBook, gbBook } from '../catalog/books';
import type { Entry } from '../data';

/** one name; two names ("Lana and Lilly Wachowski" when they share a last name); three or more: the first two and others */
export function credit(names: (string | undefined | null)[]): string {
  const list = [...new Set(names.map((n) => (n ?? '').trim()).filter(Boolean))];
  if (list.length <= 1) return list[0] ?? '';
  const [a, b] = list;
  if (list.length === 2) {
    const [fa, ...ra] = a.split(' '), [fb, ...rb] = b.split(' ');
    if (ra.length && ra.join(' ') === rb.join(' ')) return `${fa} and ${b}`;
    return `${a} and ${b}`;
  }
  return `${a}, ${b} and others`;
}

/** all the directors, creators or authors of an entry's title (the catalogue row only keeps the first); never throws */
export async function creditFor(e: Entry): Promise<string> {
  const d = e.data;
  try {
    if (d.type === 'film' && d.tmdbId) { const f = await film(d.tmdbId); if (f?.directors.length) return credit(f.directors.map((p) => p.name)); }
    if (d.type === 'tv' && d.tmdbId) { const s = await show(d.tmdbId); if (s?.creators.length) return credit(s.creators.map((p) => p.name)); }
    if (d.type === 'book') {
      const gb = d.link?.match(/books\.google\.[a-z.]+\/books\?id=([A-Za-z0-9_-]{6,20})/)?.[1];
      const b = d.olKey ? await olBook(d.olKey) : gb ? await gbBook(gb) : null;
      if (b?.authors.length) return credit(b.authors.map((a) => a.name));
    }
  } catch { /* fall back to the one name we have */ }
  return d.creator;
}
