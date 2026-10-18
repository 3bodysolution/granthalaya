// What Granthalaya itself knows about a catalogue title: whether it's in our shared catalogue yet, what
// people here thought of it, and which collections it's in. Read through the visitor's own connection,
// so private shelves, "Only me" entries and blocks are respected by the database.
import type { SupabaseClient } from '@supabase/supabase-js';
import { filmHref, showHref } from './tmdb';
import { bookHref } from './books';
import { adminClient, env } from '../supabase';
import { base, getJSON, slug as slugOf } from './fetch';
import { plainOf, bareOf, LOG_COLS, type LogRow } from '../saved';

export interface TitleRow { id: string; kind: string; slug: string; title: string; season: number | null; tmdb_id: number | null; ol_key: string | null; link: string | null; trivia: string[]; trivia_source: string | null; cover_url: string | null; year: number | null; creator: string;
  /** only loaded by rowBySlug */ source?: string | null; original_title?: string | null; language?: string | null; note?: string | null }

/** `source` of a book made from a prize or classics list: it has no Open Library page, so never look for one */
export const LIST_SOURCE = 'Granthalaya lists';

/** the public page for one of our catalogue titles */
export function titlePageHref(t: Pick<TitleRow, 'kind' | 'slug' | 'title' | 'tmdb_id' | 'ol_key' | 'link'>): string | null {
  if (t.kind === 'film') return t.tmdb_id ? filmHref(t.tmdb_id, t.title) : `/film/${t.slug}/`;
  if (t.kind === 'tv') return t.tmdb_id ? showHref(t.tmdb_id, t.title) : null;
  if (t.kind === 'book') {
    if (t.ol_key) return bookHref(t.ol_key, t.title);
    const gb = t.link?.match(/books\.google\.[a-z.]+\/books\?id=([A-Za-z0-9_-]{6,20})/)?.[1];
    return gb ? bookHref(`gb-${gb}`) : `/book/${t.slug}/`;
  }
  return null;
}

const COLS = 'id, kind, slug, title, season, tmdb_id, ol_key, link, trivia, trivia_source, cover_url, year, creator';
export async function rowsForFilm(sb: SupabaseClient, tmdbId: number) {
  const { data } = await sb.from('titles').select(COLS).eq('kind', 'film').eq('tmdb_id', tmdbId);
  return (data ?? []) as TitleRow[];
}
export async function rowsForShow(sb: SupabaseClient, tmdbId: number) {
  const { data } = await sb.from('titles').select(COLS).eq('kind', 'tv').eq('tmdb_id', tmdbId).order('season');
  return (data ?? []) as TitleRow[];
}
export async function rowsForBook(sb: SupabaseClient, key: string) {
  if (key.startsWith('gb-')) {
    const { data } = await sb.from('titles').select(COLS).eq('kind', 'book').like('link', `%books?id=${key.slice(3)}%`);
    return (data ?? []) as TitleRow[];
  }
  const { data } = await sb.from('titles').select(COLS).eq('kind', 'book').eq('ol_key', key);
  return (data ?? []) as TitleRow[];
}
export async function rowBySlug(sb: SupabaseClient, kind: string, slug: string) {
  const { data } = await sb.from('titles').select(`${COLS}, source, original_title, language, note`).eq('kind', kind).eq('slug', slug).maybeSingle();
  return (data as TitleRow) ?? null;
}

