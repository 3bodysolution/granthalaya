// Delete your account: profile, shelf, notes and lines, for good.
import type { APIRoute } from 'astro';
import { json, oops, body, needMe, sameOrigin } from '../../lib/http';
import { adminClient } from '../../lib/supabase';
export const prerender = false;

export const DELETE: APIRoute = async (ctx) => {
  if (!sameOrigin(ctx)) return oops('Please try again from the site.', 403);
  const { me, res } = needMe(ctx);
  if (res) return res;
  const b = await body<{ confirm?: string }>(ctx.request);
  if ((b?.confirm ?? '').toLowerCase() !== me.username) return oops('Type your username exactly to confirm.');
  // removing the sign-in removes everything that hangs off it (profile, shelf, lines, collections, blocks)
  const { error } = await adminClient().auth.admin.deleteUser(me.id);
  if (error) return oops('Couldn’t delete the account just now. Please try again.', 500);
  await ctx.locals.supabase.auth.signOut().catch(() => {});
  return json({ ok: true });
};
