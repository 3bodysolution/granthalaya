// Make sure a title is in the shared catalogue (adding it if needed) and say its id, so the Add page can
// open it for a review. Signed-in people only.
import type { APIRoute } from 'astro';
import { json, oops, body, needMe, sameOrigin } from '../../lib/http';
import { cleanHit, titleFor } from '../../lib/titles';
import { warmCover } from '../../lib/cards/covers';
export const prerender = false;

export const POST: APIRoute = async (ctx) => {
  if (!sameOrigin(ctx)) return oops('Please try again from the site.', 403);
  const { me, res } = needMe(ctx);
  if (res) return res;
  const b = await body<Record<string, any>>(ctx.request);
  if (typeof b?.title === 'string' && /^[0-9a-f-]{36}$/i.test(b.title)) return json({ ok: true, id: b.title });
  const hit = cleanHit(b?.hit);
  if (!hit) return oops('A title is needed.');
  const t = await titleFor(hit, me.id);
  if ('error' in t) return oops(t.error);
  warmCover(ctx.url.origin, hit.cover);   // ready in the CDN before the first share card needs it
  return json({ ok: true, id: t.id, slug: t.slug });
};
