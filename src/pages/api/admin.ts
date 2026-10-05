// Acting on a report (admins only).
import type { APIRoute } from 'astro';
import { json, oops, body, sameOrigin } from '../../lib/http';
import { adminClient } from '../../lib/supabase';
export const prerender = false;

export const POST: APIRoute = async (ctx) => {
  if (!sameOrigin(ctx)) return oops('Please try again from the site.', 403);
  if (!ctx.locals.me?.is_admin) return oops('Not found.', 404);
  const b = await body<{ id?: string; action?: string }>(ctx.request);
  if (!b?.id) return oops('Which report?');
  const db = adminClient();
  const { data: r } = await db.from('reports').select('id, target_user, target_log').eq('id', b.id).maybeSingle();
  if (!r) return oops('Couldn’t find that report.', 404);
  if (b.action === 'dismiss') await db.from('reports').update({ status: 'dismissed' }).eq('id', r.id);
  else if (b.action === 'done') await db.from('reports').update({ status: 'actioned' }).eq('id', r.id);
  else if (b.action === 'hide_entry' && r.target_log) {
    await db.from('logs').update({ only_me: true }).eq('id', r.target_log);
    await db.from('reports').update({ status: 'actioned' }).eq('id', r.id);
  } else if (b.action === 'unfeature' && r.target_user) {
    await db.from('profiles').update({ featured: false }).eq('id', r.target_user);
    await db.from('reports').update({ status: 'actioned' }).eq('id', r.id);
  } else return oops('Unknown action.');
  return json({ ok: true });
};
