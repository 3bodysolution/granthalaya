// A story card with fixed sample text, to check that Marathi letters, digits and the picture tools work on the live site.
import type { APIRoute } from 'astro';
import { isBackground } from '../../lib/cards/backgrounds';
import { picture } from '../../lib/cards/output';
import { setOrigin } from '../../lib/cards/covers';
// the samples never change between releases: Vercel's CDN may keep them a long time
const LONG = 'public, max-age=3600, s-maxage=2592000, stale-while-revalidate=86400';
import { drawStory } from '../../lib/cards/story';
export const prerender = false;

export const GET: APIRoute = async ({ url }) => {
  setOrigin(url.origin);
  const asked = url.searchParams.get('bg');
  const bg = isBackground(asked) ? asked : undefined;
  const w = url.searchParams.get('w') === '540' ? 540 : 1080;
  if (url.searchParams.get('kind') === 'book') {
    const png = await drawStory({ bg, cover: url.searchParams.get('cover') ?? undefined, kind: 'book', title: 'ययाति', year: 1959, creator: 'वि. स. खांडेकर', rating: 5, status: 'Read', line: 'एका राजाची कहाणी आणि सुखाची भूक', owner: 'sarthak' }, w);
    return picture(png, LONG);
  }
  const png = await drawStory({ bg, cover: url.searchParams.get('cover') ?? undefined,
    kind: 'film', title: 'श्यामची आई', year: 1953, creator: 'आचार्य अत्रे', rating: 4.5, status: 'Watched',
    line: 'एका मुलाची आणि त्याच्या आईची गोष्ट',
    owner: 'sarthak',
  }, w);
  return picture(png, LONG);
};
