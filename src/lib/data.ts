// The one door to the data. Pages read shelves, profiles and collections only through this file.
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
  id: string; bio: string; links: Record<string, string>; favourites: string[]; pinned_line: string | null;
}
export interface Title {
  id: string; kind: Kind; slug: string; title: string; creator: string; year: number | null; season: number | null;
  episodes: number | null; runtime: number | null; pages: number | null; words: number | null; cover_url: string | null;
  link: string | null; source: string | null; tmdb_id: number | null; ol_key: string | null; trivia: string[];
  trivia_source: string | null; color: string | null; language: string | null;
  show_id?: string | null; seasons?: number | null;   // TV: a season's show row; a show row's number of seasons
  tagline?: string | null;                            // the title's own line (see cards/tagline.ts)
}
interface LogRow {
  id: string; user_id: string; title_id: string; status: Status; rating: number | null; loved: boolean;
  started_on: string | null; finished_on: string | null; logged_on: string; again: boolean; notes: string;
  where_seen: string; only_me: boolean; created_at: string; title: Title; tagline: string; spoiler: boolean;
}

/** One thing on someone's shelf: a visit to a title. Shaped like the old markdown entries so the
 *  covers, tiles and pages kept working when the library moved into the database. */
export interface Entry {
  id: string;        // the title's address name, e.g. "paterson"
  logId: string;
  titleId: string;
  showId?: string;   // a TV season: its show's catalogue row
  owner: string;     // the shelf's username
  body: string;      // your review
  data: {
    title: string; type: Kind; creator: string; year?: number; season?: number; episodes?: number;
    date: Date; started?: Date; finished?: Date; status: Status; rating?: number; loved: boolean;
    runtime?: number; pages?: number; words?: number; link?: string; source?: string; where?: string;
    again: boolean; times: number; color?: string; cover?: string; private: boolean;
    trivia: string[]; triviaSource?: string; tmdbId?: number; olKey?: string; language?: string;
    tagline?: string; spoiler: boolean;   // the review's one line, and whether it gives the story away
    cardLine?: string;                    // the title's own line (TMDB's tagline, or one written by the AI), for cards and the footer
    /** a TV show folded from its season logs (see loadShelf): each season's newest visit, "Seasons 1–2 of 3", the average of rated seasons */
    seasons?: SeasonOnShelf[]; progress?: string; average?: number; total?: number;
  };
}
/** one season of a show on a shelf: its newest visit */
export interface SeasonOnShelf {
  n: number; logId: string; titleId: string; slug: string; status: Status; date: Date; started?: Date; finished?: Date;
  rating?: number; times: number; notes: string; tagline?: string; spoiler: boolean; private: boolean;
}
/** A collection: a short, ordered list of titles with a line about each. Stored in the `threads` tables. */
export interface Collection {
  id: string;        // address name
  uuid: string;
  owner: string;
  body: string;      // the intro
  data: { title: string; order: number; items: { slug: string; why: string; titleId: string; title: Title }[] };
}

const day = (s?: string | null) => (s ? new Date(`${s}T00:00:00Z`) : undefined);
const opt = <T,>(v: T | null | undefined) => (v === null || v === undefined || v === '' ? undefined : v);

function toEntry(r: LogRow, owner: string): Entry {
  const t = r.title;
  return {
    id: t.slug, logId: r.id, titleId: t.id, showId: t.show_id ?? undefined, owner, body: r.notes ?? '',
    data: {
      title: t.title, type: t.kind, creator: t.creator, year: opt(t.year), season: opt(t.season), episodes: opt(t.episodes),
      date: day(r.logged_on)!, started: day(r.started_on), finished: day(r.finished_on), status: r.status,
      rating: r.rating == null ? undefined : Number(r.rating), loved: r.loved,
      runtime: opt(t.runtime), pages: opt(t.pages), words: opt(t.words), link: opt(t.link), source: opt(t.source),
      where: opt(r.where_seen), again: r.again, times: 1, color: opt(t.color), cover: opt(t.cover_url), private: r.only_me,
      trivia: Array.isArray(t.trivia) ? t.trivia : [], triviaSource: opt(t.trivia_source), tmdbId: opt(t.tmdb_id), olKey: opt(t.ol_key), language: opt(t.language),
      tagline: opt(r.tagline), spoiler: r.spoiler === true, cardLine: opt(t.tagline),
    },
  };
}

