import type { APIRoute } from 'astro';
import { json, oops } from '../../lib/http';
import { usernameStatus } from '../../lib/usernames';
export const prerender = false;

export const GET: APIRoute = async ({ locals, url }) => {
  if (!locals.user) return oops('Please sign in again.', 401);
  const u = (url.searchParams.get('u') ?? '').trim().toLowerCase().replace(/^@/, '');
  return json(await usernameStatus(u, locals.user.id));
};