export interface Voice { username: string; name: string; avatar: string | null; rating: number | null; loved: boolean; status: string; notes: string; href: string; date: string; again: boolean }
export interface OnSite {
  done: number; saved: number; average: number | null; ratings: number;
  voices: Voice[];
  collections: { name: string; href: string; by: string; count: number }[];
  mine: { id: string; status: string; rating: number | null; titleId: string; slug: string; season: number | null; logged: string; again: boolean; plain: boolean; bare: boolean }[];
}
/** counts, people's notes and collections for one or more catalogue rows (a TV show has one per season) */
export async function onSite(sb: SupabaseClient, rows: TitleRow[], me: { id: string } | null): Promise<OnSite> {
  const empty: OnSite = { done: 0, saved: 0, average: null, ratings: 0, voices: [], collections: [], mine: [] };
  const ids = rows.map((r) => r.id);
  if (!ids.length) return empty;
  const byId = new Map(rows.map((r) => [r.id, r]));
  const [done, saved, rated, notes, cols, mine] = await Promise.all([
    sb.from('logs').select('id', { count: 'exact', head: true }).in('title_id', ids).eq('status', 'done'),
    sb.from('logs').select('id', { count: 'exact', head: true }).in('title_id', ids).eq('status', 'want'),
    sb.from('logs').select('rating').in('title_id', ids).not('rating', 'is', null).limit(1000),
    sb.from('logs').select('id, title_id, status, rating, loved, notes, logged_on, again, user_id, profile:profiles(username, display_name, avatar_url)')
      .in('title_id', ids).neq('notes', '').order('logged_on', { ascending: false }).limit(12),
    sb.from('thread_items').select('title_id, thread:threads(name, slug, user_id, thread_items(count), profile:profiles(username, display_name))').in('title_id', ids).limit(20),
    me ? sb.from('logs').select(`${LOG_COLS}, logged_on, again`).eq('user_id', me.id).in('title_id', ids).order('logged_on', { ascending: false }).order('created_at', { ascending: false }) : Promise.resolve({ data: [] as any[] }),
  ]);
  const rs = ((rated.data ?? []) as { rating: number }[]).map((r) => Number(r.rating));
  const voices: Voice[] = ((notes.data ?? []) as any[]).filter((l) => l.profile && l.user_id !== me?.id).map((l) => {
    const t = byId.get(l.title_id)!;
    return {
      username: l.profile.username, name: l.profile.display_name || l.profile.username, avatar: l.profile.avatar_url,
      rating: l.rating == null ? null : Number(l.rating), loved: l.loved, status: l.status, notes: l.notes,
      href: `/@${l.profile.username}/library/${t.slug}/`, date: l.logged_on, again: l.again,
    };
  });
  // one voice per person, newest first
  const seen = new Set<string>();
  const oneEach = voices.filter((v) => (seen.has(v.username) ? false : (seen.add(v.username), true))).slice(0, 6);
  const colSeen = new Set<string>();
  const collections = ((cols.data ?? []) as any[]).map((c) => c.thread).filter((t) => t?.profile).map((t) => ({
    name: t.name, href: `/@${t.profile.username}/collections/${t.slug}/`, by: t.profile.display_name || t.profile.username, count: t.thread_items?.[0]?.count ?? 0,
  })).filter((c) => (colSeen.has(c.href) ? false : (colSeen.add(c.href), true))).slice(0, 6);
  const mineRows = (mine.data ?? []) as any[];
  const plain = await plainOf(sb, mineRows as LogRow[]);
  const bare = await bareOf(sb, mineRows as LogRow[]);
  return {
    done: done.count ?? 0, saved: saved.count ?? 0, ratings: rs.length,
    average: rs.length >= 2 ? Math.round((rs.reduce((a, b) => a + b, 0) / rs.length) * 10) / 10 : null,
    voices: oneEach, collections,
    mine: mineRows.map((l) => ({ plain: plain.has(l.id), bare: bare.has(l.id), id: l.id, status: l.status, rating: l.rating == null ? null : Number(l.rating), titleId: l.title_id, slug: byId.get(l.title_id)?.slug ?? '', season: byId.get(l.title_id)?.season ?? null, logged: l.logged_on, again: l.again })),
  };
}

/** what the visitor has on their shelf for one title: its newest status, the log, and whether it's only a save (see lib/saved.ts) */
export interface Mark { status: string; id: string; plain: boolean }

/** your newest log for each of these titles, in one lookup: { title id → Mark } */
async function shelfMarks(sb: SupabaseClient, me: { id: string }, titleIds: string[]): Promise<Map<string, Mark>> {
  const out = new Map<string, Mark>();
  if (!titleIds.length) return out;
  const { data } = await sb.from('logs').select(`${LOG_COLS}, logged_on`).eq('user_id', me.id).in('title_id', titleIds).order('logged_on', { ascending: true });
  const logs = (data ?? []) as (LogRow & { logged_on: string })[];
  const plain = await plainOf(sb, logs);
  for (const l of logs) out.set(l.title_id, { status: l.status, id: l.id, plain: plain.has(l.id) }); // the newest wins
  return out;
}

