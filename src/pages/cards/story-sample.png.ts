// A story card with fixed sample text, to check that Marathi letters, digits and the picture tools work on the live site.
import type { APIRoute } from 'astro';
import { drawStory } from '../../lib/cards/story';
export const prerender = false;

export const GET: APIRoute = async ({ url }) => {
  if (url.searchParams.get('kind') === 'book') {
    const png = await drawStory({ kind: 'book', title: 'ययाति', year: 1959, creator: 'वि. स. खांडेकर', rating: 5, status: 'Read', line: 'एका राजाची कहाणी आणि सुखाची भूक', owner: 'sarthak' });
    return new Response(png, { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=300' } });
  }
  const png = await drawStory({
    kind: 'film', title: 'श्यामची आई', year: 1953, creator: 'आचार्य अत्रे', rating: 4.5, status: 'Watched',
    line: 'एका मुलाची आणि त्याच्या आईची गोष्ट',
    owner: 'sarthak',
  });
  return new Response(png, { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=300' } });
};
