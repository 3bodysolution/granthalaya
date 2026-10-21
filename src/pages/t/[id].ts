// Short share address: /t/<tmdb id> → a permanent redirect to the full page (link robots follow it and read the page's preview).
import type { APIRoute } from 'astro';
export const prerender = false;

export const GET: APIRoute = async ({ params, redirect }) => {
  const id = String(params.id ?? '');
  return /^\d{1,9}$/.test(id) ? redirect(`/tv/${id}/`, 301) : new Response('Not found', { status: 404 });
};
