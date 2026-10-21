// Link previews (og:image): /og/film/<id>.png, /og/tv/<id>.png, /og/book/<id>.png, /og/u/<username>.png,
// /og/e/<username>/<slug>.png and /og/c/<username>/<collection>.png. The <id> is the same text as in the page's address.
// Drawn as the visitor, and link robots are signed out: only public things become previews (everything else is a 404,
// and the page falls back to the plain site picture).
import type { APIRoute } from 'astro';
import { film, show, idFrom } from '../../lib/catalog/tmdb';
import { olBook, gbBook, bookKey } from '../../lib/catalog/books';
import { rowBySlug } from '../../lib/catalog/onsite';
import { loadProfile, loadDetails, loadVisits, loadCollections } from '../../lib/data';
import { statusLabel } from '../../lib/kinds';
import { drawPreview, type PreviewData } from '../../lib/cards/preview';
export const prerender = false;

const KIND = { film: 'Film', tv: 'TV show', book: 'Book' } as const;
const gone = () => new Response('Not found', { status: 404, headers: { 'Cache-Control': 'no-store' } });
const meta = (year: number | undefined, by: string, who?: string) => [year, who ? `${by} ${who}` : ''].filter(Boolean).join(' | ');

export const GET: APIRoute = async ({ params, locals }) => {
  const sb = locals.supabase;
  const [type, a, b] = String(params.path ?? '').split('/');
  let card: PreviewData | null = null;
  let shared = true;      // catalogue pages are the same for everyone, so a shared cache may keep them

  try {
    if (type === 'film' || type === 'tv') {
      const id = idFrom(a);
      const p = id ? await (type === 'film' ? film(id) : show(id)) : null;
      if (p) card = {
        kicker: KIND[type], title: p.title, accent: 'film', line: p.tagline,
        meta: meta(p.year, type === 'film' ? 'directed by' : 'created by', (p.kind === 'film' ? p.directors : p.creators)[0]?.name),
        covers: [{ src: p.poster, title: p.title }],
      };
    } else if (type === 'book') {
      const k = bookKey(a);
      let bk = null;
      if (k && 'ol' in k) bk = await olBook(k.ol);
      else if (k && 'gb' in k) bk = await gbBook(k.gb);
      else if (k && sb) {
        const row = await rowBySlug(sb, 'book', k.slug);
        if (row) card = { kicker: KIND.book, title: row.title, accent: 'book', meta: meta(row.year ?? undefined, 'by', row.creator), covers: [{ src: row.cover_url ?? undefined, title: row.title }] };
      }
      if (bk) card = { kicker: KIND.book, title: bk.title, accent: 'book', meta: meta(bk.year, 'by', bk.authors[0]?.name), covers: [{ src: bk.cover, title: bk.title }] };
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
          kicker: 'Shelf', title: name, meta: `@${profile.username}`, line: details?.bio || undefined,
          covers: (data ?? []).map((r: any) => ({ src: r.title?.cover_url ?? undefined, title: r.title?.title ?? '', color: r.title?.color ?? undefined })),
        };
      } else if (type === 'e') {
        const [e] = await loadVisits(sb, profile, String(b ?? ''));
        if (!e || e.data.private) return gone();
        const d = e.data;
        card = {
          kicker: `@${profile.username} | ${statusLabel(d.type, d.status)}`, title: d.title, rating: d.rating,
          accent: d.type === 'book' ? 'book' : d.type === 'essay' ? 'plain' : 'film',
          meta: meta(d.year, d.type === 'film' ? 'directed by' : d.type === 'tv' ? 'created by' : 'by', d.creator),
          covers: [{ src: d.cover, title: d.title, color: d.color }],
        };
      } else {
        const col = (await loadCollections(sb, profile)).find((c) => c.id === b);
        if (!col) return gone();
        card = {
          kicker: 'Collection', title: col.data.title, meta: `by ${name} | ${col.data.items.length} titles`, line: col.body || undefined,
          covers: col.data.items.slice(0, 3).map((i) => ({ src: i.title.cover_url ?? undefined, title: i.title.title, color: i.title.color ?? undefined })),
        };
      }
    }
  } catch { return gone(); }
  if (!card) return gone();

  const png = await drawPreview(card);
  return new Response(png, { headers: { 'Content-Type': 'image/png', 'Cache-Control': shared ? 'public, max-age=3600, s-maxage=86400' : 'public, max-age=300' } });
};
