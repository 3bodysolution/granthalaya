// Google has said who this is: start the session, then go home (or to Welcome if they're new).
import type { APIRoute } from 'astro';
import { safeNext } from '../../lib/nav';
export const prerender = false;

export const GET: APIRoute = async ({ locals, url, redirect }) => {
  const code = url.searchParams.get('code');
  const next = safeNext(url.searchParams.get('next'));
  if (!code || !locals.supabase) return redirect('/signin/?error=google');
  const { data, error } = await locals.supabase.auth.exchangeCodeForSession(code);
  if (error || !data.user) return redirect('/signin/?error=google');
  const { data: me } = await locals.supabase.from('profiles').select('username').eq('id', data.user.id).maybeSingle();
  if (!me) return redirect(`/welcome/?next=${encodeURIComponent(next)}`);
  return redirect(next);
};
