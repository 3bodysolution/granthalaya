// A copy of a cover, for the share cards: /api/cover?u=<cover address>. Public, and kept by Vercel's CDN for 30 days, so the next
// card that needs the same poster gets it at once. It is a small fetch-for-anyone door, so it is strict:
//   · only our cover sources: image.tmdb.org posters, covers.openlibrary.org, Google Books covers (and archive.org, but only when
//     Open Library redirects to it; each redirect is checked, at most 4), over https, no logins or ports in the address;
//   · only a JPEG or PNG (checked by its first bytes), at most 4 MB (counted as it arrives);
//   · anything else is refused. Our own /covers/ files are static files and never go through here.
import type { APIRoute } from 'astro';
import { coverAllowed, safeImage } from '../../lib/cards/covers';
export const prerender = false;

export const GET: APIRoute = async ({ url }) => {
  const no = (status: number) => new Response('No', { status, headers: { 'Cache-Control': 'no-store' } });
  let u: URL;
  try { u = new URL(url.searchParams.get('u') ?? ''); } catch { return no(400); }
  if (u.protocol !== 'https:' || u.username || u.password || u.port || !coverAllowed(u)) return no(400);
  const img = await safeImage(u, u.hostname === 'covers.openlibrary.org' ? 4000 : 2300);
  if (!img) return no(502);
  return new Response(img.body, { headers: { 'Content-Type': img.type, 'Cache-Control': 'public, max-age=86400, s-maxage=2592000, stale-while-revalidate=86400', 'X-Content-Type-Options': 'nosniff' } });
};
