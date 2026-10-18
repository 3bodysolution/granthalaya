// Every /@username page starts here: whose shelf is it, and may this visitor see it?
import type { AstroGlobal } from 'astro';
import { loadProfile, type Profile, type Details } from './data';

export type Shelf = { profile: Profile; details: Details | null; isMe: boolean; visible: boolean; blockedByMe: boolean };
export type Opened = { shelf: Shelf; out?: undefined } | { shelf?: undefined; out: Response };

/** `rest` is the part of the address after /@username, used when an old username redirects */
export async function openShelf(Astro: AstroGlobal, rest = '/'): Promise<Opened> {
  const raw = String(Astro.params.username ?? '');
  const username = raw.toLowerCase();
  const sb = Astro.locals.supabase;
  if (!sb) return { out: await Astro.rewrite('/404') };
  if (raw !== username) return { out: Astro.redirect(`/@${username}${rest}${Astro.url.search}`, 301) };
  const found = await loadProfile(sb, username, Astro.locals.me); // your own profile is already loaded by the middleware
  if (!found) { Astro.response.status = 404; return { out: await Astro.rewrite('/404') }; }
  if ('redirect' in found) return { out: Astro.redirect(`/@${found.redirect}${rest}${Astro.url.search}`, 301) };
  const me = Astro.locals.me;
  const isMe = me?.id === found.profile.id;
  let blockedByMe = false;
  if (me && !isMe) {
    const { data } = await sb.from('blocks').select('blocked').eq('blocker', me.id).eq('blocked', found.profile.id).maybeSingle();
    blockedByMe = !!data;
  }
  return { shelf: { ...found, isMe, visible: isMe || !found.profile.is_private, blockedByMe } };
}
