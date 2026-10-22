// Acting on a report, or hiding a suggested book (admins only).
import type { APIRoute } from 'astro';
import { json, oops, body, sameOrigin } from '../../lib/http';
import { adminClient } from '../../lib/supabase';
export const prerender = false;

export const POST: APIRoute = async (ctx) => {
  if (!sameOrigin(ctx)) return oops('Please try again from the site.', 403);
  if (!ctx.locals.me?.is_admin) return oops('Not found.', 404);
  const b = await body<{ id?: string; action?: string }>(ctx.request);
  const db = adminClient();
  if (b?.action === 'hide_book' || b?.action === 'show_book') {
    if (!b.id || !/^[0-9a-f-]{36}$/i.test(b.id)) return oops('Which book?');
    const { error } = await db.from('book_suggestions').update({ hidden: b.action === 'hide_book' }).eq('id', b.id);
    return error ? oops('Couldn’t change that.', 500) : json({ ok: true });
  }
  if (!b?.id) return oops('Which report?');
  const { data: r } = await db.from('reports').select('id, target_user, target_log, target_comment').eq('id', b.id).maybeSingle();
  if (!r) return oops('Couldn’t find that report.', 404);
  if (b.action === 'dismiss') await db.from('reports').update({ status: 'dismissed' }).eq('id', r.id);
  else if (b.action === 'done') await db.from('reports').update({ status: 'actioned' }).eq('id', r.id);
  else if (b.action === 'hide_entry' && r.target_log) {
    await db.from('logs').update({ only_me: true }).eq('id', r.target_log);
    await db.from('reports').update({ status: 'actioned' }).eq('id', r.id);
  } else if (b.action === 'delete_comment' && r.target_comment) {
    // the report goes with the comment (on delete cascade)
    const { error } = await db.from('review_comments').delete().eq('id', r.target_comment);
    if (error) return oops('Couldn’t delete that comment.', 500);
  } else if (b.action === 'unfeature' && r.target_user) {
    await db.from('profiles').update({ featured: false }).eq('id', r.target_user);
    await db.from('reports').update({ status: 'actioned' }).eq('id', r.id);
  } else return oops('Unknown action.');
  return json({ ok: true });
};
