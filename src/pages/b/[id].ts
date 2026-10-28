// Short share address: /b/<Open Library key, gb-<Google id>, or our own address name> → a permanent redirect straight to the full page, name included (link robots follow it and read the page's preview).
import type { APIRoute } from 'astro';
import { getJSON, base } from '../../lib/catalog/fetch';
import { bookHref } from '../../lib/catalog/books';
export const prerender = false;

export const GET: APIRoute = async ({ params, redirect }) => {
  const id = String(params.id ?? '');
  if (!(/^[A-Za-z0-9]+(-[A-Za-z0-9_]+)*$/.test(id) && id.length <= 80)) return new Response('Not found', { status: 404 });
  const key = id.toLowerCase().startsWith('gb-') ? id : id.toLowerCase();
  // an Open Library work: add the book's name to the address
  if (/^ol\d+w$/.test(key)) {
    const w = await getJSON(`${base.ol()}/works/${key.toUpperCase()}.json`, { ttl: 86400, ms: 2500 });
    if (w?.title) return redirect(bookHref(key, w.title), 301);
    return redirect(`/book/${key}/`, 302);
  }
  return redirect(`/book/${key}/`, 301);
};