const LOG_SELECT = 'id, user_id, title_id, status, rating, loved, started_on, finished_on, logged_on, again, notes, where_seen, only_me, created_at, tagline, spoiler, title:titles(*)';

/* ——— loading ——— */

/** the extra profile details (bio, links, favourites) */
export async function loadDetails(sb: SupabaseClient, id: string): Promise<Details | null> {
  const { data } = await sb.from('profile_details').select('*').eq('id', id).maybeSingle<Details>();
  return data ?? null;
}

/** a profile by its username; follows old usernames to the new address. `known` is a profile already loaded
 *  for this visit (the visitor's own, from the middleware), so it isn't fetched again. */
export async function loadProfile(sb: SupabaseClient, username: string, known?: Profile | null):
  Promise<{ profile: Profile; details: Details | null } | { redirect: string } | null> {
  const u = username.toLowerCase();
  if (known && known.username === u) return { profile: known, details: await loadDetails(sb, known.id) };
  const { data: profile } = await sb.from('profiles').select('*').eq('username', u).maybeSingle<Profile>();
  if (!profile) {
    const { data: old } = await sb.from('username_history').select('user_id').eq('old_username', u).maybeSingle();
    if (!old) return null;
    const { data: now } = await sb.from('profiles').select('username').eq('id', old.user_id).maybeSingle();
    return now ? { redirect: now.username } : null;
  }
  return { profile, details: await loadDetails(sb, profile.id) };
}

/** everything on a shelf that the visitor is allowed to see, newest first. A TV show's season logs are folded into one
 *  entry for the show (`byShow`, the default); Diary, Stats and RSS pass `{ byShow: false }` and keep each season's visits. */
export async function loadShelf(sb: SupabaseClient, profile: Pick<Profile, 'id' | 'username'>, { byShow = true } = {}): Promise<Entry[]> {
  const { data, error } = await sb.from('logs').select(LOG_SELECT).eq('user_id', profile.id)
    .order('logged_on', { ascending: false }).order('created_at', { ascending: false }).range(0, 4999);
  if (error) throw new Error(error.message);
  const list = ((data ?? []) as unknown as LogRow[]).filter((r) => r.title).map((r) => toEntry(r, profile.username));
  const visits = new Map<string, number>();
  for (const e of list) visits.set(e.titleId, (visits.get(e.titleId) ?? 0) + 1);
  for (const e of list) e.data.times = visits.get(e.titleId)!;
  return byShow ? foldShows(sb, list) : list;
}

/** a show's own row: kind TV with no season */
const isShowRow = (e: Entry) => e.data.type === 'tv' && e.data.season === undefined;

/** season logs (and a whole-show "want") become one entry per show, where the newest of them stood in the list */
async function foldShows(sb: SupabaseClient, list: Entry[]): Promise<Entry[]> {
  const key = (e: Entry) => (e.data.type !== 'tv' ? undefined : isShowRow(e) ? e.titleId : e.showId);
  const ids = [...new Set(list.map(key).filter(Boolean) as string[])];
  if (!ids.length) return list;
  const { data } = await sb.from('titles').select('*').in('id', ids);
  const shows = new Map(((data ?? []) as Title[]).map((t) => [t.id, t]));
  const groups = new Map<string, Entry[]>();
  for (const e of list) { const k = key(e); if (k && shows.has(k)) groups.set(k, [...(groups.get(k) ?? []), e]); }
  const out: Entry[] = [];
  for (const e of list) {
    const k = key(e);
    const g = k ? groups.get(k) : undefined;
    if (!g) out.push(e);
    else if (g[0] === e) out.push(foldShow(shows.get(k!)!, g));
  }
  return out;
}

// 1, 2, 3, 5 → "1–3, 5"
function ranges(ns: number[]) {
  const parts: string[] = [];
  for (let i = 0; i < ns.length; i++) {
    let j = i;
    while (j + 1 < ns.length && ns[j + 1] === ns[j] + 1) j++;
    parts.push(j > i ? `${ns[i]}–${ns[j]}` : `${ns[i]}`);
    i = j;
  }
  return parts.join(', ');
}
/** "Season 2 of 3", "Seasons 1–2 of 3", "Seasons 1, 3" (saved-only seasons don't count) */
export function progressOf(seasons: Pick<SeasonOnShelf, 'n' | 'status'>[], total?: number | null) {
  const ns = seasons.filter((s) => s.status !== 'want').map((s) => s.n).sort((a, b) => a - b);
  if (!ns.length) return undefined;
  return `Season${ns.length > 1 ? 's' : ''} ${ranges(ns)}${total ? ` of ${total}` : ''}`;
}
/** a show's status from its seasons: Watched once every released season is watched (`total`, from TMDB), else Watching.
 *  A show whose newest season is paused or dropped says so, and one with only saved seasons is "want to watch". */
