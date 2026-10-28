// A link preview for a shelf, with made-up titles, to check the three-cover layout.
import type { APIRoute } from 'astro';
import { isBackground } from '../../lib/cards/backgrounds';
import { picture } from '../../lib/cards/output';
import { setOrigin } from '../../lib/cards/covers';
// the samples never change between releases: Vercel's CDN may keep them a long time
const LONG = 'public, max-age=3600, s-maxage=2592000, stale-while-revalidate=86400';
import { drawPreview } from '../../lib/cards/preview';
export const prerender = false;

export const GET: APIRoute = async ({ url }) => {
  setOrigin(url.origin);
  const asked = url.searchParams.get('bg');
  const bg = isBackground(asked) ? asked : undefined;
  const png = await drawPreview({ bg,
    kicker: 'Shelf', title: 'Sarthak', meta: '@sarthak', line: 'Books, films and what I thought of them.',
    covers: [{ title: 'श्यामची आई' }, { title: 'ययाति' }, { title: 'Paterson' }],
  });
  return picture(png, LONG);
};
