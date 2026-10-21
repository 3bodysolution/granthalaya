// A story card with fixed sample text, to check that Marathi letters, digits and the picture tools work on the live site.
import type { APIRoute } from 'astro';
import { drawStory } from '../../lib/cards/story';
export const prerender = false;

export const GET: APIRoute = async () => {
  const png = await drawStory({
    kind: 'film', title: 'श्यामची आई', year: 1953, creator: 'आचार्य अत्रे', rating: 4.5, status: 'Watched',
    line: 'मळलेली वाट, क्षण, त्रास, ज्ञान: ०१२३४५६७८९. Ā ī ū ṣ',
    owner: 'sarthak',
  });
  return new Response(png, { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=300' } });
};
