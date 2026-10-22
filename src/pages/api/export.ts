// Download your data: one zip of spreadsheets (shelf with reviews, comments and likes you gave, the old lines, collections, profile).
import type { APIRoute } from 'astro';
import { oops } from '../../lib/http';
import { zip } from '../../lib/zip';
export const prerender = false;

// spreadsheet cells; a leading = + - @ is defused so a spreadsheet app never runs it as a formula
const cell = (v: unknown) => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n\r]/.test(s) || /^[=+\-@]/.test(s) ? `"${s.replace(/^([=+\-@])/, "'$1").replace(/"/g, '""')}"` : s;
};
const csv = (head: string[], rows: unknown[][]) => '﻿' + [head, ...rows].map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
const yes = (b: unknown) => (b ? 'yes' : '');

export const GET: APIRoute = async ({ locals }) => {
  const me = locals.me;
  if (!me) return oops('Please sign in again.', 401);
  const sb = locals.supabase;
  const [{ data: details }, { data: logs }, { data: cols }, { data: comments }, { data: likes }] = await Promise.all([
    sb.from('profile_details').select('bio, links, favourites, pinned_line').eq('id', me.id).maybeSingle(),
    sb.from('logs').select('id, status, rating, loved, started_on, finished_on, logged_on, again, notes, tagline, spoiler, where_seen, only_me, title:titles(id, kind, title, creator, year, season, link, show_id), highlights(id, body, where_at, note, mine, position)').eq('user_id', me.id).order('logged_on', { ascending: false }),
    sb.from('threads').select('slug, name, intro, position, thread_items(position, why, title:titles(title, kind, creator, year))').eq('user_id', me.id).order('position'),
    sb.from('review_comments').select('body, created_at, log:logs(title:titles(title, season), owner:profiles!logs_user_id_fkey(username))').eq('user_id', me.id).order('created_at', { ascending: false }),
    sb.from('review_likes').select('created_at, log:logs(title:titles(title, season), owner:profiles!logs_user_id_fkey(username))').eq('user_id', me.id).order('created_at', { ascending: false }),
  ]);
  const shelf = (logs ?? []) as any[];
  // TV: the show each season belongs to, and shows chosen as favourites
  const showIds = [...new Set([...shelf.map((l) => l.title?.show_id), ...((details?.favourites ?? []) as string[])].filter(Boolean))];
  const { data: shows } = showIds.length ? await sb.from('titles').select('id, title').in('id', showIds) : { data: [] };
  const showName = new Map<string, string>(((shows ?? []) as any[]).map((t) => [t.id, t.title]));

  const shelfCsv = csv(
    ['Kind', 'Title', 'Show', 'Season', 'By', 'Year', 'Status', 'Rating', 'Loved', 'Added', 'Started', 'Finished', 'Again', 'Where', 'Only me', 'Tagline', 'Review', 'Contains spoilers', 'Link'],
    shelf.map((l) => [l.title?.kind, l.title?.title, showName.get(l.title?.show_id) ?? '', l.title?.season ?? '', l.title?.creator, l.title?.year ?? '', l.status, l.rating ?? '', yes(l.loved),
      l.logged_on, l.started_on ?? '', l.finished_on ?? '', yes(l.again), l.where_seen, yes(l.only_me), l.tagline ?? '', l.notes, yes(l.spoiler), l.title?.link ?? '']),
  );
  const linesCsv = csv(
    ['Line', 'From', 'By', 'Where in it', 'My note', 'My own line', 'Pinned'],
    shelf.flatMap((l) => [...(l.highlights ?? [])].sort((a: any, b: any) => a.position - b.position).map((h: any) => [
      h.body, l.title?.title, h.mine ? me.display_name : l.title?.creator, h.where_at, h.note, yes(h.mine), yes(h.id === details?.pinned_line),
    ])),
  );
  // a review you commented on or liked may since have been hidden by its owner: then only the date is left
  const whose = (x: any) => [x.log?.title?.title ?? '', x.log?.title?.season ?? '', x.log?.owner ? `@${x.log.owner.username}` : ''];
  const commentsCsv = csv(['Comment', 'On the review of', 'Season', 'By', 'Written'], ((comments ?? []) as any[]).map((c) => [c.body, ...whose(c), c.created_at.slice(0, 10)]));
  const likesCsv = csv(['Liked the review of', 'Season', 'By', 'Liked'], ((likes ?? []) as any[]).map((k) => [...whose(k), k.created_at.slice(0, 10)]));
  const colsCsv = csv(
    ['Collection', 'About it', 'Order', 'Title', 'Kind', 'By', 'Year', 'Why it’s here'],
    ((cols ?? []) as any[]).flatMap((c) => [...(c.thread_items ?? [])].sort((a: any, b: any) => a.position - b.position).map((i: any) => [
      c.name, c.intro, i.position + 1, i.title?.title, i.title?.kind, i.title?.creator, i.title?.year ?? '', i.why,
    ])),
  );
  const titleName = new Map<string, string>([...showName, ...shelf.map((l) => [l.title?.id, l.title?.title] as [string, string])]);
  const links = (details?.links ?? {}) as Record<string, string>;
  const profileCsv = csv(['Field', 'Value'], [
    ['Username', me.username], ['Name', me.display_name], ['About', details?.bio ?? ''], ['Photo', me.avatar_url ?? ''],
    ['Private account', yes(me.is_private)], ['Shelf featured', yes(me.featured)], ['Joined', me.created_at.slice(0, 10)],
    ['Favourites', ((details?.favourites ?? []) as string[]).map((id) => titleName.get(id)).filter(Boolean).join(' | ')],
    ...Object.entries(links).map(([k, v]) => [`Link: ${k}`, v]),
  ]);

  const stamp = new Date().toISOString().slice(0, 10);
  const file = zip([
    { name: 'shelf.csv', text: shelfCsv },
    { name: 'review-comments.csv', text: commentsCsv },
    { name: 'likes.csv', text: likesCsv },
    { name: 'lines.csv', text: linesCsv },   // lines became review taglines; this stays while the old table holds them
    { name: 'collections.csv', text: colsCsv },
    { name: 'profile.csv', text: profileCsv },
  ]);
  return new Response(file, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="granthalaya-${me.username}-${stamp}.zip"`,
      'Cache-Control': 'no-store',
    },
  });
};
