import type { APIRoute } from 'astro';
import { oops, sameOrigin } from '../../lib/http';
export const prerender = false;

export const POST: APIRoute = async (ctx) => {
  if (!sameOrigin(ctx)) return oops('Please try again from the site.', 403);
  await ctx.locals.supabase?.auth.signOut().catch(() => { /* best-effort */ });
  return ctx.redirect('/');
};
