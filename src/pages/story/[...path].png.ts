// The tall story card for something that is not an entry on a shelf (the share window shows this on title pages and collections):
// /story/film/<address part>.png, /story/tv/..., /story/book/..., /story/c/<username>/<collection>.png (a JPEG, whatever the name).
// No rating and no status: it is the title itself. ?w=540 gives the half-size preview, ?bg=<painting> picks the painting.
// The wide card (/og/...) is only the link preview.
import type { APIRoute } from 'astro';
import { loadProfile, loadCollections } from '../../lib/data';
import { drawStory } from '../../lib/cards/story';
import { pageBits } from '../../lib/cards/titlepage';
import { isBackground } from '../../lib/cards/backgrounds';
import { picture, coverSlow } from '../../lib/cards/output';
import { CoverMissing, setOrigin } from '../../lib/cards/covers';
import { noteStart } from '../../lib/share';
import { mark } from '../../lib/timing';
export const prerender = false;

const gone = () => new Response('Not found', { status: 404, headers: { 'Cache-Control': 'no-store' } });

export const GET: APIRoute = async ({ params, locals, url }) => {
  setOrigin(url.origin);
  const sb = locals.supabase;
  const [type, a, b] = String(params.path ?? '').split('/');
  const asked = url.searchParams.get('bg');
  const width = url.searchParams.get('w') === '540' ? 540 : 1080;
  try {
    if (type === 'film' || type === 'tv' || type === 'book') {
      const p = await pageBits(sb, type, a ?? '');
      if (!p) return gone();
      const pic = await drawStory({
        kind: type, title: p.title, year: p.year, creator: p.creator || undefined, line: p.line, cover: p.cover, color: p.color,
        bg: isBackground(asked) ? asked : p.bg,
      }, width);
      // a catalogue card is the same for everyone: Vercel's CDN may keep it (a day while the title has no line yet)
      return picture(pic, p.line ? 'public, max-age=3600, s-maxage=2592000, stale-while-revalidate=86400' : 'public, max-age=600, s-maxage=86400');
    }
    if (type === 'c' && sb) {
      const found = await loadProfile(sb, String(a ?? '').toLowerCase(), locals.me);
      if (!found || 'redirect' in found) return gone();
      const { profile } = found;
      if (profile.is_private && locals.me?.id !== profile.id) return gone();
      const col = (await loadCollections(sb, profile)).find((c) => c.id === b);
      if (!col) return gone();
      const first = col.data.items[0]?.title;
      const name = profile.display_name || profile.username;
      const pic = await drawStory({
        kind: 'book', title: col.data.title, meta: `a collection by ${name} | ${col.data.items.length} ${col.data.items.length === 1 ? 'title' : 'titles'}`,
        line: col.body ? noteStart(col.body, 90) : undefined, cover: first?.cover_url ?? undefined, color: first?.color ?? undefined,
        bg: isBackground(asked) ? asked : 'reading', owner: profile.username,
      }, width);
      return picture(pic, 'public, max-age=300');
    }
  } catch (e) {
    if (e instanceof CoverMissing) return coverSlow();
    console.error('story card', params.path, e);
    mark('fail', 0, e instanceof Error ? e.message : 'error');   // shown in the [card] log line
    return gone();
  }
  return gone();
};
