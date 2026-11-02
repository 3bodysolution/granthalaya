// Our own titles, authors and members, kept in memory for "Did you mean" in search (see lib/fuzzy.ts).
// The catalogue and the member names are public (anyone may read them), so one copy is read with no sign-in and shared by every
// visitor for ten minutes. Because "visible unless blocked" is a rule for each visitor, the few members that match are checked
// again as the visitor before they are shown (see `visibleMembers`).
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@supabase/supabase-js';
import { env } from '../supabase';
import { norm, rank } from '../fuzzy';
import { titlePageHref } from './onsite';
import { viaCover } from '../images';

type F = { norm: string; weight: number };
export interface NearTitle { type: 'title'; kind: 'film' | 'tv' | 'book'; title: string; sub: string; href: string; cover?: string; fields: F[] }
export interface NearMember { type: 'member'; username: string; name: string; avatar?: string; href: string; fields: F[] }
export interface Near { title: NearTitle[]; member: NearMember[] }

const TTL = 10 * 60_000;
let cache: { at: number; titles: NearTitle[]; members: NearMember[] } | null = null;
let loading: Promise<NonNullable<typeof cache>> | null = null;

const COLS = 'kind, slug, title, original_title, creator, year, season, tmdb_id, ol_key, link, cover_url';
type Row = { kind: string; slug: string; title: string; original_title: string | null; creator: string | null; year: number | null; season: number | null; tmdb_id: number | null; ol_key: string | null; link: string | null; cover_url: string | null };

async function load(): Promise<NonNullable<typeof cache>> {
  const url = env('PUBLIC_SUPABASE_URL'), key = env('PUBLIC_SUPABASE_PUBLISHABLE_KEY');
  const sb: SupabaseClient = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const titles: NearTitle[] = [];
  const seen = new Set<string>();
  for (let from = 0; from < 30000; from += 1000) {
    const { data, error } = await sb.from('titles').select(COLS).in('kind', ['film', 'tv', 'book']).range(from, from + 999);
    if (error) throw error;
    for (const r of (data ?? []) as Row[]) {
      if (r.season != null) continue;                         // a TV season: its show's row stands for it
      const href = titlePageHref({ kind: r.kind as 'film', slug: r.slug, title: r.title, tmdb_id: r.tmdb_id, ol_key: r.ol_key, link: r.link } as Parameters<typeof titlePageHref>[0]);
      if (!href || seen.has(href)) continue;
      seen.add(href);
      const fields: F[] = [{ norm: norm(r.title), weight: 1 }];
      if (r.original_title) fields.push({ norm: norm(r.original_title), weight: 1 });
      if (r.creator) fields.push({ norm: norm(r.creator), weight: 0.85 });   // an author or director: "shivaji savant" finds his books
      titles.push({ type: 'title', kind: r.kind as 'film', title: r.title, sub: [r.creator, r.year].filter(Boolean).join(' | '), href, cover: r.cover_url ? viaCover(r.cover_url, 200) : undefined, fields });
    }
    if (!data || data.length < 1000) break;
  }
  const members: NearMember[] = [];
  for (let from = 0; from < 20000; from += 1000) {
    const { data } = await sb.from('profiles').select('username, display_name, avatar_url').range(from, from + 999);
    for (const p of (data ?? []) as { username: string; display_name: string | null; avatar_url: string | null }[]) {
      const fields: F[] = [{ norm: norm(p.username), weight: 1 }];
      if (p.display_name) fields.push({ norm: norm(p.display_name), weight: 1 });
      members.push({ type: 'member', username: p.username, name: p.display_name || p.username, avatar: p.avatar_url ?? undefined, href: `/@${p.username}/`, fields });
    }
    if (!data || data.length < 1000) break;
  }
  return { at: Date.now(), titles, members };
}

async function index() {
  if (cache && Date.now() - cache.at < TTL) return cache;
  loading ??= load().then((c) => (cache = c)).finally(() => { loading = null; });
  try { return await loading; } catch (e) { if (cache) return cache; throw e; }
}

/** the closest of our own titles (and members) to what was typed, best first, with how close each is (0 to 1) */
export async function nearest(query: string, opts: { min?: number; titles?: number; members?: number } = {}) {
  const idx = await index();
  const q = norm(query);
  // very short queries must match closely, or "dan" would offer every name with those letters
  const min = Math.max(opts.min ?? 0.55, q.length < 4 ? 0.85 : q.length < 6 ? 0.65 : 0);
  return {
    titles: rank(idx.titles, query, min, opts.titles ?? 6),
    members: rank(idx.members, query, Math.max(min, 0.7), opts.members ?? 3),
  };
}

/** only the members this visitor may see (a block hides both people from each other, in the database) */
export async function visibleMembers(sb: SupabaseClient | null | undefined, found: { doc: NearMember; score: number }[]) {
  if (!sb || !found.length) return [];
  const { data } = await sb.from('profiles').select('username').in('username', found.map((f) => f.doc.username));
  const ok = new Set(((data ?? []) as { username: string }[]).map((r) => r.username));
  return found.filter((f) => ok.has(f.doc.username));
}
