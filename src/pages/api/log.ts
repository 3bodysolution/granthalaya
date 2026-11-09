// Your shelf: add something (POST), change it (PATCH), or remove it (DELETE).
import type { APIRoute, APIContext } from 'astro';
import { json, oops, body, str, isoDate, needMe, sameOrigin } from '../../lib/http';
import { dbMessage } from '../../lib/supabase';
import { cleanHit, titleFor } from '../../lib/titles';
import { ensureFactsLater } from '../../lib/cards/tagline';
import { statusFits, type Kind, type Status } from '../../lib/kinds';
import { isPlainSave, isBareEntry } from '../../lib/saved';
import { warmCover } from '../../lib/cards/covers';
import { todayIST as today } from '../../lib/data';
export const prerender = false;

const rating = (v: unknown) => {
  const n = Number(v);
  return v === null || v === undefined || v === '' || !Number.isFinite(n) || n < 0.5 || n > 5 ? null : Math.round(n * 2) / 2;
};

/** the fields a person can set on an entry, checked */
function fields(b: Record<string, any>, kind: Kind, status: Status) {
  const started = isoDate(b.started), finished = isoDate(b.finished);
  return {
    status,
    rating: status === 'done' && kind !== 'essay' ? rating(b.rating) : null,
    loved: kind === 'essay' && status === 'done' ? b.loved === true : false,
    started_on: status === 'want' ? null : started,
    finished_on: status === 'done' ? finished ?? today() : null,
    again: b.again === true,
    notes: str(b.notes, 10000) ?? '',
    tagline: oneLine(b.tagline),
    spoiler: b.spoiler === true,
    where_seen: str(b.where, 80) ?? '',
  };
}
/** a review's tagline: one line, at most 140 characters */
const oneLine = (v: unknown) => [...(str(v, 400) ?? '').replace(/\s+/g, ' ')].slice(0, 140).join('').trim();

type TitleBits = { kind: Kind; slug: string; season: number | null; show_id: string | null; cover_url?: string | null };
async function kindOf(ctx: APIContext, titleId: string): Promise<TitleBits | null> {
  const { data } = await ctx.locals.supabase.from('titles').select('kind, slug, season, show_id, cover_url').eq('id', titleId).maybeSingle();
  return (data as TitleBits | null) ?? null;
}
/** a TV show's own row (no season): it only takes "want to watch" */
const wholeShow = (t: Pick<TitleBits, 'kind' | 'season'>) => t.kind === 'tv' && t.season == null;
/** where an entry lives: a season is a part of its show's page */
async function entryHref(ctx: APIContext, username: string, t: TitleBits) {
  if (t.kind === 'tv' && t.season != null && t.show_id) {
    const { data } = await ctx.locals.supabase.from('titles').select('slug').eq('id', t.show_id).maybeSingle();
    if (data) return `/@${username}/library/${data.slug}/#s${t.season}`;
  }
  return `/@${username}/library/${t.slug}/`;
}

export const POST: APIRoute = async (ctx) => {
  if (!sameOrigin(ctx)) return oops('Please try again from the site.', 403);
  const { me, res } = needMe(ctx);
  if (res) return res;
  const b = await body<Record<string, any>>(ctx.request);
  if (!b) return oops('Nothing to save.');

  // which title: one already in the catalogue, or something just found
  let titleId: string | undefined = typeof b.title === 'string' && /^[0-9a-f-]{36}$/i.test(b.title) ? b.title : undefined;
  if (!titleId) {
    const hit = cleanHit(b.hit);
    if (!hit) return oops('A title is needed.');
    const t = await titleFor(hit, me.id);
    if ('error' in t) return oops(t.error);
    titleId = t.id;
  }
  const t = await kindOf(ctx, titleId);
  if (!t) return oops('Couldn’t find that title.', 404);
  ensureFactsLater(titleId);   // its card line and painting are written in the background, so they are ready before anyone shares
  warmCover(ctx.url.origin, t.cover_url);   // and its cover is fetched into the CDN, so the first card doesn't wait on Open Library
  const status = String(b.status ?? 'done');
  if (!statusFits(t.kind, status)) return oops('Pick a status.');
  if (wholeShow(t) && status !== 'want') return oops('Pick a season first.');

  const sb = ctx.locals.supabase;
  const row = { user_id: me.id, title_id: titleId, ...fields(b, t.kind, status) };
  // a second save of the same title, in the same status, within 30 seconds is the first one again (a double tap, or a rating and a
  // review sent one after the other): it fills in the entry that is there and makes no new one. "Watch it again" is never merged.
  if (!row.again) {
    const { data: recent } = await sb.from('logs').select('id').eq('user_id', me.id).eq('title_id', titleId).eq('status', row.status).eq('again', false)
      .gte('created_at', new Date(Date.now() - 30_000).toISOString()).order('created_at', { ascending: false }).limit(1);
    if (recent?.length) {
      const fill: Record<string, unknown> = {};
      if (row.rating != null) fill.rating = row.rating;
      if (row.notes) fill.notes = row.notes;
      if (row.tagline) { fill.tagline = row.tagline; fill.spoiler = row.spoiler; }
      if (row.where_seen) fill.where_seen = row.where_seen;
      if (row.started_on) fill.started_on = row.started_on;
      if (Object.keys(fill).length) await sb.from('logs').update(fill).eq('id', recent[0].id).eq('user_id', me.id);
      return json({ ok: true, id: recent[0].id, href: await entryHref(ctx, me.username, t), merged: true });
    }
  }
  const { data, error } = await sb.from('logs').insert(row).select('id').single();
  if (error || !data) return oops(dbMessage(error));
  // the first season logged replaces "want to watch" on the whole show
  if (t.kind === 'tv' && t.season != null && t.show_id) await sb.from('logs').delete().eq('user_id', me.id).eq('title_id', t.show_id);
  return json({ ok: true, id: data.id, href: await entryHref(ctx, me.username, t) });
};

