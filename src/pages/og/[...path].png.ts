// Link previews (og:image): /og/film/<id>.png, /og/tv/<id>.png, /og/book/<id>.png, /og/u/<username>.png,
// /og/e/<username>/<slug>.png and /og/c/<username>/<collection>.png. The <id> is the same text as in the page's address.
// Drawn as the visitor, and link robots are signed out: only public things become previews (everything else is a 404,
// and the page falls back to the plain site picture).
import type { APIRoute } from 'astro';
import { loadProfile, loadDetails, loadVisits, loadCollections } from '../../lib/data';
import { statusLabel } from '../../lib/kinds';
import { creditFor } from '../../lib/cards/credits';
import { pageBits } from '../../lib/cards/titlepage';
import { backgroundOf, isBackground } from '../../lib/cards/backgrounds';
import { drawPreview, type PreviewData } from '../../lib/cards/preview';
import { savedFacts } from '../../lib/cards/tagline';
import { picture, within } from '../../lib/cards/output';
export const prerender = false;

const KIND = { film: 'Film', tv: 'TV show', book: 'Book' } as const;
const gone = () => new Response('Not found', { status: 404, headers: { 'Cache-Control': 'no-store' } });
const meta = (year: number | undefined, by: string, who?: string) => [year, who ? `${by} ${who}` : ''].filter(Boolean).join(' | ');

export const GET: APIRoute = async ({ params, locals, url }) => {
  const sb = locals.supabase;
  const [type, a, b] = String(params.path ?? '').split('/');
  let card: PreviewData | null = null;
  let shared = true;      // catalogue pages are the same for everyone, so a shared cache may keep them

  try {
    if (type === 'film' || type === 'tv' || type === 'book') {
      const p = await pageBits(sb, type, a ?? '');
      if (p) card = {
        kicker: KIND[type], title: p.title, accent: type === 'book' ? 'book' : 'film', line: p.line, bg: p.bg,
        meta: meta(p.year, type === 'film' ? 'directed by' : type === 'tv' ? 'created by' : 'by', p.creator),
        covers: [{ src: p.cover, title: p.title, color: p.color }],
      };
    } else if (sb && (type === 'u' || type === 'e' || type === 'c')) {
      shared = false;
      const found = await loadProfile(sb, String(a ?? '').toLowerCase(), locals.me);
      if (!found || 'redirect' in found) return gone();
      const { profile } = found;
      if (profile.is_private && locals.me?.id !== profile.id) return gone();
      const name = profile.display_name || profile.username;
      if (type === 'u') {
        const details = found.details ?? await loadDetails(sb, profile.id);
        const { data } = await sb.from('logs').select('title:titles(title, cover_url, color)').eq('user_id', profile.id).eq('only_me', false)
          .order('logged_on', { ascending: false }).limit(3);
        card = {
          kicker: 'Shelf', bg: 'reading', title: name, meta: `@${profile.username}`, line: details?.bio || undefined,
          covers: (data ?? []).map((r: any) => ({ src: r.title?.cover_url ?? undefined, title: r.title?.title ?? '', color: r.title?.color ?? undefined })),
        };
      } else if (type === 'e') {
        const [e] = await loadVisits(sb, profile, String(b ?? ''));
        if (!e || e.data.private) return gone();
        const d = e.data;
        card = {
          kicker: `@${profile.username} | ${statusLabel(d.type, d.status)}`, title: d.title, rating: d.rating, bg: (await savedFacts(sb, e.titleId)).bg ?? await within(backgroundOf(e), 2500, d.type === 'book' ? 'reading' as const : 'cinema' as const),
          accent: d.type === 'book' ? 'book' : d.type === 'essay' ? 'plain' : 'film',
          meta: meta(d.year, d.type === 'film' ? 'directed by' : d.type === 'tv' ? 'created by' : 'by', await within(creditFor(e), 2000, d.creator)),
          covers: [{ src: d.cover, title: d.title, color: d.color }],
        };
      } else {
        const col = (await loadCollections(sb, profile)).find((c) => c.id === b);
        if (!col) return gone();
        card = {
          kicker: 'Collection', bg: 'reading', title: col.data.title, meta: `by ${name} | ${col.data.items.length} titles`, line: col.body || undefined,
          covers: col.data.items.slice(0, 3).map((i) => ({ src: i.title.cover_url ?? undefined, title: i.title.title, color: i.title.color ?? undefined })),
        };
      }
    }
  } catch { return gone(); }
  if (!card) return gone();
  const asked = url.searchParams.get('bg');
  if (isBackground(asked)) card.bg = asked;

  const pic = await drawPreview(card);
  // catalogue cards are the same for everyone: Vercel's CDN may keep them a long time (a day while the title has no line yet,
  // which the AI may still add). Cards about someone's shelf stay short.
  const cache = shared
    ? (card.line ? 'public, max-age=3600, s-maxage=2592000, stale-while-revalidate=86400' : 'public, max-age=600, s-maxage=86400')
    : 'public, max-age=300';
  return picture(pic, cache);
};