export function showStatus(seasons: Pick<SeasonOnShelf, 'n' | 'status' | 'date'>[], total?: number | null): Status {
  const done = (n: number) => seasons.some((s) => s.n === n && s.status === 'done');
  const all = total ? Array.from({ length: total }, (_, i) => i + 1).every(done) : seasons.every((s) => s.status === 'done');
  if (all) return 'done';
  if (seasons.some((s) => s.status === 'watching')) return 'watching';
  const newest = [...seasons].sort((a, b) => b.date.getTime() - a.date.getTime())[0].status;
  if (newest === 'paused' || newest === 'dropped') return newest;
  return seasons.every((s) => s.status === 'want') ? 'want' : 'watching';
}

/** one show entry from its logs (newest first): the show's title, poster and facts, and a line per season */
export function foldShow(show: Title, logs: Entry[]): Entry {
  const seasonLogs = logs.filter((e) => e.data.season !== undefined);
  const want = logs.find(isShowRow);
  const e = toEntry({
    id: want?.logId ?? seasonLogs[0].logId, user_id: '', title_id: show.id, status: 'want', rating: null, loved: false, started_on: null, finished_on: null,
    logged_on: '2000-01-01', again: false, notes: '', where_seen: '', only_me: false, created_at: '', title: show, tagline: '', spoiler: false,
  }, logs[0].owner);
  const d = e.data;
  d.total = show.seasons ?? undefined;
  if (!seasonLogs.length) {
    // only saved as a whole show
    Object.assign(d, { status: want!.data.status, date: want!.data.date, private: want!.data.private, tagline: want!.data.tagline, spoiler: want!.data.spoiler, seasons: [] });
    e.body = want!.body;
    return e;
  }
  const byN = new Map<number, Entry[]>();
  for (const x of seasonLogs) byN.set(x.data.season!, [...(byN.get(x.data.season!) ?? []), x]);
  const seasons: SeasonOnShelf[] = [...byN.entries()].sort((a, b) => a[0] - b[0]).map(([n, v]) => ({
    n, logId: v[0].logId, titleId: v[0].titleId, slug: v[0].id, status: v[0].data.status, date: v[0].data.date, started: v[0].data.started,
    finished: v[0].data.finished, rating: v[0].data.rating, times: v.length, notes: v[0].body, tagline: v[0].data.tagline, spoiler: v[0].data.spoiler, private: v[0].data.private,
  }));
  const rated = seasons.filter((s) => s.rating != null).map((s) => s.rating!);
  const average = rated.length ? Math.round((rated.reduce((a, b) => a + b, 0) / rated.length) * 10) / 10 : undefined;
  const newest = seasonLogs[0];
  const runtimes = seasonLogs.filter((x, i, a) => a.findIndex((y) => y.titleId === x.titleId) === i).map((x) => x.data.runtime).filter(Boolean) as number[];
  Object.assign(d, {
    status: showStatus(seasons, d.total), date: newest.data.date, seasons, average,
    rating: average == null ? undefined : Math.round(average * 2) / 2,   // stars on a tile: the average, to the nearest half
    progress: progressOf(seasons, d.total),
    started: seasons.map((s) => s.started).filter(Boolean).sort((a, b) => a!.getTime() - b!.getTime())[0],
    finished: newest.data.finished, private: seasonLogs.every((x) => x.data.private),
    runtime: runtimes.length ? runtimes.reduce((a, b) => a + b, 0) : d.runtime,
    times: 1,
  });
  e.logId = newest.logId;
  return e;
}

/** the visits to one title on one shelf (newest first), or []. A show's slug gives one entry: the show, folded from its seasons. */
export async function loadVisits(sb: SupabaseClient, profile: Pick<Profile, 'id' | 'username'>, slug: string): Promise<Entry[]> {
  const { data: t } = await sb.from('titles').select('*').eq('slug', slug).maybeSingle<Title>();
  if (!t) return [];
  const show = t.kind === 'tv' && t.season == null;
  const ids = [t.id];
  if (show) {
    const { data: ss } = await sb.from('titles').select('id').eq('show_id', t.id);
    ids.push(...(ss ?? []).map((x) => x.id));
  }
  const { data } = await sb.from('logs').select(LOG_SELECT).eq('user_id', profile.id).in('title_id', ids)
    .order('logged_on', { ascending: false }).order('created_at', { ascending: false });
  const list = ((data ?? []) as unknown as LogRow[]).filter((r) => r.title).map((r) => toEntry(r, profile.username));
  if (show) return list.length ? [foldShow(t, list)] : [];
  for (const e of list) e.data.times = list.length;
  return list;
}

