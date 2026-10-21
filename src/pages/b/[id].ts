// Short share address: /b/<Open Library key, gb-<Google id>, or our own address name> → a permanent redirect to the full page (link robots follow it and read the page's preview).
import type { APIRoute } from 'astro';
export const prerender = false;

export const GET: APIRoute = async ({ params, redirect }) => {
  const id = String(params.id ?? '');
  return /^[A-Za-z0-9]+(-[A-Za-z0-9_]+)*$/.test(id) && id.length <= 80 ? redirect(`/book/${id.toLowerCase().startsWith('gb-') ? id : id.toLowerCase()}/`, 301) : new Response('Not found', { status: 404 });
};
