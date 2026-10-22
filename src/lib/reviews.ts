// Reviews: a log with text or a tagline, shown on title pages with its likes and comments.
// Everything is read through the visitor's own connection, so "Only me" entries, private accounts and
// blocks are kept out by the database (title_reviews is security invoker; likes and comments follow their review).
import type { SupabaseClient } from '@supabase/supabase-js';

export interface Comment { id: string; logId: string; userId: string; body: string; date: string; username: string; name: string; avatar: string | null; canDelete: boolean }
export interface Review {
  id: string; userId: string; titleId: string; season?: number; status: string; rating: number | null; loved: boolean;
  notes: string; tagline: string; spoiler: boolean; date: string; again: boolean;
  username: string; name: string; avatar: string | null; href: string; mine: boolean;
  likes: number; liked: boolean; comments: Comment[];
}
export type ReviewSort = 'popular' | 'recent';
type Row = { id: string; slug: string; season: number | null };

/** likes and comments for these reviews (log ids), as the visitor sees them. `owners` maps a log to its author, for Delete. */
export async function reviewExtras(sb: SupabaseClient, owners: Map<string, string>, me: { id: string } | null) {
  const ids = [...owners.keys()];
  const out = new Map<string, { likes: number; liked: boolean; comments: Comment[] }>();
  for (const id of ids) out.set(id, { likes: 0, liked: false, comments: [] });
  if (!ids.length) return out;
  const [likes, comments] = await Promise.all([
    sb.from('review_likes').select('log_id, user_id').in('log_id', ids).limit(5000),
    sb.from('review_comments').select('id, log_id, user_id, body, created_at, profile:profiles(username, display_name, avatar_url)')
      .in('log_id', ids).order('created_at').limit(1000),
  ]);
  for (const l of (likes.data ?? []) as { log_id: string; user_id: string }[]) {
    const x = out.get(l.log_id)!;
    x.likes++;
    if (l.user_id === me?.id) x.liked = true;
  }
  for (const c of (comments.data ?? []) as any[]) {
    if (!c.profile) continue;
    out.get(c.log_id)!.comments.push({
      id: c.id, logId: c.log_id, userId: c.user_id, body: c.body, date: c.created_at,
      username: c.profile.username, name: c.profile.display_name || c.profile.username, avatar: c.profile.avatar_url,
      canDelete: !!me && (c.user_id === me.id || owners.get(c.log_id) === me.id),
    });
  }
  return out;
}

/** a title's reviews (a show: all its seasons, each labelled), `limit` at a time, Popular (likes, then newest) or Recent */
export async function loadReviews(sb: SupabaseClient, rows: Row[], me: { id: string } | null, sort: ReviewSort, limit: number) {
  const ids = rows.map((r) => r.id);
  if (!ids.length) return { list: [] as Review[], more: false };
  const lim = Math.min(Math.max(limit, 1), 49);
  const { data, error } = await sb.rpc('title_reviews', { title_ids: ids, sort, lim: lim + 1, off: 0 });
  if (error) return { list: [] as Review[], more: false };
  const all = (data ?? []) as any[];
  const page = all.slice(0, lim);
  const byId = new Map(rows.map((r) => [r.id, r]));
  const show = rows.find((r) => r.season == null);
  const extras = await reviewExtras(sb, new Map(page.map((r) => [r.id, r.user_id])), me);
  const list: Review[] = page.map((r) => {
    const t = byId.get(r.title_id);
    const season = t?.season ?? undefined;
    const x = extras.get(r.id)!;
    return {
      id: r.id, userId: r.user_id, titleId: r.title_id, season, status: r.status, rating: r.rating == null ? null : Number(r.rating),
      loved: r.loved, notes: r.notes ?? '', tagline: r.tagline ?? '', spoiler: r.spoiler, date: r.logged_on, again: r.again,
      username: r.username, name: r.display_name || r.username, avatar: r.avatar_url, mine: r.user_id === me?.id,
      href: season != null && show ? `/@${r.username}/library/${show.slug}/#s${season}` : `/@${r.username}/library/${t?.slug ?? ''}/`,
      likes: x.likes, liked: x.liked, comments: x.comments,
    };
  });
  return { list, more: all.length > lim };
}