export const PATCH: APIRoute = async (ctx) => {
  if (!sameOrigin(ctx)) return oops('Please try again from the site.', 403);
  const { me, res } = needMe(ctx);
  if (res) return res;
  const b = await body<Record<string, any>>(ctx.request);
  if (!b || typeof b.id !== 'string') return oops('Nothing to change.');
  const sb = ctx.locals.supabase;
  const { data: cur } = await sb.from('logs').select('id, user_id, status, started_on, finished_on, title:titles(kind, slug, season, show_id)').eq('id', b.id).eq('user_id', me.id).maybeSingle<any>();
  if (!cur) return oops('Couldn’t find that entry.', 404);
  const kind = cur.title.kind as Kind;
  const whole = wholeShow(cur.title);

  let change: Record<string, unknown>;
  if (b.full === true) {
    // the whole entry, from the edit screen
    const status = String(b.status ?? cur.status);
    if (!statusFits(kind, status) || (whole && status !== 'want')) return oops('Pick a status.');
    change = fields(b, kind, status);
  } else if ('rating' in b) {
    // a quick rating from a title page: rating something means you've finished it
    if (kind === 'essay') return oops('Essays get a heart, not stars.');
    if (whole) return oops('Rate a season.');
    const r = rating(b.rating);
    change = r == null ? { rating: null } : { rating: r, status: 'done', finished_on: cur.finished_on ?? today() };
  } else if ('notes' in b || 'finished' in b) {
    // a season's review or date, edited in place on the show's entry page
    change = {};
    if ('notes' in b) change.notes = str(b.notes, 10000) ?? '';
    if ('tagline' in b) change.tagline = oneLine(b.tagline);
    if ('spoiler' in b) change.spoiler = b.spoiler === true;
    if ('finished' in b) {
      const day = isoDate(b.finished);
      if (!day) return oops('That date doesn’t look right.');
      if (cur.status === 'done') change.finished_on = day; else if (cur.status === 'want') change.logged_on = day; else change.started_on = day;
    }
  } else {
    // a quick status change from the entry page
    const status = String(b.status ?? '');
    if (!statusFits(kind, status) || (whole && status !== 'want')) return oops('That status doesn’t fit here.');
    change = { status };
    if (status === 'done') change.finished_on = cur.finished_on ?? today();
    else change.finished_on = null;
    if ((status === 'reading' || status === 'watching') && !cur.started_on) change.started_on = today();
    if (status === 'want') { change.started_on = null; change.rating = null; change.loved = false; }
    if (status !== 'done') { change.rating = null; change.loved = false; }
  }
  const { error } = await sb.from('logs').update(change).eq('id', cur.id).eq('user_id', me.id);
  if (error) return oops(dbMessage(error));
  // rating something that wasn't finished marks it finished: the page says so
  const statusChanged = change.status && change.status !== cur.status ? change.status : undefined;
  return json({ ok: true, id: cur.id, href: await entryHref(ctx, me.username, cur.title), statusChanged });
};

export const DELETE: APIRoute = async (ctx) => {
  if (!sameOrigin(ctx)) return oops('Please try again from the site.', 403);
  const { me, res } = needMe(ctx);
  if (res) return res;
  const b = await body<Record<string, any>>(ctx.request);
  if (!b || typeof b.id !== 'string') return oops('Nothing to remove.');
  // a bookmark tap takes back a plain save only; anything with more on it stays
  if (b.onlySaved === true && !(await isPlainSave(ctx.locals.supabase, me.id, b.id))) return oops('That has more than a save on it, so it stays on your shelf.', 409);
  // a status tapped off again: no confirmation was asked, so the server makes sure there was nothing else on it
  if (b.onlyBare === true && !(await isBareEntry(ctx.locals.supabase, me.id, b.id))) return oops('That has more than a status on it, so it stays on your shelf.', 409);
  const { error, count } = await ctx.locals.supabase.from('logs').delete({ count: 'exact' }).eq('id', b.id).eq('user_id', me.id);
  if (error) return oops(dbMessage(error));
  if (!count) return oops('Couldn’t find that entry.', 404);
  return json({ ok: true, href: `/@${me.username}/library/` });
};
