// The home page's wall of posters and covers (lib/catalog/wall.ts), as plain JSON for everyone. One pick a day, so Vercel's CDN
// keeps it until tomorrow morning (India time); a thin pick (TMDB or the database was down) is kept only a few minutes.
import type { APIRoute } from 'astro';
import { loadWall, untilTomorrow } from '../../lib/catalog/wall';
export const prerender = false;

export const GET: APIRoute = async () => {
  const wall = await loadWall().catch(() => null);
  const ok = !!wall?.full;
  const age = ok ? untilTomorrow() : 300;
  return new Response(JSON.stringify({ tiles: wall?.tiles ?? [] }), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': `public, max-age=${Math.min(age, 3600)}, s-maxage=${age}, stale-while-revalidate=3600`,
    },
  });
};
