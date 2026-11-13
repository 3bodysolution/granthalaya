// How a shelf entry stands on the 3D shelf: its size and the colours of its spine. Same on every visit (sizes come from a hash of the title).
// Colour: the cover's stored colour is matched to the nearest of a vivid painted palette (the main colour), and a second palette colour that
// contrasts with it melts in from about the middle of the spine like a watercolour wash. No teal (that is for actions).
import type { Entry } from './data';

export const hash = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
const lum = (hex: string) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const ratio = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
export const DARK = '#1B1612', LIGHT = '#F6EEDF';
/** dark or light ink, whichever reads better on this colour */
export const inkOn = (bg: string) => (ratio(lum(bg), lum(DARK)) >= ratio(lum(bg), lum(LIGHT)) ? DARK : LIGHT);
export const PAPER = '#F3E9D2';

/** the painted palette: vermilion, cobalt, marigold, violet, emerald, magenta, coral, indigo, orange, leaf, plum, sky, brick, near-black.
 *  Every one has an ink (dark or light) that reads on it at 4.5:1 or better. */
export const VIVID = ['#E4572E', '#2457C5', '#F2A900', '#7B3FBF', '#17724A', '#C2185B', '#F07167', '#3F3D99', '#FF9F1C', '#5BA33B', '#8E3B8E', '#3A9AD9', '#B5332E', '#1B1B1F'];

// sRGB to Lab, to find the palette colour nearest to a cover's colour the way an eye would
const lab = (hex: string): [number, number, number] => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const x = f((0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047), y = f(0.2126 * r + 0.7152 * g + 0.0722 * b), z = f((0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
};
const PLAB = VIVID.map(lab);
/** the palette colour nearest to this colour */
export function nearestVivid(hex: string): string {
  const [l, a, b] = lab(hex);
  let best = 0, d = Infinity;
  PLAB.forEach((p, i) => { const e = (p[0] - l) ** 2 + (p[1] - a) ** 2 + (p[2] - b) ** 2; if (e < d) { d = e; best = i; } });
  return VIVID[best];
}
const hueOf = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  if (!d) return 0;
  const h = mx === r ? ((g - b) / d + 6) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return h * 60;
};
const hueGap = (a: string, b: string) => { const d = Math.abs(hueOf(a) - hueOf(b)); return Math.min(d, 360 - d); };
const reads = (c: string, ink: string) => ratio(lum(c), lum(ink)) >= 4.5;

/** the second colour: from the same palette, unlike the first (another hue, or clearly another lightness), and one the same ink reads on at 4.5:1,
 *  so the title is readable wherever it crosses the wash. The title picks among the fits, so it is the same every visit. */
export function secondOf(main: string, ink: string, seed: number, pool: string[] = VIVID): string {
  const ok = pool.filter((c) => c !== main && reads(c, ink));
  const apart = ok.filter((c) => hueGap(c, main) >= 50 || ratio(lum(c), lum(main)) >= 2);
  const list = apart.length ? apart : ok;
  return list.length ? list[seed % list.length] : main;
}

export interface Spine { kind: 'book' | 'dvd'; w: number; h: number; d: number; color: string; color2: string; wash: number; ink: string; tag: string; text: string; size: number }

/** the title as it is written on the spine: a step smaller on a thin spine, and if it still doesn't fit, whole lines ending in "…".
 *  (A spine's title runs upwards, the lines stack across its width; the estimate is a little cautious.) The full title stays in the button's label and the caption. */
export function fitTitle(title: string, w: number): { text: string; size: number } {
  const HEIGHT = 140, across = w - 2;
  const wrap = (cpl: number) => {
    const lines: string[] = []; let cur = '';
    for (const word of title.split(/\s+/).filter(Boolean)) {
      let rest = word;
      while (rest.length > cpl) { if (cur) { lines.push(cur); cur = ''; } lines.push(rest.slice(0, cpl)); rest = rest.slice(cpl); }
      if (!cur) cur = rest; else if ((cur + ' ' + rest).length <= cpl) cur += ' ' + rest; else { lines.push(cur); cur = rest; }
    }
    if (cur) lines.push(cur);
    return lines;
  };
  let last = { text: title, size: 12 };
  for (const size of [15, 13, 12]) {
    const cpl = Math.floor(HEIGHT / (size * 0.56)), room = Math.max(1, Math.floor(across / (size * 1.08)));
    const lines = wrap(cpl);
    if (lines.length <= room) return { text: title, size };
    const kept = lines.slice(0, room);
    const end = kept[kept.length - 1];
    kept[kept.length - 1] = (end.length >= cpl ? end.slice(0, cpl - 1) : end).replace(/[\s,.:;-]+$/, '') + '…';
    last = { text: kept.join(' '), size };
  }
  return last;
}

/** a DVD case is one fixed size; a book's width follows its page count and its height the title */
export function spineOf(e: Entry): Spine {
  const d = e.data;
  const seed = hash(d.title);
  const wash = 30 + ((seed >>> 3) % 18);   // how far up the second colour reaches, as a percent of the spine
  const stored = d.coverColor && /^#[0-9a-f]{6}$/i.test(d.coverColor) ? d.coverColor : null;
  const main = stored ? nearestVivid(stored) : VIVID[seed % VIVID.length];   // no stored colour yet: the title's own painted one
  const ink = inkOn(main);
  if (d.type === 'film' || d.type === 'tv') {
    return { kind: 'dvd', w: 44, h: 248, d: 168, color: main, color2: secondOf(main, ink, seed >>> 7), wash, ink, tag: d.type === 'tv' ? 'TV' : 'Film', ...fitTitle(d.title, 44) };
  }
  const h = 196 + (seed % 55);
  if (d.type === 'essay') {
    const second = secondOf(PAPER, DARK, seed >>> 7, VIVID.filter((c) => reads(c, DARK)));
    return { kind: 'book', w: 26, h: Math.min(h, 220), d: Math.round(Math.min(h, 220) * 0.66), color: PAPER, color2: second, wash, ink: DARK, tag: 'Essay', ...fitTitle(d.title, 26) };
  }
  const w = Math.max(26, Math.min(54, d.pages ? Math.round(24 + d.pages / 14) : 26 + ((seed >>> 5) % 18)));
  return { kind: 'book', w, h, d: Math.round(h * 0.66), color: main, color2: secondOf(main, ink, seed >>> 7), wash, ink, tag: 'Book', ...fitTitle(d.title, w) };
}