/** your mark for each title in a list, keyed "film:370755", "tv:1396" or "book:OL45883W" */
export async function myMarks(sb: SupabaseClient, me: { id: string } | null, keys: { kind: string; tmdb?: number; ol?: string }[]): Promise<Map<string, Mark>> {
  const out = new Map<string, Mark>();
  if (!me || !keys.length) return out;
  const tmdb = [...new Set(keys.filter((k) => k.tmdb).map((k) => k.tmdb!))];
  const ol = [...new Set(keys.filter((k) => k.ol).map((k) => k.ol!))];
  const ors = [tmdb.length && `tmdb_id.in.(${tmdb.join(',')})`, ol.length && `ol_key.in.(${ol.map((k) => `"${k}"`).join(',')})`].filter(Boolean).join(',');
  if (!ors) return out;
  const { data: titles } = await sb.from('titles').select('id, kind, tmdb_id, ol_key').or(ors);
  const byId = new Map((titles ?? []).map((t: any) => [t.id, t]));
  const marks = await shelfMarks(sb, me, [...byId.keys()]);
  for (const [id, m] of marks) {
    const t = byId.get(id)!;
    out.set(t.kind === 'book' ? `book:${t.ol_key}` : `${t.kind}:${t.tmdb_id}`, m);
  }
  return out;
}

/** essays on the visitor's shelf, by link: { link → Mark } */
export async function essayMarks(sb: SupabaseClient, me: { id: string } | null, links: string[]): Promise<Map<string, Mark>> {
  const out = new Map<string, Mark>();
  if (!me || !links.length) return out;
  const { data: titles } = await sb.from('titles').select('id, link').eq('kind', 'essay').in('link', links);
  const byId = new Map((titles ?? []).map((t: any) => [t.id, t.link as string]));
  const marks = await shelfMarks(sb, me, [...byId.keys()]);
  for (const [id, m] of marks) out.set(byId.get(id)!, m);
  return out;
}

/* ——— older catalogue rows (copied from the markdown library) have no TMDB or Open Library id yet.
   The first time someone opens one, we look it up and, if the match is clear, remember the id. ——— */
const same = (a?: string | null, b?: string | null) => !!a && !!b && slugOf(a.split(/[:(]/)[0]) === slugOf(b.split(/[:(]/)[0]);

export async function healFilm(row: TitleRow): Promise<number | null> {
  const key = env('TMDB_API_KEY');
  if (!key || row.tmdb_id || row.kind !== 'film') return row.tmdb_id;
  const u = `${base.tmdb()}/search/movie?api_key=${key}&query=${encodeURIComponent(row.title)}${row.year ? `&year=${row.year}` : ''}`;
  const j = await getJSON(u, { ttl: 86400 });
  const hits = (j?.results ?? []).filter((m: any) => (same(m.title, row.title) || same(m.original_title, row.title))
    && (!row.year || Math.abs(Number(String(m.release_date ?? '').slice(0, 4)) - row.year) <= 1));
  if (hits.length !== 1 && !(hits.length > 1 && row.year)) return null;
  const id = hits[0].id as number;
  await adminClient().from('titles').update({ tmdb_id: id }).eq('id', row.id).is('tmdb_id', null);
  return id;
}

export async function healBook(row: TitleRow): Promise<string | null> {
  if (row.ol_key || row.kind !== 'book' || row.source === LIST_SOURCE) return row.ol_key;
  const q = `title:"${row.title.replace(/"/g, '')}"${row.creator ? ` author:"${row.creator.replace(/"/g, '')}"` : ''}`;
  const j = await getJSON(`${base.ol()}/search.json?q=${encodeURIComponent(q)}&fields=key,title,author_name,first_publish_year&limit=5`, { ttl: 86400 });
  const surname = (row.creator ?? '').trim().split(/\s+/).pop()?.toLowerCase();
  const hit = (j?.docs ?? []).find((d: any) => same(d.title, row.title) && (!surname || (d.author_name ?? []).some((n: string) => n.toLowerCase().includes(surname))));
  const key = typeof hit?.key === 'string' ? hit.key.replace('/works/', '') : null;
  if (!key || !/^OL\d+W$/.test(key)) return null;
  const { error } = await adminClient().from('titles').update({ ol_key: key }).eq('id', row.id).is('ol_key', null);
  return error ? null : key;
}
