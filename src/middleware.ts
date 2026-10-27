// Runs before every page: old addresses redirect, and we work out who is visiting.
import { defineMiddleware } from 'astro:middleware';
import { serverClient, supabaseReady } from './lib/supabase';
import { site } from './data/site';
import { googleAvatar } from './lib/avatar';
import type { Profile } from './lib/data';
import { withTiming, timingOn, header, summary } from './lib/timing';

// Addresses from the days when this was one person's site keep working.
function oldAddress(path: string): string | null {
  const f = `/@${site.founder}`;
  if (/^\/library\/?$/.test(path)) return `${f}/library/`;
  let m = path.match(/^\/library\/([a-z0-9-]+)\/?$/);
  if (m) return `${f}/library/${m[1]}/`;
  if (/^\/stats\/?$/.test(path)) return `${f}/stats/`;
  if (/^\/notes\/?$/.test(path)) return `${f}/reviews/`;
  if (/^\/threads\/?$/.test(path)) return `${f}/collections/`;
  m = path.match(/^\/threads\/([a-z0-9-]+)\/?$/);
  if (m) return `${f}/collections/${m[1]}/`;
  // Threads became Collections; Notes became Lines, and Lines became Reviews
  m = path.match(/^\/@([^/]+)\/threads(\/.*)?$/);
  if (m) return `/@${m[1]}/collections${m[2] ?? '/'}`;
  m = path.match(/^\/@([^/]+)\/(?:notes|lines)\/?$/);
  if (m) return `/@${m[1]}/reviews/`;
  if (path === '/rss.xml') return `${f}/rss.xml`;
  return null;
}

// Pages someone without a username yet may still open.
const OPEN = /^\/(welcome|signin|auth\/|api\/|privacy|terms|about)/;

export const onRequest = defineMiddleware((ctx, next) => withTiming(() => (CARD.test(ctx.url.pathname) ? logged(ctx.url, () => handle(ctx, next)) : handle(ctx, next)) as Promise<Response>));

// Share cards and the cover copies they use: each one writes a line to the function log (Vercel → Logs) with its steps,
// their times and, when it fails, why. A cold start shows as a long first step.
const CARD = /^\/(story\/|og\/|api\/cover$|@[^/]+\/library\/[^/]+\/story\.png$)/;
const started = Date.now();
async function logged(url: URL, run: () => unknown) {
  const where = `${url.pathname}${url.searchParams.get('w') === '540' ? ' (preview)' : ''}`;
  const age = `instance ${Math.round((Date.now() - started) / 1000)}s old`;
  try {
    const res = (await run()) as Response;
    const why = res.status >= 400 ? ` | failed: ${res.status} ${res.status === 503 ? 'cover too slow' : res.status === 404 ? 'not found or not allowed' : (await res.clone().text().catch(() => '')).slice(0, 80)}` : '';
    const line = `[card] ${where} ${res.status} | ${age} | ${summary()}${why}`;
    if (res.status >= 400) console.warn(line); else console.log(line);
    return res;
  } catch (e) {
    console.error(`[card] ${where} crashed | ${age} | ${summary()} | ${e instanceof Error ? e.message : String(e)}`);
    throw e;
  }
}

const handle: Parameters<typeof defineMiddleware>[0] = async (ctx, next) => {
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
    ctx.locals.user = { id: c.sub, email: c.email, name: meta.full_name || meta.name, avatar: googleAvatar(meta.avatar_url || meta.picture) ?? undefined };
    // your own full row (visitors can't read is_admin, featured or username_changed_at directly)
    const { data: me } = await sb.rpc('my_profile').maybeSingle<Profile>();
    ctx.locals.me = me ?? null;
    // signed in with Google but no username yet: finish setting up first
    if (!me && !OPEN.test(path)) return ctx.redirect(`/welcome?next=${encodeURIComponent(path + ctx.url.search)}`);
  }

  const res = await next();
  // pages change with who's looking, so browsers and the CDN shouldn't keep copies
  try { if (!res.headers.has('Cache-Control')) res.headers.set('Cache-Control', 'private, no-store'); } catch { /* some responses can't be changed */ }
  // dev and preview copies say where the time went (see the Timing tab in the browser's Network panel)
  try { if (timingOn()) res.headers.set('Server-Timing', header()); } catch { /* some responses can't be changed */ }
  return res;
};
