// Settings: profile, favourites, links, photo and privacy switches.
import type { APIRoute } from 'astro';
import { json, oops, body, str, needMe, sameOrigin } from '../../lib/http';
import { dbMessage } from '../../lib/supabase';
import { usernameStatus } from '../../lib/usernames';
import { LINKS } from '../../lib/kinds';
export const prerender = false;

export const POST: APIRoute = async (ctx) => {
  if (!sameOrigin(ctx)) return oops('Please try again from the site.', 403);
  const { me, res } = needMe(ctx);
  if (res) return res;
  const b = await body<Record<string, unknown>>(ctx.request);
  if (!b) return oops('Nothing to save.');
  const sb = ctx.locals.supabase;

  if (b.section === 'profile') {
    const change: Record<string, unknown> = { display_name: str(b.display_name, 60) ?? me.display_name };
    const username = typeof b.username === 'string' ? b.username.trim().toLowerCase().replace(/^@/, '') : me.username;
    if (username && username !== me.username) {
      const check = await usernameStatus(username, me.id);
      if (!check.ok) return oops(check.message);
      change.username = username;
    }
    const { error } = await sb.from('profiles').update(change).eq('id', me.id);
    if (error) return oops(dbMessage(error));
    const { error: e2 } = await sb.from('profile_details').upsert({ id: me.id, bio: str(b.bio, 160) ?? '' });
    if (e2) return oops(dbMessage(e2));
    return json({ ok: true, reload: !!change.username });
  }

  // up to four favourites, in order, each something on your own shelf
  if (b.section === 'favourites') {
    const UUID = /^[0-9a-f-]{36}$/i;
    const asked = Array.isArray(b.ids) ? [...new Set(b.ids.filter((x): x is string => typeof x === 'string' && UUID.test(x)))].slice(0, 4) : [];
    let favourites: string[] = [];
    if (asked.length) {
      // a TV show counts as on your shelf when any of its seasons is
      const { data, error } = await sb.from('logs').select('title_id, title:titles(show_id)').eq('user_id', me.id);
      if (error) return oops(dbMessage(error));
      const onShelf = new Set((data ?? []).flatMap((r: any) => [r.title_id, r.title?.show_id].filter(Boolean)));
      favourites = asked.filter((id) => onShelf.has(id));
    }
    const { error } = await sb.from('profile_details').upsert({ id: me.id, favourites });
    if (error) return oops(dbMessage(error));
    return json({ ok: true, favourites });
  }

  if (b.section === 'links') {
    const links: Record<string, string> = {};
    for (const l of LINKS) {
      const v = str(b[`link_${l.key}`], 200);
      if (!v) continue;
      if (/[\s<>"']/.test(v) || /^(javascript|data):/i.test(v)) return oops(`That ${l.label} link doesn’t look right.`);
      links[l.key] = v;
    }
    const { error } = await sb.from('profile_details').upsert({ id: me.id, links });
    if (error) return oops(dbMessage(error));
    return json({ ok: true });
  }

  if (b.section === 'photo') {
    const g = ctx.locals.user?.avatar;
    const url = b.photo === 'google' && g && /^https:\/\//.test(g) ? g.slice(0, 600) : null;
    const { error } = await sb.from('profiles').update({ avatar_url: url }).eq('id', me.id);
    if (error) return oops(dbMessage(error));
    return json({ ok: true });
  }

  if (b.section === 'flag' && (b.flag === 'is_private' || b.flag === 'featured')) {
    const on = b.on === true;
    const change: Record<string, boolean> = { [b.flag]: on };
    if (b.flag === 'is_private' && on) change.featured = false; // a private shelf can't be featured
    if (b.flag === 'featured' && on && me.is_private) return oops('A private shelf can’t be featured.');
    const { error } = await sb.from('profiles').update(change).eq('id', me.id);
    if (error) return oops(dbMessage(error));
    return json({ ok: true });
  }
  return oops('Nothing to save.');
};
