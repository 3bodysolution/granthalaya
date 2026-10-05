// Block (POST) or unblock (DELETE) someone. Quiet: they aren't told.
import type { APIRoute } from 'astro';
import { json, oops, body, needMe, sameOrigin } from '../../lib/http';
import { dbMessage } from '../../lib/supabase';
export const prerender = false;

const target = async (request: Request) => {
  const b = await body<{ id?: string }>(request);
  return b?.id && /^[0-9a-f-]{36}$/i.test(b.id) ? b.id : null;
};

export const POST: APIRoute = async (ctx) => {
  if (!sameOrigin(ctx)) return oops('Please try again from the site.', 403);
  const { me, res } = needMe(ctx);
  if (res) return res;
  const id = await target(ctx.request);
  if (!id || id === me.id) return oops('Who?');
  const { error } = await ctx.locals.supabase.from('blocks').upsert({ blocker: me.id, blocked: id }, { onConflict: 'blocker,blocked', ignoreDuplicates: true });
  if (error) return oops(dbMessage(error));
  // a blocked person's title shouldn't stay among your favourites' neighbours; nothing else to tidy
  return json({ ok: true });
};

export const DELETE: APIRoute = async (ctx) => {
  if (!sameOrigin(ctx)) return oops('Please try again from the site.', 403);
  const { me, res } = needMe(ctx);
  if (res) return res;
  const id = await target(ctx.request);
  if (!id) return oops('Who?');
  const { error } = await ctx.locals.supabase.from('blocks').delete().eq('blocker', me.id).eq('blocked', id);
  if (error) return oops(dbMessage(error));
  return json({ ok: true });
};
