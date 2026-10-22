// Report a profile, an entry (a review) or a comment on a review. Reports go to the admin page.
import type { APIRoute } from 'astro';
import { json, oops, body, str, needMe, sameOrigin } from '../../lib/http';
import { dbMessage } from '../../lib/supabase';
export const prerender = false;

const REASONS = ['spam', 'abuse', 'sexual', 'hate', 'illegal', 'other'];
const uuid = (v: unknown) => (typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v) ? v : null);

export const POST: APIRoute = async (ctx) => {
  if (!sameOrigin(ctx)) return oops('Please try again from the site.', 403);
  const { me, res } = needMe(ctx);
  if (res) return res;
  const b = await body<Record<string, unknown>>(ctx.request);
  const user = uuid(b?.user), log = uuid(b?.log), comment = uuid(b?.comment);
  if (!user && !log && !comment) return oops('What are you reporting?');
  if (user === me.id) return oops('That’s you.');
  const reason = REASONS.includes(String(b?.reason)) ? String(b?.reason) : 'other';
  const { error } = await ctx.locals.supabase.from('reports').insert({ reporter: me.id, target_user: user, target_log: log, target_comment: comment, reason, details: str(b?.details, 1000) ?? '' });
  if (error) return oops(dbMessage(error));
  return json({ ok: true });
};
