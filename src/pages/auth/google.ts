// Start "Continue with Google". Google sends the person back to /auth/callback.
import type { APIRoute } from 'astro';
import { safeNext } from '../../lib/nav';
export const prerender = false;

export const GET: APIRoute = async ({ locals, url, redirect }) => {
  if (!locals.supabase) return redirect('/signin/?error=setup');
  const next = safeNext(url.searchParams.get('next'));
  const { data, error } = await locals.supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: `${url.origin}/auth/callback?next=${encodeURIComponent(next)}`, queryParams: { prompt: 'select_account' } },
  });
  if (error || !data?.url) return redirect('/signin/?error=google');
  return redirect(data.url);
};
