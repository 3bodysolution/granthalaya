// A copy of a cover, for the share cards: /api/cover?u=<cover address>. Public, and kept by Vercel's CDN for 30 days (a shop's covers for 1 day), so the next
// card that needs the same poster gets it at once. It is a small fetch-for-anyone door, so it is strict:
//     It also serves the two bookshops' covers to visitors (pages never load them from the shops), with the shops' permission.
//   · only our cover sources: image.tmdb.org posters, covers.openlibrary.org, Google Books covers, Akshardhara's folder on
//     cdn.shopify.com and BookGanga's covers folder (and archive.org, but only when
//     Open Library redirects to it; each redirect is checked, at most 4), over https, no logins or ports in the address;
//   · only a JPEG or PNG (checked by its first bytes), at most 4 MB (counted as it arrives);
//   · anything else is refused. Our own /covers/ files are static files and never go through here.
import type { APIRoute } from 'astro';
import { coverAllowed, safeImage } from '../../lib/cards/covers';
import { trimFrame } from '../../lib/cards/trim';
export const prerender = false;

export const GET: APIRoute = async ({ url }) => {
  const no = (status: number) => new Response('No', { status, headers: { 'Cache-Control': 'no-store' } });
  let u: URL;
  try { u = new URL(url.searchParams.get('u') ?? ''); } catch { return no(400); }
  if (u.protocol !== 'https:' || u.username || u.password || u.port || !coverAllowed(u)) return no(400);
  const img = await safeImage(u, u.hostname === 'covers.openlibrary.org' || u.hostname === 'www.bookganga.com' ? 4000 : 2300);
  if (!img) return no(502);
  // Akshardhara's covers often come inside a plain white frame (with the shop's address under the picture): take the frame off, never cutting into the picture
  let { body, type } = img;
  if (u.hostname === 'cdn.shopify.com') { const t = await trimFrame(body).catch(() => null); if (t) ({ body, type } = t); }
  // a shop's cover is kept for a day only (not 30), with no stale copy afterwards, so one the shop asks us to hide is gone within a day
  const shop = u.hostname === 'cdn.shopify.com' || u.hostname === 'www.bookganga.com';
  const cache = shop ? 'public, max-age=86400, s-maxage=86400' : 'public, max-age=86400, s-maxage=2592000, stale-while-revalidate=86400';
  return new Response(body, { headers: { 'Content-Type': type, 'Cache-Control': cache, 'X-Content-Type-Options': 'nosniff' } });
};
