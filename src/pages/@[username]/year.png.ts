// The "My year" card for one shelf, as a picture: /@username/year.png?year=2026
// Drawn as the visitor: private accounts and blocks give a 404, and "Only me" entries are left out (even for the owner,
// because the card is made to be shared). Counts finished things only, like the Stats page.
import type { APIRoute } from 'astro';
import { createHash } from 'node:crypto';
import { loadProfile, loadShelf, type Entry } from '../../lib/data';
import { drawYear } from '../../lib/cards/year';
import { backgroundOf, isBackground } from '../../lib/cards/backgrounds';
import { picture, coverSlow, type Picture } from '../../lib/cards/output';
import { CoverMissing, setOrigin } from '../../lib/cards/covers';
import { savedFacts } from '../../lib/cards/tagline';
import { within } from '../../lib/cards/output';
export const prerender = false;

const rendered = new Map<string, Picture>();

export const GET: APIRoute = async ({ params, url, locals }) => {
  const gone = () => new Response('Not found', { status: 404, headers: { 'Cache-Control': 'no-store' } });
  setOrigin(url.origin);
  const sb = locals.supabase;
  if (!sb) return gone();
  const username = String(params.username ?? '').toLowerCase();
  const found = await loadProfile(sb, username, locals.me);
  if (!found) return gone();
  if ('redirect' in found) return new Response(null, { status: 301, headers: { Location: `/@${found.redirect}/year.png${url.search}`, 'Cache-Control': 'no-store' } });
  const { profile } = found;
  if (profile.is_private && locals.me?.id !== profile.id) return gone();

  const done = (await loadShelf(sb, profile, { byShow: false })).filter((e) => e.data.status === 'done' && !e.data.private);
  const yearOf = (e: Entry) => e.data.date.getUTCFullYear();
  const years = [...new Set(done.map(yearOf))].sort((a, b) => b - a);
  const asked = Number(url.searchParams.get('year'));
  const year = years.includes(asked) ? asked : years[0];
  if (year === undefined) return gone();
  const list = done.filter((e) => yearOf(e) === year);

  // best first: rated high, then loved, then newest
  const better = (a: Entry, b: Entry) => (b.data.rating ?? 0) - (a.data.rating ?? 0) || Number(b.data.loved) - Number(a.data.loved) || b.data.date.getTime() - a.data.date.getTime();
  const withArt = list.filter((e) => e.data.type !== 'essay');
  const months = Array.from({ length: 12 }, (_, m) => {
    const inMonth = withArt.filter((e) => e.data.date.getUTCMonth() === m).sort(better);
    return inMonth[0] ?? null;
  });
  const fav = [...withArt].filter((e) => e.data.rating != null).sort(better)[0];
  const favourite = fav ? months.findIndex((e) => e?.logId === fav.logId) : -1;
  const width = url.searchParams.get('w') === '540' ? 540 : 1080;
  const bgAsked = url.searchParams.get('bg');
  const key = createHash('sha1').update(`${profile.id}:${year}:${bgAsked ?? ''}:${width}:${list.map((e) => `${e.logId}/${e.data.rating}`).sort().join(',')}`).digest('hex');
  let pic = rendered.get(key);
  if (!pic) {
    const kind = (t: string) => list.filter((e) => (t === 'film' ? e.data.type === 'film' || e.data.type === 'tv' : e.data.type === t)).length;
    try {
    pic = await drawYear({
      bg: isBackground(bgAsked) ? bgAsked : fav ? ((await savedFacts(sb, fav.titleId)).bg ?? await within(backgroundOf(fav), 2500, 'cinema' as const)) : 'cinema',
      year, owner: profile.username,
      books: kind('book'), films: kind('film'), essays: kind('essay'),
      months: months.map((e) => e && { title: e.data.title, cover: e.data.cover, color: e.data.color }),
      favourite: favourite >= 0 ? favourite : undefined,
      fav: fav && { title: fav.data.title, cover: fav.data.cover, color: fav.data.color },
    }, width);
    } catch (e) {
      if (e instanceof CoverMissing) return coverSlow();
      throw e;
    }
    if (rendered.size > 20) rendered.delete(rendered.keys().next().value!);
    rendered.set(key, pic);
  }
  return picture(pic, 'private, max-age=300');
};
