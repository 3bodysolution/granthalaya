import { getCollection, type CollectionEntry } from 'astro:content';
import { site } from '../data/site';

export type Entry = CollectionEntry<'library'>;
export type Thread = CollectionEntry<'threads'>;

/* ——— loading ——— */
export async function getEntries(): Promise<Entry[]> {
  const all = await getCollection('library', (e) => !e.data.private);
  return all.sort((a, b) => b.data.date.getTime() - a.data.date.getTime());
}
export async function getThreads(): Promise<Thread[]> {
  const all = await getCollection('threads');
  return all.sort((a, b) => a.data.order - b.data.order);
}
export const href = (e: Entry) => `/library/${e.id}/`;

/* ——— painted cover colours ——— */
const PALETTES = [
  { bg: '#2F4A5C', accent: '#E3AE4A', hill: '#1F3444' },
  { bg: '#6B3A2E', accent: '#D9A066', hill: '#4A271F' },
  { bg: '#4E5B3A', accent: '#C9B37A', hill: '#36402A' },
  { bg: '#3C4E6B', accent: '#B9C7D6', hill: '#2A3850' },
  { bg: '#7A4E5A', accent: '#E8C9A0', hill: '#553540' },
  { bg: '#4E6A3F', accent: '#E6D08A', hill: '#34482A' },
  { bg: '#8A5A2B', accent: '#F0C674', hill: '#5E3C1B' },
  { bg: '#355E6B', accent: '#CFE0C3', hill: '#244650' },
  { bg: '#2E5049', accent: '#D98C6A', hill: '#1F3833' },
  { bg: '#5C4A6E', accent: '#D8B98A', hill: '#3F3250' },
  { bg: '#8C3F3A', accent: '#EBC28E', hill: '#612B27' },
  { bg: '#46525E', accent: '#E0A37A', hill: '#2F3841' },
];
function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function shade(hex: string, f: number) {
  const n = parseInt(hex.slice(1), 16);
  const c = [n >> 16, (n >> 8) & 255, n & 255].map((v) => Math.max(0, Math.min(255, Math.round(v * f))));
  return '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
}
export function palette(e: Entry) {
  const c = e.data.color;
  if (c && /^#[0-9a-f]{6}$/i.test(c)) return { bg: c, accent: '#E6C88A', hill: shade(c, 0.68) };
  return PALETTES[hash(e.data.title) % PALETTES.length];
}
export const radius = (e: Entry) => (e.data.type === 'book' ? '2px 6px 6px 2px' : '6px');

/* ——— words ——— */
export const kind = (e: Entry) => ({ book: 'Book', film: 'Film', essay: 'Essay' })[e.data.type];
export const typeColor = (t: Entry['data']['type']) => ({ book: 'var(--lat)', film: 'var(--sky)', essay: 'var(--moss)' })[t];

export function stars(e: Entry) {
  if (e.data.type === 'essay' && e.data.loved) return '♥ Loved';
  const r = e.data.rating;
  if (r == null) return '';
  return '★'.repeat(Math.floor(r)) + (r % 1 >= 0.5 ? '½' : '');
}
export function starsLabel(e: Entry) {
  if (e.data.type === 'essay' && e.data.loved) return 'Loved';
  return e.data.rating == null ? 'Not rated' : `Rated ${e.data.rating} out of 5`;
}

const M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const D = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const monthNames = M;
export const short = (d: Date) => `${M[d.getUTCMonth()]} ${d.getUTCDate()}`;
export const long = (d: Date) => `${M[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
export const ticketDate = (d: Date) => `${D[d.getUTCDay()]} ${d.getUTCDate()} ${M[d.getUTCMonth()]} ${d.getUTCFullYear()}`.toUpperCase();
export const timesWord = (n: number, verb: 'read' | 'watch') =>
  n <= 1 ? (verb === 'watch' ? 'First watch' : 'Once') : n === 2 ? 'Twice' : `${n} times`;

/* ——— time spent ——— */
export function minutes(e: Entry) {
  const d = e.data;
  if (d.type === 'film') return d.runtime ?? 110;
  if (d.type === 'essay') return Math.max(3, Math.round((d.words ?? 2500) / site.wordsPerMinute));
  const pages = d.pages ?? 250;
  const share = d.status === 'reading' ? (d.progress ?? 0) / 100 : 1;
  return Math.round(pages * site.minutesPerPage * share);
}
export function remaining(e: Entry) {
  if (e.data.type !== 'book' || e.data.status !== 'reading') return 0;
  return Math.round((e.data.pages ?? 250) * site.minutesPerPage) - minutes(e);
}
export function duration(min: number, style: 'clock' | 'words' = 'clock') {
  const h = Math.floor(min / 60), m = Math.round(min % 60);
  if (style === 'words') {
    if (h === 0) return `${m} minutes`;
    return m ? `${h} hour${h > 1 ? 's' : ''} ${m} min` : `${h} hour${h > 1 ? 's' : ''}`;
  }
  return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
}
export const aboutHours = (min: number) => {
  const h = Math.round(min / 60);
  return h <= 1 ? 'about an hour' : `about ${h} hours`;
};

/* ——— the first paragraph of a note, as plain text ——— */
export function excerpt(e: Entry, max = 110) {
  const text = (e.body ?? '').replace(/\s+/g, ' ').replace(/[*_`#>]/g, '').trim();
  if (text.length <= max) return text;
  return text.slice(0, max).replace(/\s+\S*$/, '') + '…';
}

/* ——— threads an entry belongs to ——— */
export function threadsFor(e: Entry, threads: Thread[]) {
  return threads
    .map((t) => ({ t, i: t.data.items.findIndex((x) => x.slug === e.id) }))
    .filter((x) => x.i >= 0)
    .map(({ t, i }) => ({ id: t.id, title: t.data.title, pos: i + 1, of: t.data.items.length, items: t.data.items }));
}
