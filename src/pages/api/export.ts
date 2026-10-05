// Download your data: everything you've logged, as JSON (default) or a CSV spreadsheet.
import type { APIRoute } from 'astro';
import { oops } from '../../lib/http';
export const prerender = false;

const csvCell = (v: unknown) => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n\r]/.test(s) || /^[=+\-@]/.test(s) ? `"${s.replace(/^([=+\-@])/, "'$1").replace(/"/g, '""')}"` : s;
};

export const GET: APIRoute = async ({ locals, url }) => {
  const me = locals.me;
  if (!me) return oops('Please sign in again.', 401);
  const sb = locals.supabase;
  const [{ data: details }, { data: logs }, { data: threads }, { data: blocks }] = await Promise.all([
    sb.from('profile_details').select('bio, season_line, lotw_text, lotw_by, lotw_source, goal_books, links, favourites').eq('id', me.id).maybeSingle(),
    sb.from('logs').select('id, status, rating, loved, started_on, finished_on, logged_on, again, notes, where_seen, only_me, created_at, title:titles(kind, title, creator, year, season, link), highlights(body, where_at, note, mine)').eq('user_id', me.id).order('logged_on', { ascending: false }),
    sb.from('threads').select('slug, name, intro, thread_items(position, why, title:titles(title, kind, year))').eq('user_id', me.id),
    sb.from('blocks').select('blocked, created_at').eq('blocker', me.id),
  ]);
  const stamp = new Date().toISOString().slice(0, 10);
  if (url.searchParams.get('format') === 'csv') {
    const head = ['Kind', 'Title', 'Season', 'By', 'Year', 'Status', 'Rating', 'Loved', 'Started', 'Finished', 'Again', 'Where', 'Only me', 'Notes', 'Lines'];
    const rows = (logs ?? []).map((l: any) => [
      l.title?.kind, l.title?.title, l.title?.season ?? '', l.title?.creator, l.title?.year ?? '', l.status, l.rating ?? '', l.loved ? 'yes' : '',
      l.started_on ?? '', l.finished_on ?? '', l.again ? 'yes' : '', l.where_seen, l.only_me ? 'yes' : '', l.notes,
      (l.highlights ?? []).map((h: any) => h.body).join(' | '),
    ]);
    const text = '﻿' + [head, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n');
    return new Response(text, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="granthalaya-${me.username}-${stamp}.csv"`, 'Cache-Control': 'no-store' } });
  }
  const all = {
    exported: new Date().toISOString(), site: url.origin,
    profile: { username: me.username, name: me.display_name, photo: me.avatar_url, private: me.is_private, featured: me.featured, joined: me.created_at, ...(details ?? {}) },
    shelf: logs ?? [], threads: threads ?? [], blocked: blocks ?? [],
  };
  return new Response(JSON.stringify(all, null, 2), { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': `attachment; filename="granthalaya-${me.username}-${stamp}.json"`, 'Cache-Control': 'no-store' } });
};
