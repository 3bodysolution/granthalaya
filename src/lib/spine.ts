// How a shelf entry stands on the 3D shelf: its size and the colour of its spine. Same on every visit (sizes come from a hash of the title).
import type { Entry } from './data';

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
/** painted cloth colours for a spine whose cover colour isn't stored yet: the same title always gets the same one (no teal: that is for actions) */
export const CLOTH = ['#2B3A67', '#8E2F3A', '#4F6B4A', '#A15628', '#5B3A5E', '#8A6A2A', '#33343A', '#5C3F2E', '#3B3F7A', '#46607A', '#5E6034', '#7A4A4A'];

const mix = (hex: string, to: string, f: number) => '#' + [1, 3, 5].map((i) => Math.round(parseInt(hex.slice(i, i + 2), 16) * (1 - f) + parseInt(to.slice(i, i + 2), 16) * f).toString(16).padStart(2, '0')).join('');
/** a spine colour and a text colour that read at 4.5:1 or better: light text on a dark spine, dark on a light one; a middling colour is nudged until it does */
export function fit(bg: string): { bg: string; ink: string } {
  let c = bg;
  for (let i = 0; i < 12; i++) {
    const ink = inkOn(c);
    if (ratio(lum(c), lum(ink)) >= 4.5) return { bg: c, ink };
    c = mix(c, ink === DARK ? '#FFFFFF' : '#000000', 0.12);
  }
  return { bg: c, ink: inkOn(c) };
}

export interface Spine { kind: 'book' | 'dvd'; w: number; h: number; d: number; color: string; ink: string; tag: string }

/** a DVD case is one fixed size; a book's width follows its page count and its height the title */
export function spineOf(e: Entry): Spine {
  const d = e.data;
  const base = d.coverColor && /^#[0-9a-f]{6}$/i.test(d.coverColor) ? d.coverColor : CLOTH[hash(d.title) % CLOTH.length];
  if (d.type === 'film' || d.type === 'tv') {
    const f = fit(base);
    return { kind: 'dvd', w: 44, h: 248, d: 168, color: f.bg, ink: f.ink, tag: d.type === 'tv' ? 'TV' : 'FILM' };
  }
  const h = 196 + (hash(d.title) % 55);
  if (d.type === 'essay') return { kind: 'book', w: 26, h: Math.min(h, 220), d: Math.round(Math.min(h, 220) * 0.66), color: PAPER, ink: DARK, tag: 'E' };
  const w = Math.max(26, Math.min(54, d.pages ? Math.round(24 + d.pages / 14) : 26 + (hash(d.title) >> 5) % 18));
  const f = fit(base);
  return { kind: 'book', w, h, d: Math.round(h * 0.66), color: f.bg, ink: f.ink, tag: 'B' };
}
