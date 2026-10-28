// Short share address: /t/<tmdb id> → a permanent redirect straight to the full page, name included (link robots follow it and read the page's preview).
import type { APIRoute } from 'astro';
import { getJSON, base } from '../../lib/catalog/fetch';
import { env } from '../../lib/supabase';
import { showHref } from '../../lib/catalog/tmdb';
export const prerender = false;

export const GET: APIRoute = async ({ params, redirect }) => {
  const id = String(params.id ?? '');
  if (!/^\d{1,9}$/.test(id)) return new Response('Not found', { status: 404 });
  const t = await getJSON(`${base.tmdb()}/tv/${id}?api_key=${env('TMDB_API_KEY')}`, { ttl: 86400, ms: 2500 });
  return t?.name ? redirect(showHref(+id, t.name), 301) : redirect(`/tv/${id}/`, 302);
};
