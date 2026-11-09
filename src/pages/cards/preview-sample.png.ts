// A link preview for a shelf, with made-up titles, to check the three-cover layout.
import type { APIRoute } from 'astro';
import { picture } from '../../lib/cards/output';
import { setOrigin } from '../../lib/cards/covers';
// the samples never change between releases: Vercel's CDN may keep them a long time
const LONG = 'public, max-age=3600, s-maxage=2592000, stale-while-revalidate=86400';
import { drawPreview } from '../../lib/cards/preview';
export const prerender = false;

export const GET: APIRoute = async ({ url }) => {
  setOrigin(url.origin);
  const cover = url.searchParams.get('cover');   // one real cover, to try a pale or dark one
  const png = cover ? await drawPreview({ noText: import.meta.env.DEV && url.searchParams.has('notext'), kicker: 'Book', accent: 'book', title: 'The Sample Book', meta: '1999 | by A. Writer', line: 'A line about the book goes here.', covers: [{ src: cover, title: 'The Sample Book' }] }) : await drawPreview({ noText: import.meta.env.DEV && url.searchParams.has('notext'),
    kicker: 'Shelf', title: 'Sarthak', meta: '@sarthak', line: 'Books, films and what I thought of them.',
    covers: [{ title: 'श्यामची आई' }, { title: 'ययाति' }, { title: 'Paterson' }],
  });
  return picture(png, LONG);
};
