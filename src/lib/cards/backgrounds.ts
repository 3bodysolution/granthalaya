// Card backgrounds: eleven paintings (src/assets/cards/bg), only the top part of each (1080 wide, 1100 tall: the rest of the
// original is dark), which fades into the card's own dark colour. Each card has one, chosen by the AI (saved on the title) or
// by genre. A card picks one by genre (TMDB's genres for films and shows, subjects for books); the share window can swap it.
// The pictures are loaded one at a time, only when a card needs them.
import type { Entry } from '../data';
import { film, show } from '../catalog/tmdb';
import { olBook, gbBook } from '../catalog/books';

export const BACKGROUNDS = ['cinema', 'fair', 'fields', 'forest', 'fort', 'noir', 'rain', 'reading', 'sea', 'stars', 'wada'] as const;
export type Background = (typeof BACKGROUNDS)[number];
export const isBackground = (s: unknown): s is Background => typeof s === 'string' && (BACKGROUNDS as readonly string[]).includes(s);

const files = import.meta.glob('../../assets/cards/bg/*.jpg', { query: '?inline', import: 'default' }) as Record<string, () => Promise<string>>;
/** how tall the stored part of a painting is, at 1080 wide */
export const PAINT_H = 1100;
/** the painting as a data address (a JPEG, 1080 wide: satori and resvg can't read webp) */
export async function backgroundData(key: Background): Promise<string> {
  const load = files[`../../assets/cards/bg/${key}.jpg`];
  const v = load ? await load() : '';
  return v;
}

/* What each painting stands for. Names are compared in lower case, whole; "drama" and "fiction" are left for last. */
const SPECIFIC: [Background, RegExp][] = [
  ['rain', /^(action|adventure|action & adventure|adventure stories)$/],
  ['noir', /^(thriller|thrillers|crime|mystery|detective and mystery stories|mystery fiction|detective fiction)$/],
  ['forest', /^(horror|fantasy|fantasy fiction|horror fiction|horror tales)$/],
  ['stars', /^(science fiction|sci-fi & fantasy|science|philosophy|religion)$/],
  ['sea', /^(romance|love stories|poetry|travel)$/],
  ['fields', /^(comedy|family|kids|humou?r|self-help|humorous stories)$/],
  ['fort', /^(history|war|war & politics|western|historical fiction|biography|politics)$/],
  ['wada', /^(soap|literary fiction|short stories|memoir)$/],
  ['fair', /^(music|animation|reality|talk|plays|graphic novels|comics & graphic novels)$/],
  ['reading', /^(essays|psychology)$/],
  ['cinema', /^(documentary|news|tv movie)$/],
];
const GENERIC = /^(drama|fiction)$/;

/** the painting for these genres or subjects (in the order the source lists them); `fallback` when nothing matches */
export function backgroundFor(names: string[], fallback: Background): Background {
  const list = names.map((n) => n.toLowerCase().replace(/\s+/g, ' ').trim());
  for (const n of list) for (const [key, re] of SPECIFIC) if (re.test(n)) return key;
  if (list.some((n) => GENERIC.test(n))) return 'wada';
  return fallback;
}

/** the default painting for a shelf entry; never throws */
export async function backgroundOf(e: Entry): Promise<Background> {
  const d = e.data;
  try {
    if (d.type === 'essay') return 'reading';
    if ((d.type === 'film' || d.type === 'tv') && d.tmdbId) {
      const p = d.type === 'film' ? await film(d.tmdbId) : await show(d.tmdbId);
      return backgroundFor((p?.genres ?? []).map((g) => g.name), 'cinema');
    }
    if (d.type === 'book') {
      const gb = d.link?.match(/books\.google\.[a-z.]+\/books\?id=([A-Za-z0-9_-]{6,20})/)?.[1];
      const b = d.olKey ? await olBook(d.olKey) : gb ? await gbBook(gb) : null;
      return backgroundFor((b?.subjects ?? []).map((s) => s.name), 'reading');
    }
  } catch { /* fall through */ }
  return d.type === 'book' ? 'reading' : 'cinema';
}

/** each painting's own dark at its bottom edge, so a tall card continues it without a seam */
const BASE: Record<Background, string> = {
  cinema: '#0f0f14', fair: '#0e0f13', fields: '#111215', forest: '#0e0f13', fort: '#121317', noir: '#0b0c10',
  rain: '#131418', reading: '#161614', sea: '#151517', stars: '#0f1014', wada: '#131417',
};
export const baseColor = (key: Background = 'cinema') => BASE[key];
