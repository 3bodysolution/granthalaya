import type { APIRoute } from 'astro';
import { checkPassword, startSession, config, json } from '../../lib/server';
export const prerender = false;

let fails: number[] = [];
export const POST: APIRoute = async ({ request, cookies }) => {
  if (!config().password) return json({ error: 'The site has no ADMIN_PASSWORD yet. Add it in Vercel → Settings → Environment Variables.' }, 500);
  const now = Date.now();
  fails = fails.filter((t) => now - t < 10 * 60 * 1000);
  if (fails.length >= 8) return json({ error: 'Too many tries. Wait ten minutes.' }, 429);
  const { password = '' } = await request.json().catch(() => ({}));
  if (!checkPassword(String(password))) { fails.push(now); return json({ error: 'That password didn’t match.' }, 401); }
  startSession(cookies);
  return json({ ok: true });
};
