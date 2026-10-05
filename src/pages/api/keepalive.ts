// Once a day Vercel calls this, so the free database never sleeps from a quiet week.
import type { APIRoute } from 'astro';
import { json } from '../../lib/http';
export const prerender = false;

export const GET: APIRoute = async ({ locals }) => {
  if (!locals.supabase) return json({ ok: false, why: 'not set up' }, 503);
  const { error } = await locals.supabase.from('titles').select('id').limit(1);
  return json({ ok: !error });
};
