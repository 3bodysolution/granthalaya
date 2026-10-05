// The one door to the data. Pages read shelves, profiles and threads only through this file.
// Everything comes from the database through the visitor's own connection, so the database's
// privacy rules (private accounts, "Only me" entries, blocks) always apply.
import type { SupabaseClient } from '@supabase/supabase-js';
import { site } from '../data/site';
import { kindName, kindColor, type Kind, type Status } from './kinds';

/* ——— shapes ——— */
export interface Profile {
  id: string; username: string; display_name: string; avatar_url: string | null;
  is_private: boolean; featured: boolean; is_admin: boolean; username_changed_at: string | null; created_at: string;
}
export interface Details {
  id: string; bio: string; season_line: string; lotw_text: string; lotw_by: string; lotw_source: string;
  goal_books: number | null; links: Record<string, string>; favourites: string[];
}
export interface Title {
  id: string; kind: Kind; slug: string; title: string; creator: string; year: number | null; season: number | null;
  episodes: number | null; runtime: number | null; pages: number | null; words: number | null; cover_url: string | null;
  link: string | null; source: string | null; tmdb_id: number | null; ol_key: string | null; trivia: string[];
  trivia_source: string | null; color: string | null;
}
interface HighlightRow { id: string; body: string; where_at: string; note: string; mine: boolean; position: number }
interface LogRow {
  id: string; user_id: string; title_id: string; status: Status; rating: number | null; loved: boolean;
  started_on: string | null; finished_on: string | null; logged_on: string; again: boolean; notes: string;
  where_seen: string; only_me: boolean; created_at: string; title: Title; highlights: HighlightRow[];
}

/** One thing on someone's shelf: a visit to a title. Shaped like the old markdown entries so the
 *  covers, tiles and pages kept working when the library moved into the database. */
export interface Entry {
  id: string;        // the title's address name, e.g. "paterson"
  logId: string;
  titleId: string;
  owner: string;     // the shelf's username
  body: string;      // your notes
  data: {
    title: string; type: Kind; creator: string; year?: number; season?: number; episodes?: number;
    date: Date; started?: Date; finished?: Date; status: Status; rating?: number; loved: boolean;
    runtime?: number; pages?: number; words?: number; link?: string; source?: string; where?: string;
    again: boolean; times: number; color?: string; cover?: string; private: boolean;
    trivia: string[]; triviaSource?: string;
    highlights: { id: string; text: string; where?: string; note?: string; mine: boolean }[];
  };
}
export interface Thread {
  id: string;        // address name
  uuid: string;
  owner: string;
  body: string;      // the intro
  data: { title: string; order: number; items: { slug: string; why: string }[] };
}

const day = (s?: string | null) => (s ? new Date(`${s}T00:00:00Z`) : undefined);
const opt = <T,>(v: T | null | undefined) => (v === null || v === undefined || v === '' ? undefined : v);

function toEntry(r: LogRow, owner: string): Entry {
  const t = r.title;
  return {
    id: t.slug, logId: r.id, titleId: t.id, owner, body: r.notes ?? '',
    data: {
      title: t.title, type: t.kind, creator: t.creator, year: opt(t.year), season: opt(t.season), episodes: opt(t.episodes),
      date: day(r.logged_on)!, started: day(r.started_on), finished: day(r.finished_on), status: r.status,
      rating: r.rating == null ? undefined : Number(r.rating), loved: r.loved,
      runtime: opt(t.runtime), pages: opt(t.pages), words: opt(t.words), link: opt(t.link), source: opt(t.source),
      where: opt(r.where_seen), again: r.again, times: 1, color: opt(t.color), cover: opt(t.cover_url), private: r.only_me,
      trivia: Array.isArray(t.trivia) ? t.trivia : [], triviaSource: opt(t.trivia_source),
      highlights: [...(r.highlights ?? [])].sort((a, b) => a.position - b.position)
        .map((h) => ({ id: h.id, text: h.body, where: opt(h.where_at), note: opt(h.note), mine: h.mine })),
    },
  };
}

const LOG_SELECT = 'id, user_id, title_id, status, rating, loved, started_on, finished_on, logged_on, again, notes, where_seen, only_me, created_at, title:titles(*), highlights(id, body, where_at, note, mine, position)';

/* ——— loading ——— */

/** a profile by its username; follows old usernames to the new address */
export async function loadProfile(sb: SupabaseClient, username: string):
  Promise<{ profile: Profile; details: Details | null } | { redirect: string } | null> {
  const u = username.toLowerCase();
  const { data: profile } = await sb.from('profiles').select('*').eq('username', u).maybeSingle<Profile>();
  if (!profile) {
    const { data: old } = await sb.from('username_history').select('user_id').eq('old_username', u).maybeSingle();
    if (!old) return null;
    const { data: now } = await sb.from('profiles').select('username').eq('id', old.user_id).maybeSingle();
    return now ? { redirect: now.username } : null;
  }
  const { data: details } = await sb.from('profile_details').select('*').eq('id', profile.id).maybeSingle<Details>();
  return { profile, details: details ?? null };
}

/** everything on a shelf that the visitor is allowed to see, newest first */
export async function loadShelf(sb: SupabaseClient, profile: Pick<Profile, 'id' | 'username'>): Promise<Entry[]> {
  const { data, error } = await sb.from('logs').select(LOG_SELECT).eq('user_id', profile.id)
    .order('logged_on', { ascending: false }).order('created_at', { ascending: false }).range(0, 4999);
  if (error) throw new Error(error.message);
  const list = ((data ?? []) as unknown as LogRow[]).filter((r) => r.title).map((r) => toEntry(r, profile.username));
  const visits = new Map<string, number>();
  for (const e of list) visits.set(e.titleId, (visits.get(e.titleId) ?? 0) + 1);
  for (const e of list) e.data.times = visits.get(e.titleId)!;
  return list;
}

