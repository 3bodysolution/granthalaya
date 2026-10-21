// A link preview for a shelf, with made-up titles, to check the three-cover layout.
import type { APIRoute } from 'astro';
import { drawPreview } from '../../lib/cards/preview';
export const prerender = false;

export const GET: APIRoute = async () => {
  const png = await drawPreview({
    kicker: 'Shelf', title: 'Sarthak', meta: '@sarthak', line: 'Books, films and the lines I keep.',
    covers: [{ title: 'श्यामची आई' }, { title: 'ययाति' }, { title: 'Paterson' }],
  });
  return new Response(png, { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=300' } });
};
