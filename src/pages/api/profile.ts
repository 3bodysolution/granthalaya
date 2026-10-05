// Settings: profile, links, photo and privacy switches.
import type { APIRoute } from 'astro';
import { json, oops, body, str, int, needMe, sameOrigin } from '../../lib/http';
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
    const goal = int(b.goal_books, 0, 1000);
    const { error: e2 } = await sb.from('profile_details').upsert({
      id: me.id, bio: str(b.bio, 160) ?? '', season_line: str(b.season_line, 40) ?? '',
      lotw_text: str(b.lotw_text, 400) ?? '', lotw_by: str(b.lotw_by, 80) ?? '', lotw_source: str(b.lotw_source, 120) ?? '',
      goal_books: goal ? goal : null,
    });
    if (e2) return oops(dbMessage(e2));
    return json({ ok: true, reload: !!change.username });
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