/** the visits to one title on one shelf (newest first), or [] */
export async function loadVisits(sb: SupabaseClient, profile: Pick<Profile, 'id' | 'username'>, slug: string): Promise<Entry[]> {
  const { data: t } = await sb.from('titles').select('id').eq('slug', slug).maybeSingle();
  if (!t) return [];
  const { data } = await sb.from('logs').select(LOG_SELECT).eq('user_id', profile.id).eq('title_id', t.id)
    .order('logged_on', { ascending: false }).order('created_at', { ascending: false });
  const list = ((data ?? []) as unknown as LogRow[]).map((r) => toEntry(r, profile.username));
  for (const e of list) e.data.times = list.length;
  return list;
}

export async function loadThreads(sb: SupabaseClient, profile: Pick<Profile, 'id' | 'username'>): Promise<Thread[]> {
  const { data } = await sb.from('threads').select('id, slug, name, intro, position, thread_items(position, why, title:titles(slug))')
    .eq('user_id', profile.id).order('position').order('created_at');
  return (data ?? []).map((t: any) => ({
    id: t.slug, uuid: t.id, owner: profile.username, body: t.intro ?? '',
    data: {
      title: t.name, order: t.position,
      items: [...(t.thread_items ?? [])].sort((a: any, b: any) => a.position - b.position).map((i: any) => ({ slug: i.title?.slug, why: i.why ?? '' })).filter((i: any) => i.slug),
    },
  }));
}

/** shelves shown to new visitors: the founder's, then anyone who ticked "Feature my shelf" */
export async function loadFeatured(sb: SupabaseClient, limit = 6) {
  const { data } = await sb.from('profiles').select('id, username, display_name, avatar_url, is_private, featured')
    .or(`featured.eq.true,username.eq.${site.founder}`).eq('is_private', false).limit(limit + 1);
  const people = (data ?? []) as Pick<Profile, 'id' | 'username' | 'display_name' | 'avatar_url'>[];
  people.sort((a, b) => (a.username === site.founder ? -1 : b.username === site.founder ? 1 : 0));
  return Promise.all(people.slice(0, limit).map(async (p) => {
    const [{ data: logs, count }, { data: det }] = await Promise.all([
      sb.from('logs').select('id, logged_on, title:titles(*)', { count: 'exact' }).eq('user_id', p.id).eq('only_me', false)
        .order('logged_on', { ascending: false }).limit(6),
      sb.from('profile_details').select('bio').eq('id', p.id).maybeSingle(),
    ]);
    const covers = ((logs ?? []) as any[]).filter((l) => l.title).map((l) => toEntry({ ...l, highlights: [], status: 'done', notes: '' } as LogRow, p.username));
    return { profile: p, bio: det?.bio ?? '', count: count ?? 0, covers };
  }));
}

/* ——— addresses ——— */
export const profileHref = (username: string) => `/@${username}/`;
export const href = (e: Pick<Entry, 'id' | 'owner'>) => `/@${e.owner}/library/${e.id}/`;
export const threadHref = (t: Pick<Thread, 'id' | 'owner'>) => `/@${t.owner}/threads/${t.id}/`;

/* ——— covers ——— */
export function coverSrc(e: Entry): string | undefined {
  if (site.covers === 'painted' || e.data.type === 'essay') return;
  const c = e.data.cover;
  if (!c || c === 'painted') return;
  return c;
}

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
export function paletteFor(title: string, color?: string | null) {
  if (color && /^#[0-9a-f]{6}$/i.test(color)) return { bg: color, accent: '#E6C88A', hill: shade(color, 0.68) };
  return PALETTES[hash(title) % PALETTES.length];
}
export const palette = (e: Entry) => paletteFor(e.data.title, e.data.color);
export const radius = (e: Entry) => (e.data.type === 'book' ? '2px 6px 6px 2px' : '6px');

/* ——— words ——— */
export const kind = (e: Entry) => kindName[e.data.type];
export const typeColor = (t: Kind) => kindColor[t];
/** "Paterson", or "Severance, season 2" */
export const fullTitle = (e: Entry) => (e.data.type === 'tv' && e.data.season ? `${e.data.title}, season ${e.data.season}` : e.data.title);

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

/* ——— time spent (finished things only) ——— */
export function minutes(e: Entry) {
  const d = e.data;
  if (d.type === 'film') return d.runtime ?? 110;
  if (d.type === 'tv') return d.runtime ?? (d.episodes ? d.episodes * 45 : 400);
  if (d.type === 'essay') return Math.max(3, Math.round((d.words ?? 2500) / site.wordsPerMinute));
  return Math.round((d.pages ?? 250) * site.minutesPerPage);
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
export function excerpt(e: Pick<Entry, 'body'>, max = 110) {
  const text = (e.body ?? '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\s+/g, ' ').replace(/[*_`#>]/g, '').trim();
  if (text.length <= max) return text;
  return text.slice(0, max).replace(/\s+\S*$/, '') + '…';
}

/* ——— threads an entry belongs to ——— */
export function threadsFor(e: Entry, threads: Thread[]) {
  return threads
    .map((t) => ({ t, i: t.data.items.findIndex((x) => x.slug === e.id) }))
    .filter((x) => x.i >= 0)
    .map(({ t, i }) => ({ id: t.id, owner: t.owner, title: t.data.title, pos: i + 1, of: t.data.items.length, items: t.data.items }));
}

/** the first letter of a name, for an avatar without a photo */
export const initial = (name: string) => (name.trim()[0] ?? '?').toUpperCase();
