// Runs before every page: old addresses redirect, and we work out who is visiting.
import { defineMiddleware } from 'astro:middleware';
import { serverClient, supabaseReady } from './lib/supabase';
import { site } from './data/site';
import type { Profile } from './lib/data';

// Addresses from the days when this was one person's site keep working.
function oldAddress(path: string): string | null {
  const f = `/@${site.founder}`;
  if (/^\/library\/?$/.test(path)) return `${f}/library/`;
  let m = path.match(/^\/library\/([a-z0-9-]+)\/?$/);
  if (m) return `${f}/library/${m[1]}/`;
  if (/^\/(notes|stats|threads)\/?$/.test(path)) return `${f}${path.replace(/\/?$/, '/')}`;
  m = path.match(/^\/threads\/([a-z0-9-]+)\/?$/);
  if (m) return `${f}/threads/${m[1]}/`;
  if (path === '/rss.xml') return `${f}/rss.xml`;
  return null;
}

// Pages someone without a username yet may still open.
const OPEN = /^\/(welcome|signin|auth\/|api\/|privacy|terms|about)/;

export const onRequest = defineMiddleware(async (ctx, next) => {
  const path = ctx.url.pathname;
  const old = oldAddress(path);
  if (old) return ctx.redirect(old, 301);
  if (ctx.isPrerendered) return next();

  // If Supabase sends someone back to the wrong page after Google (it falls back to the home page
  // when it doesn't trust the return address), finish signing in or explain what went wrong.
  if (!path.startsWith('/auth/')) {
    const q = ctx.url.searchParams;
    const code = q.get('code');
    if (code && /^[0-9a-f-]{36}$/i.test(code)) {
      return ctx.redirect(`/auth/callback?code=${code}&next=${encodeURIComponent(path)}`);
    }
    if (q.has('error_description') || q.has('error_code')) return ctx.redirect('/signin/?error=google');
  }

  ctx.locals.user = null;
  ctx.locals.me = null;
  if (!supabaseReady()) return next();

  const sb = serverClient(ctx.request, ctx.cookies);
  ctx.locals.supabase = sb;
  const { data } = await sb.auth.getClaims().catch(() => ({ data: null }));
  const c = data?.claims as Record<string, any> | undefined;
  if (c?.sub && c.role === 'authenticated') {
    const meta = (c.user_metadata ?? {}) as Record<string, string>;
    ctx.locals.user = { id: c.sub, email: c.email, name: meta.full_name || meta.name, avatar: meta.avatar_url || meta.picture };
    const { data: me } = await sb.from('profiles').select('*').eq('id', c.sub).maybeSingle<Profile>();
    ctx.locals.me = me ?? null;
    // signed in with Google but no username yet: finish setting up first
    if (!me && !OPEN.test(path)) return ctx.redirect(`/welcome?next=${encodeURIComponent(path + ctx.url.search)}`);
  }

  const res = await next();
  // pages change with who's looking, so browsers and the CDN shouldn't keep copies
  try { if (!res.headers.has('Cache-Control')) res.headers.set('Cache-Control', 'private, no-store'); } catch { /* some responses can't be changed */ }
  return res;
});
