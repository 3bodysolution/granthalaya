// A copy of a cover, for the share cards: /api/cover?u=<cover address>. Only our cover sources. The answer is public and kept by
// Vercel's CDN for a week, so the next card that needs the same poster gets it at once.
import type { APIRoute } from 'astro';
import { coverAllowed } from '../../lib/cards/covers';
export const prerender = false;

export const GET: APIRoute = async ({ url }) => {
  const bad = (status: number) => new Response('No', { status, headers: { 'Cache-Control': 'no-store' } });
  let u: URL;
  try { u = new URL(url.searchParams.get('u') ?? ''); } catch { return bad(400); }
  if (u.protocol !== 'https:' || !coverAllowed(u)) return bad(400);
  try {
    const r = await fetch(u, { signal: AbortSignal.timeout(u.hostname === 'covers.openlibrary.org' ? 4000 : 2300), redirect: 'follow', headers: { 'User-Agent': 'Granthalaya/1.0 (cover copy)' } });
    const type = r.headers.get('content-type') ?? '';
    if (!r.ok || !/^image\/(jpeg|png)/.test(type)) return bad(502);
    const body = await r.arrayBuffer();
    if (body.byteLength > 4_000_000) return bad(502);
    return new Response(body, { headers: { 'Content-Type': type, 'Cache-Control': 'public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400' } });
  } catch { return bad(504); }
};
