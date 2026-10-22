// An RSS feed of one shelf (public shelves only).
import rss from '@astrojs/rss';
import type { APIRoute } from 'astro';
import { loadProfile, loadShelf, href, excerpt, fullTitle } from '../../lib/data';
import { site } from '../../data/site';
export const prerender = false;

const VERB = { book: 'Read', film: 'Watched', tv: 'Watched', essay: 'Read' } as const;

export const GET: APIRoute = async ({ params, locals, site: url }) => {
  if (!locals.supabase) return new Response('Not found', { status: 404 });
  const found = await loadProfile(locals.supabase, String(params.username ?? '').toLowerCase());
  if (!found || 'redirect' in found || found.profile.is_private) return new Response('Not found', { status: 404 });
  const p = found.profile;
  const all = (await loadShelf(locals.supabase, p, { byShow: false })).filter((e) => !e.data.private && e.data.status !== 'want');
  const res = await rss({
    title: `${p.display_name || p.username} on ${site.name}`,
    description: found.details?.bio || `What @${p.username} is reading and watching.`,
    site: url!,
    items: all.slice(0, 50).map((e) => ({
      title: `${e.data.status === 'done' ? VERB[e.data.type] : 'Started'}: ${fullTitle(e)}`,
      pubDate: e.data.date,
      description: `${e.data.creator}. ${excerpt(e, 400)}`,
      link: href(e),
    })),
  });
  res.headers.set('Cache-Control', 'public, max-age=600');
  return res;
};
