// Your shelf: add something (POST), change it (PATCH), or remove it (DELETE).
import type { APIRoute, APIContext } from 'astro';
import { json, oops, body, str, isoDate, needMe, sameOrigin } from '../../lib/http';
import { dbMessage } from '../../lib/supabase';
import { cleanHit, titleFor } from '../../lib/titles';
import { statusFits, type Kind, type Status } from '../../lib/kinds';
export const prerender = false;

const today = () => new Date().toISOString().slice(0, 10);
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
    where_seen: str(b.where, 80) ?? '',
    only_me: b.onlyMe === true,
  };
}
/** the lines you underlined, checked */
function lines(b: Record<string, any>) {
  const list = Array.isArray(b.lines) ? b.lines : b.line ? [b.line] : [];
  return list.slice(0, 50).map((l: any, i: number) => ({
    body: str(l?.text, 2000), where_at: str(l?.where, 80) ?? '', note: str(l?.note, 1000) ?? '', mine: l?.mine === true, position: i,
  })).filter((l: any) => l.body);
}

async function kindOf(ctx: APIContext, titleId: string): Promise<{ kind: Kind; slug: string } | null> {
  const { data } = await ctx.locals.supabase.from('titles').select('kind, slug').eq('id', titleId).maybeSingle();
  return (data as any) ?? null;
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
  const status = String(b.status ?? 'done');
  if (!statusFits(t.kind, status)) return oops('Pick a status.');

  const sb = ctx.locals.supabase;
  const row = { user_id: me.id, title_id: titleId, ...fields(b, t.kind, status) };
  const { data, error } = await sb.from('logs').insert(row).select('id').single();
  if (error || !data) return oops(dbMessage(error));
  const hl = lines(b).map((l) => ({ ...l, log_id: data.id, user_id: me.id }));
  if (hl.length) {
    const { error: e2 } = await sb.from('highlights').insert(hl);
    if (e2) return oops(dbMessage(e2, 'Saved, but the line you underlined didn’t save. Edit the entry to add it again.'));
  }
  return json({ ok: true, id: data.id, href: `/@${me.username}/library/${t.slug}/` });
};

export const PATCH: APIRoute = async (ctx) => {
  if (!sameOrigin(ctx)) return oops('Please try again from the site.', 403);
  const { me, res } = needMe(ctx);
  if (res) return res;
  const b = await body<Record<string, any>>(ctx.request);
  if (!b || typeof b.id !== 'string') return oops('Nothing to change.');
  const sb = ctx.locals.supabase;
  const { data: cur } = await sb.from('logs').select('id, user_id, status, started_on, finished_on, title:titles(kind, slug)').eq('id', b.id).eq('user_id', me.id).maybeSingle<any>();
  if (!cur) return oops('Couldn’t find that entry.', 404);
  const kind = cur.title.kind as Kind;

  let change: Record<string, unknown>;
  if (b.full === true) {
    // the whole entry, from the edit screen
    const status = String(b.status ?? cur.status);
    if (!statusFits(kind, status)) return oops('Pick a status.');
    change = fields(b, kind, status);
  } else {
    // a quick status change from the entry page
    const status = String(b.status ?? '');
    if (!statusFits(kind, status)) return oops('That status doesn’t fit here.');
    change = { status };
    if (status === 'done') change.finished_on = cur.finished_on ?? today();
    else change.finished_on = null;
    if ((status === 'reading' || status === 'watching') && !cur.started_on) change.started_on = today();
    if (status === 'want') { change.started_on = null; change.rating = null; change.loved = false; }
    if (status !== 'done') { change.rating = null; change.loved = false; }
  }
  const { error } = await sb.from('logs').update(change).eq('id', cur.id).eq('user_id', me.id);
  if (error) return oops(dbMessage(error));
  if (b.full === true) {
    await sb.from('highlights').delete().eq('log_id', cur.id).eq('user_id', me.id);
    const hl = lines(b).map((l) => ({ ...l, log_id: cur.id, user_id: me.id }));
    if (hl.length) {
      const { error: e2 } = await sb.from('highlights').insert(hl);
      if (e2) return oops(dbMessage(e2));
    }
  }
  return json({ ok: true, id: cur.id, href: `/@${me.username}/library/${cur.title.slug}/` });
};

export const DELETE: APIRoute = async (ctx) => {
  if (!sameOrigin(ctx)) return oops('Please try again from the site.', 403);
  const { me, res } = needMe(ctx);
  if (res) return res;
  const b = await body<Record<string, any>>(ctx.request);
  if (!b || typeof b.id !== 'string') return oops('Nothing to remove.');
  const { error, count } = await ctx.locals.supabase.from('logs').delete({ count: 'exact' }).eq('id', b.id).eq('user_id', me.id);
  if (error) return oops(dbMessage(error));
  if (!count) return oops('Couldn’t find that entry.', 404);
  return json({ ok: true, href: `/@${me.username}/library/` });
};
