// A new shelf: username, name, a line about you, private or not.
import type { APIRoute } from 'astro';
import { json, oops, body, str, sameOrigin } from '../../lib/http';
import { usernameStatus } from '../../lib/usernames';
import { isHuman } from '../../lib/turnstile';
import { dbMessage, adminClient } from '../../lib/supabase';
import { trustedGooglePhoto } from '../../lib/avatar';
import { safeNext } from '../../lib/nav';
export const prerender = false;

export const POST: APIRoute = async (ctx) => {
  const { locals, request, clientAddress } = ctx;
  if (!sameOrigin(ctx)) return oops('Please try again from the site.', 403);
  const user = locals.user;
  if (!user) return oops('Please sign in again.', 401);
  if (locals.me) return json({ ok: true, next: `/@${locals.me.username}/` });
  const b = await body(request);
  if (!b) return oops('Nothing to save.');
  if (b.agree !== true) return oops('Please agree to the terms and privacy policy.');
  let ip: string | null = null;
  try { ip = clientAddress; } catch { /* address-less (local dev) */ }
  if (!(await isHuman(b.turnstile, ip, ctx.url.host))) return oops('The quick check didn’t go through. Please wait a moment and try again.');

  const username = (str(b.username, 40) ?? '').toLowerCase().replace(/^@/, '');
  const check = await usernameStatus(username, user.id);
  if (!check.ok) return oops(check.message);
  const name = str(b.name, 60) ?? user.name ?? username;

  const sb = locals.supabase;
  const { error } = await sb.from('profiles').insert({ id: user.id, username, display_name: name, is_private: b.private === true });
  if (error) return oops(error.code === '23505' ? 'Someone just took that username. Try another.' : dbMessage(error));
  // the photo comes from their Google sign-in; people can't write that column themselves
  const avatar = await trustedGooglePhoto(sb);
  if (avatar) await adminClient().from('profiles').update({ avatar_url: avatar }).eq('id', user.id);
  const { error: e2 } = await sb.from('profile_details').insert({ id: user.id, bio: str(b.bio, 160) ?? '' });
  if (e2) return oops(dbMessage(e2));
  // new shelves start at home, which offers "Add your first book, film, show or essay"
  return json({ ok: true, next: safeNext(str(b.next, 300), '/') });
};
