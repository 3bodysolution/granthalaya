// A "My year" card with made-up titles, to check the layout. No one's shelf is used.
import type { APIRoute } from 'astro';
import { isBackground } from '../../lib/cards/backgrounds';
import { drawYear } from '../../lib/cards/year';
export const prerender = false;

const names = ['श्यामची आई', 'ययाति', 'Paterson', 'Dune', 'Killa', 'मृत्युंजय', 'Stoner', 'Perfect Days', 'Train to Pakistan', 'Spirited Away', 'Piranesi', 'Past Lives'];
export const GET: APIRoute = async ({ url }) => {
  const asked = url.searchParams.get('bg');
  const bg = isBackground(asked) ? asked : undefined;
  const png = await drawYear({ bg,
    year: 2026, owner: 'sarthak', books: 48, films: 121, essays: 0,
    months: names.map((title, i) => (i === 10 ? null : { title })), favourite: 8,
  });
  return new Response(png, { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=300' } });
};
