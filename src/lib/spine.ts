// How a shelf entry stands on the 3D shelf: its size and the colour of its spine. Same on every visit (sizes come from a hash of the title).
import { palette, type Entry } from './data';

export const hash = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
const lum = (hex: string) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const ratio = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
const DARK = '#1B1612', LIGHT = '#F6EEDF';
/** dark or light ink, whichever reads better on this colour */
export const inkOn = (bg: string) => (ratio(lum(bg), lum(DARK)) >= ratio(lum(bg), lum(LIGHT)) ? DARK : LIGHT);
export const PAPER = '#E9E1CE';

export interface Spine { kind: 'book' | 'dvd'; w: number; h: number; d: number; color: string; ink: string; tag: string }

/** a DVD case is one fixed size; a book's width follows its page count and its height the title */
export function spineOf(e: Entry): Spine {
  const d = e.data;
  if (d.type === 'film' || d.type === 'tv') {
    const color = d.coverColor ?? palette(e).bg;
    return { kind: 'dvd', w: 44, h: 248, d: 168, color, ink: inkOn(color), tag: d.type === 'tv' ? 'TV' : 'FILM' };
  }
  const h = 196 + (hash(d.title) % 55);
  if (d.type === 'essay') return { kind: 'book', w: 26, h: Math.min(h, 220), d: Math.round(Math.min(h, 220) * 0.66), color: PAPER, ink: DARK, tag: 'E' };
  const w = Math.max(26, Math.min(54, d.pages ? Math.round(24 + d.pages / 14) : 26 + (hash(d.title) >> 5) % 18));
  const color = d.coverColor ?? palette(e).bg;
  return { kind: 'book', w, h, d: Math.round(h * 0.66), color, ink: inkOn(color), tag: 'B' };
}
