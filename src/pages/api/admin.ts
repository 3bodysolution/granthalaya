// Acting on a report, hiding a bookshop's book or cover (admins only).
import type { APIRoute } from 'astro';
import { json, oops, body, sameOrigin } from '../../lib/http';
import { removeAllUploaded } from '../../lib/avatar';
import { adminClient } from '../../lib/supabase';
export const prerender = false;

export const POST: APIRoute = async (ctx) => {
  if (!sameOrigin(ctx)) return oops('Please try again from the site.', 403);
  if (!ctx.locals.me?.is_admin) return oops('Not found.', 404);
  const b = await body<{ id?: string; action?: string }>(ctx.request);
  const db = adminClient();
  if (b?.action === 'remove_title') {
    // take a title out of the shared catalogue, only when nobody has it logged or in a collection (a TV show counts its seasons too)
    if (!b.id || !/^[0-9a-f-]{36}$/i.test(b.id)) return oops('Which title?');
    const { data: t } = await db.from('titles').select('id, title, kind').eq('id', b.id).maybeSingle();
    if (!t) return oops('Couldn’t find that title.', 404);
    const { data: seasons } = await db.from('titles').select('id').eq('show_id', t.id);
    const ids = [t.id, ...(seasons ?? []).map((s: { id: string }) => s.id)];
    const { data: logs } = await db.from('logs').select('user_id').in('title_id', ids);
    const { count: inCollections } = await db.from('thread_items').select('title_id', { count: 'exact', head: true }).in('title_id', ids);
    const { count: shopRows } = await db.from('shop_books').select('id', { count: 'exact', head: true }).in('title_id', ids);
    if (shopRows) return oops('Not removed: it belongs to a bookshop book. Hide that book instead (above).', 409);
    if ((logs ?? []).length || inCollections) {
      const people = new Set((logs ?? []).map((l: { user_id: string }) => l.user_id)).size;
      const parts = [
        (logs ?? []).length ? `${(logs ?? []).length} log${(logs ?? []).length === 1 ? '' : 's'} by ${people} member${people === 1 ? '' : 's'}` : '',
        inCollections ? `${inCollections} collection item${inCollections === 1 ? '' : 's'}` : '',
      ].filter(Boolean).join(' and ');
      return oops(`Not removed: ${parts} use it.`, 409);
    }
    // favourites are a list of title ids on a profile: take it out of any
    const { data: favs } = await db.from('profile_details').select('id, favourites').overlaps('favourites', ids);
    for (const f of (favs ?? []) as { id: string; favourites: string[] }[]) {
      await db.from('profile_details').update({ favourites: f.favourites.filter((x) => !ids.includes(x)) }).eq('id', f.id);
    }
    const { error } = await db.from('titles').delete().in('id', ids);
    if (error) return oops('Couldn’t remove it. Something still refers to it.', 500);
    return json({ ok: true });
  }
  if (b?.action === 'hide_shop' || b?.action === 'show_shop' || b?.action === 'hide_cover') {
    // a shop asked: no Buy link and no cover (hidden rows stay, so scripts/shops never brings them back)
    if (!b.id || !/^[0-9a-f-]{36}$/i.test(b.id)) return oops('Which book?');
    const { data: row } = await db.from('shop_books').select('id, shop, title_id').eq('id', b.id).maybeSingle();
    if (!row) return oops('Couldn’t find that book.', 404);
    const change = b.action === 'show_shop' ? { hidden: false, cover_hidden: false } : b.action === 'hide_cover' ? { cover_hidden: true } : { hidden: true, cover_hidden: true };
    const { error } = await db.from('shop_books').update(change).eq('id', row.id);
    if (error) return oops('Couldn’t change that.', 500);
    // the cover goes from our record too, if it came from this shop (a cover from Open Library or elsewhere stays)
    if (change.cover_hidden && row.title_id) await db.from('titles').update({ cover_url: null, cover_from: null }).eq('id', row.title_id).eq('cover_from', row.shop);
    return json({ ok: true });
  }
  if (!b?.id) return oops('Which report?');
  const { data: r } = await db.from('reports').select('id, target_user, target_log, target_comment').eq('id', b.id).maybeSingle();
  if (!r) return oops('Couldn’t find that report.', 404);
  if (b.action === 'dismiss') await db.from('reports').update({ status: 'dismissed' }).eq('id', r.id);
  else if (b.action === 'done') await db.from('reports').update({ status: 'actioned' }).eq('id', r.id);
  else if (b.action === 'hide_entry' && r.target_log) {
    await db.from('logs').update({ admin_hidden: true }).eq('id', r.target_log);
    await db.from('reports').update({ status: 'actioned' }).eq('id', r.id);
  } else if (b.action === 'delete_comment' && r.target_comment) {
    // the report goes with the comment (on delete cascade)
    const { error } = await db.from('review_comments').delete().eq('id', r.target_comment);
    if (error) return oops('Couldn’t delete that comment.', 500);
  } else if (b.action === 'remove_photo' && r.target_user) {
    // their photo goes (the file too); they can choose another
    await db.from('profiles').update({ avatar_url: null }).eq('id', r.target_user);
    await removeAllUploaded(db, r.target_user);
  } else if (b.action === 'unfeature' && r.target_user) {
    await db.from('profiles').update({ featured: false }).eq('id', r.target_user);
    await db.from('reports').update({ status: 'actioned' }).eq('id', r.id);
  } else return oops('Unknown action.');
  return json({ ok: true });
};
