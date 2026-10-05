// Search for something to add: ?type=book|film|tv|essay&q=… (or a pasted link), ?show=<id> for a show's seasons.
import type { APIRoute } from 'astro';
import { json, oops } from '../../lib/http';
import { books, films, shows, showSeasons, link } from '../../lib/lookup';
export const prerender = false;

export const GET: APIRoute = async ({ locals, url }) => {
  if (!locals.me) return oops('Please sign in again.', 401);
  const q = (url.searchParams.get('q') ?? '').trim().slice(0, 300);
  const type = url.searchParams.get('type') ?? 'book';
  const show = Number(url.searchParams.get('show'));
  try {
    if (show) {
      const s = await showSeasons(show);
      return s ? json({ show: s }) : oops('Couldn’t find that show.', 404);
    }
    if (!q) return json({ hits: [] });
    if (/^https?:\/\//i.test(q)) return json({ hits: await link(q) });
    if (type === 'essay') return json({ hits: [], hint: 'Paste the link to the essay or article.' });
    const hits = type === 'film' ? await films(q) : type === 'tv' ? await shows(q) : await books(q);
    return json({ hits });
  } catch {
    return oops('We couldn’t look that up. Fill it in by hand instead.', 422);
  }
};
