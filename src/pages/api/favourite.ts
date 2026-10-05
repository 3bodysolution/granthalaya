// Pin or unpin a title as one of your four favourites.
import type { APIRoute } from 'astro';
import { json, oops, body, needMe, sameOrigin } from '../../lib/http';
import { dbMessage } from '../../lib/supabase';
export const prerender = false;

export const POST: APIRoute = async (ctx) => {
  if (!sameOrigin(ctx)) return oops('Please try again from the site.', 403);
  const { me, res } = needMe(ctx);
  if (res) return res;
  const b = await body<{ title?: string; on?: boolean }>(ctx.request);
  if (!b?.title || !/^[0-9a-f-]{36}$/i.test(b.title)) return oops('Which title?');
  const sb = ctx.locals.supabase;
  const { data: d } = await sb.from('profile_details').select('favourites').eq('id', me.id).maybeSingle();
  let favs: string[] = (d?.favourites ?? []).filter((x: string) => x !== b.title);
  if (b.on) {
    if (favs.length >= 4) return oops('You can pin four favourites. Unpin one first.');
    favs = [...favs, b.title];
  }
  const { error } = await sb.from('profile_details').upsert({ id: me.id, favourites: favs });
  if (error) return oops(dbMessage(error));
  return json({ ok: true, favourites: favs });
};
