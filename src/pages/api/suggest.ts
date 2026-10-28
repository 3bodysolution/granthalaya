// Weekly: asks a free AI model for Marathi and Hindi books, keeps the ones a real source confirms (see lib/suggest.ts).
// Vercel's cron calls this with `Authorization: Bearer <CRON_SECRET>`. Without CRON_SECRET set, it does nothing.
//   /api/suggest                Mondays Marathi, Thursdays Hindi (UTC): the one weekly cron in vercel.json, no query string needed
//   /api/suggest?lang=mr        add up to 30 Marathi books (the model is asked for 40, then once more if too few pass the checks)
//   /api/suggest?lang=hi&dry=1  show what it would add, change nothing
import type { APIRoute } from 'astro';
import { json } from '../../lib/http';
import { env } from '../../lib/supabase';
import { suggestBooks, LANGS, type Lang } from '../../lib/suggest';
export const prerender = false;

export const GET: APIRoute = async ({ request, url }) => {
  const secret = env('CRON_SECRET');
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) return json({ error: 'Not found.' }, 404);
  const day = new Date().getUTCDay();
  const lang = (url.searchParams.get('lang') ?? (day === 1 ? 'mr' : day === 4 ? 'hi' : '')) as Lang;
  if (!(lang in LANGS)) return json({ ok: true, skipped: 'nothing to do today' });
  try {
    return json({ ok: true, ...(await suggestBooks(lang, { dry: url.searchParams.get('dry') === '1' })) });
  } catch (e) {
    return json({ ok: false, error: String(e instanceof Error ? e.message : e).slice(0, 200) }, 500);
  }
};
