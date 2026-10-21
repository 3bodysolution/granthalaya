// A "My year" card with made-up titles, to check the layout. No one's shelf is used.
import type { APIRoute } from 'astro';
import { isBackground } from '../../lib/cards/backgrounds';
import { picture } from '../../lib/cards/output';
import { setOrigin } from '../../lib/cards/covers';
// the samples never change between releases: Vercel's CDN may keep them a long time
const LONG = 'public, max-age=3600, s-maxage=2592000, stale-while-revalidate=86400';
import { drawYear } from '../../lib/cards/year';
export const prerender = false;

const names = ['श्यामची आई', 'ययाति', 'Paterson', 'Dune', 'Killa', 'मृत्युंजय', 'Stoner', 'Perfect Days', 'Train to Pakistan', 'Spirited Away', 'Piranesi', 'Past Lives'];
export const GET: APIRoute = async ({ url }) => {
  setOrigin(url.origin);
  const asked = url.searchParams.get('bg');
  const bg = isBackground(asked) ? asked : undefined;
  const w = url.searchParams.get('w') === '540' ? 540 : 1080;
  const png = await drawYear({ bg,
    year: 2026, owner: 'sarthak', books: 48, films: 121, essays: 0,
    months: names.map((title, i) => (i === 10 ? null : { title })), favourite: 8, fav: { title: names[8], cover: url.searchParams.get('cover') ?? undefined },
  }, w);
  return picture(png, LONG);
};
