// A "My year" card with made-up titles, to check the layout. No one's shelf is used.
import type { APIRoute } from 'astro';
import { drawYear } from '../../lib/cards/year';
export const prerender = false;

const names = ['श्यामची आई', 'ययाति', 'Paterson', 'Dune', 'Killa', 'मृत्युंजय', 'Stoner', 'Perfect Days', 'Train to Pakistan', 'Spirited Away', 'Piranesi', 'Past Lives'];
export const GET: APIRoute = async () => {
  const png = await drawYear({
    year: 2026, owner: 'sarthak', name: 'Sarthak', books: 12, films: 40, essays: 9,
    covers: names.map((title, i) => ({ title, kind: i % 2 ? 'book' : 'film' })),
  });
  return new Response(png, { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=300' } });
};
