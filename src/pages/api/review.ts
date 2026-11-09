// Likes and comments on a review: like or unlike, comment (POST), delete a comment (DELETE).
// Everything goes through the visitor's own connection, so the database decides what they may do:
// only a review they can see, only as themselves, and a comment is deleted only by its author or the review's owner.
import type { APIRoute } from 'astro';
import { json, oops, body, str, needMe, sameOrigin } from '../../lib/http';
import { dbMessage } from '../../lib/supabase';
export const prerender = false;

const uuid = (v: unknown) => (typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v) ? v : null);

export const POST: APIRoute = async (ctx) => {
  if (!sameOrigin(ctx)) return oops('Please try again from the site.', 403);
  const { me, res } = needMe(ctx);
  if (res) return res;
  const b = await body<Record<string, unknown>>(ctx.request);
  const id = uuid(b?.id);
  if (!id) return oops('Which review?');
  const sb = ctx.locals.supabase;

  if (b?.action === 'like') {
    if (b.on === false) {
      const { error } = await sb.from('review_likes').delete().eq('log_id', id).eq('user_id', me.id);
      if (error) return oops(dbMessage(error));
    } else {
      const { error } = await sb.from('review_likes').insert({ log_id: id, user_id: me.id });
      if (error && error.code !== '23505') return oops(dbMessage(error, 'Couldn’t like that review.'));   // 23505: already liked
    }
    const { count } = await sb.from('review_likes').select('log_id', { count: 'exact', head: true }).eq('log_id', id);
    return json({ ok: true, likes: count ?? 0 });
  }

  if (b?.action === 'comment') {
    const text = str(b.body, 1000);
    if (!text) return oops('Write something first.');
    // the same words from the same member on the same review within 30 seconds is a double send: refuse it
    const { data: dup } = await sb.from('review_comments').select('id').eq('log_id', id).eq('user_id', me.id).eq('body', text)
      .gte('created_at', new Date(Date.now() - 30_000).toISOString()).limit(1);
    if (dup?.length) return oops('You just posted that.', 409);
    const { data, error } = await sb.from('review_comments').insert({ log_id: id, user_id: me.id, body: text }).select('id, created_at').maybeSingle();
    if (error) return oops(dbMessage(error, 'Couldn’t post that comment.'));
    return json({ ok: true, comment: data ? { id: data.id, date: data.created_at, body: text } : null });
  }
  return oops('Unknown action.');
};

export const DELETE: APIRoute = async (ctx) => {
  if (!sameOrigin(ctx)) return oops('Please try again from the site.', 403);
  const { res } = needMe(ctx);
  if (res) return res;
  const b = await body<Record<string, unknown>>(ctx.request);
  const id = uuid(b?.comment);
  if (!id) return oops('Which comment?');
  const { error, count } = await ctx.locals.supabase.from('review_comments').delete({ count: 'exact' }).eq('id', id);
  if (error) return oops(dbMessage(error));
  if (!count) return oops('Couldn’t find that comment.', 404);
  return json({ ok: true });
};
