// Your collections (stored in the `threads` tables): list them, make one, add or remove titles, write the
// line about each title, change the order, rename, or delete. Everything goes through your own database
// connection, so you can only ever change your own collections.
import type { APIRoute } from 'astro';
import { json, oops, body, str, needMe, sameOrigin } from '../../lib/http';
import { dbMessage } from '../../lib/supabase';
import { cleanHit, titleFor, slugify } from '../../lib/titles';
export const prerender = false;

const UUID = /^[0-9a-f-]{36}$/i;

export const GET: APIRoute = async (ctx) => {
  const { me, res } = needMe(ctx);
  if (res) return res;
  const title = ctx.url.searchParams.get('title');
  const { data, error } = await ctx.locals.supabase.from('threads')
    .select('id, slug, name, thread_items(title_id)').eq('user_id', me.id).order('created_at', { ascending: false });
  if (error) return oops(dbMessage(error));
  return json({
    ok: true,
    collections: ((data ?? []) as { id: string; slug: string; name: string; thread_items?: { title_id: string }[] }[]).map((t) => ({
      id: t.id, slug: t.slug, name: t.name, count: (t.thread_items ?? []).length,
      has: !!title && (t.thread_items ?? []).some((i) => i.title_id === title),
    })),
  });
};

export const POST: APIRoute = async (ctx) => {
  if (!sameOrigin(ctx)) return oops('Please try again from the site.', 403);
  const { me: who, res } = needMe(ctx);
  if (res || !who) return res!;
  const me = who;
  const b = await body<Record<string, any>>(ctx.request);
  if (!b || typeof b.action !== 'string') return oops('Nothing to do.');
  const sb = ctx.locals.supabase;

  // which title, if any: one in the catalogue, or something just found (added to the catalogue now)
  async function theTitle(): Promise<string | { error: string } | null> {
    if (typeof b!.title === 'string' && UUID.test(b!.title)) return b!.title;
    if (!b!.hit) return null;
    const hit = cleanHit(b!.hit);
    if (!hit) return { error: 'A title is needed.' };
    const t = await titleFor(hit, me.id);
    return 'error' in t ? t : t.id;
  }
  async function mine(id: unknown) {
    if (typeof id !== 'string' || !UUID.test(id)) return null;
    const { data } = await sb.from('threads').select('id, slug').eq('id', id).eq('user_id', me.id).maybeSingle();
    return data;
  }
  async function addTo(threadId: string, titleId: string) {
    const { data: last } = await sb.from('thread_items').select('position').eq('thread_id', threadId).order('position', { ascending: false }).limit(1).maybeSingle();
    const { count } = await sb.from('thread_items').select('title_id', { count: 'exact', head: true }).eq('thread_id', threadId);
    if ((count ?? 0) >= 200) return 'A collection can hold 200 things.';
    const { error } = await sb.from('thread_items').upsert({ thread_id: threadId, title_id: titleId, user_id: me.id, position: (last?.position ?? -1) + 1 }, { onConflict: 'thread_id,title_id', ignoreDuplicates: true });
    return error ? dbMessage(error) : null;
  }

  if (b.action === 'create') {
    const name = str(b.name, 120);
    if (!name) return oops('Give it a name.');
    const { count } = await sb.from('threads').select('id', { count: 'exact', head: true }).eq('user_id', me.id);
    if ((count ?? 0) >= 200) return oops('You have 200 collections, which is the most for now.');
    const base = slugify(name).slice(0, 60);
    const { data: taken } = await sb.from('threads').select('slug').eq('user_id', me.id).like('slug', `${base}%`);
    const used = new Set((taken ?? []).map((t) => t.slug));
    let slug = base;
    for (let i = 2; used.has(slug); i++) slug = `${base}-${i}`;
    const { data: made, error } = await sb.from('threads').insert({ user_id: me.id, slug, name, intro: str(b.intro, 1000) ?? '' }).select('id, slug').single();
    if (error || !made) return oops(dbMessage(error));
    const t = await theTitle();
    if (t && typeof t === 'object') return oops(t.error);
    if (t) { const e = await addTo(made.id, t); if (e) return oops(e); }
    return json({ ok: true, id: made.id, slug: made.slug, href: `/@${me.username}/collections/${made.slug}/`, title: t ?? undefined });
  }

  const col = await mine(b.collection);
  if (!col) return oops('Couldn’t find that collection.', 404);

  if (b.action === 'add') {
    const t = await theTitle();
    if (!t) return oops('A title is needed.');
    if (typeof t === 'object') return oops(t.error);
    const e = await addTo(col.id, t);
    return e ? oops(e) : json({ ok: true, title: t });
  }
  if (b.action === 'remove') {
    if (typeof b.title !== 'string' || !UUID.test(b.title)) return oops('A title is needed.');
    const { error } = await sb.from('thread_items').delete().eq('thread_id', col.id).eq('title_id', b.title).eq('user_id', me.id);
    return error ? oops(dbMessage(error)) : json({ ok: true });
  }
  if (b.action === 'why') {
    if (typeof b.title !== 'string' || !UUID.test(b.title)) return oops('A title is needed.');
    const { error } = await sb.from('thread_items').update({ why: str(b.why, 300) ?? '' }).eq('thread_id', col.id).eq('title_id', b.title).eq('user_id', me.id);
    return error ? oops(dbMessage(error)) : json({ ok: true });
  }
  if (b.action === 'move') {
    if (typeof b.title !== 'string' || !UUID.test(b.title)) return oops('A title is needed.');
    const { data: items } = await sb.from('thread_items').select('title_id, position').eq('thread_id', col.id).order('position');
    const list = (items ?? []).map((i) => i.title_id);
    const at = list.indexOf(b.title);
    const to = at + (b.dir === -1 ? -1 : 1);
    if (at < 0 || to < 0 || to >= list.length) return json({ ok: true });
    [list[at], list[to]] = [list[to], list[at]];
    for (let i = 0; i < list.length; i++) {
      const { error } = await sb.from('thread_items').update({ position: i }).eq('thread_id', col.id).eq('title_id', list[i]).eq('user_id', me.id);
      if (error) return oops(dbMessage(error));
    }
    return json({ ok: true });
  }
  if (b.action === 'update') {
    const change: Record<string, string> = {};
    if (b.name !== undefined) { const n = str(b.name, 120); if (!n) return oops('Give it a name.'); change.name = n; }
    if (b.intro !== undefined) change.intro = str(b.intro, 1000) ?? '';
    const { error } = await sb.from('threads').update(change).eq('id', col.id).eq('user_id', me.id);
    return error ? oops(dbMessage(error)) : json({ ok: true });
  }
  if (b.action === 'delete') {
    const { error } = await sb.from('threads').delete().eq('id', col.id).eq('user_id', me.id);
    return error ? oops(dbMessage(error)) : json({ ok: true, href: `/@${me.username}/collections/` });
  }
  return oops('Nothing to do.');
};