export async function loadCollections(sb: SupabaseClient, profile: Pick<Profile, 'id' | 'username'>): Promise<Collection[]> {
  const { data } = await sb.from('threads').select('id, slug, name, intro, position, thread_items(position, why, title_id, title:titles(*))')
    .eq('user_id', profile.id).order('position').order('created_at');
  return (data ?? []).map((t: any) => ({
    id: t.slug, uuid: t.id, owner: profile.username, body: t.intro ?? '',
    data: {
      title: t.name, order: t.position,
      items: [...(t.thread_items ?? [])].sort((a: any, b: any) => a.position - b.position)
        .map((i: any) => ({ slug: i.title?.slug, why: i.why ?? '', titleId: i.title_id, title: i.title })).filter((i: any) => i.slug),
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
    const covers = ((logs ?? []) as any[]).filter((l) => l.title).map((l) => toEntry({ ...l, status: 'done', notes: '', tagline: '', spoiler: false } as LogRow, p.username));
    return { profile: p, bio: det?.bio ?? '', count: count ?? 0, covers };
  }));
}

/** a catalogue title shown like a shelf entry (for collections with things that aren't on the owner's shelf) */
export function titleAsEntry(t: Title, owner: string): Entry {
  return toEntry({
    id: '', user_id: '', title_id: t.id, status: 'done', rating: null, loved: false, started_on: null, finished_on: null,
    logged_on: new Date().toISOString().slice(0, 10), again: false, notes: '', where_seen: '', only_me: false, created_at: '', title: t, tagline: '', spoiler: false,
  }, owner);
}

/* ——— addresses ——— */
export const profileHref = (username: string) => `/@${username}/`;
export const href = (e: Pick<Entry, 'id' | 'owner'>) => `/@${e.owner}/library/${e.id}/`;
export const collectionHref = (t: Pick<Collection, 'id' | 'owner'>) => `/@${t.owner}/collections/${t.id}/`;
export const reviewsHref = (username: string) => `/@${username}/reviews/`;
/** an entry with a review on it: text or a tagline */
export const reviewed = (e: Pick<Entry, 'body' | 'data'>) => !!(e.body.trim() || e.data.tagline);
/** one review on a shelf: an entry's, or a season's (a show's reviews are per season) */
export interface ShelfReview { entry: Entry; logId: string; season?: number; text: string; tagline?: string; spoiler: boolean; rating?: number; loved: boolean; date: Date; href: string }
/** every review on a (loaded) shelf, newest first */
export function shelfReviews(shelf: Entry[]): ShelfReview[] {
  const out: ShelfReview[] = [];
  for (const e of shelf) {
    if (e.data.seasons?.length) {
      for (const s of e.data.seasons) if (s.notes.trim() || s.tagline) {
        out.push({ entry: e, logId: s.logId, season: s.n, text: s.notes, tagline: s.tagline, spoiler: s.spoiler, rating: s.rating, loved: false, date: s.finished ?? s.date, href: `${href(e)}#s${s.n}` });
      }
    } else if (reviewed(e)) {
      out.push({ entry: e, logId: e.logId, text: e.body, tagline: e.data.tagline, spoiler: e.data.spoiler, rating: e.data.rating, loved: e.data.loved, date: e.data.finished ?? e.data.date, href: href(e) });
    }
  }
  return out.sort((a, b) => b.date.getTime() - a.date.getTime());
}

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
  if (e.data.average != null) return `Average ${e.data.average} out of 5 across rated seasons`;
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

/* ——— collections an entry belongs to ——— */
export function collectionsFor(e: Entry, collections: Collection[]) {
  return collections
    .map((t) => ({ t, i: t.data.items.findIndex((x) => x.slug === e.id) }))
    .filter((x) => x.i >= 0)
    .map(({ t, i }) => ({ id: t.id, owner: t.owner, title: t.data.title, pos: i + 1, of: t.data.items.length, items: t.data.items }));
}

/** the first letter of a name, for an avatar without a photo */
export const initial = (name: string) => (name.trim()[0] ?? '?').toUpperCase();
