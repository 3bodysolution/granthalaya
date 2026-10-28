// Short share address: /f/<tmdb id> → a permanent redirect straight to the full page, name included (link robots follow it and read the page's preview).
import type { APIRoute } from 'astro';
import { getJSON, base } from '../../lib/catalog/fetch';
import { env } from '../../lib/supabase';
import { filmHref } from '../../lib/catalog/tmdb';
export const prerender = false;

export const GET: APIRoute = async ({ params, redirect }) => {
  const id = String(params.id ?? '');
  if (!/^\d{1,9}$/.test(id)) return new Response('Not found', { status: 404 });
  const m = await getJSON(`${base.tmdb()}/movie/${id}?api_key=${env('TMDB_API_KEY')}`, { ttl: 86400, ms: 2500 });
  // if TMDB can't be reached just now, the short page address works too (it names itself), but isn't made permanent
  return m?.title ? redirect(filmHref(+id, m.title), 301) : redirect(`/film/${id}/`, 302);
};
