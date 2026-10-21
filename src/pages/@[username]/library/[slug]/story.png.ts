// The story card for one title on someone's shelf, as a picture: /@username/library/<slug>/story.png
// Drawn as the visitor, so the database's privacy rules apply: "Only me" entries, private accounts and blocks give a 404.
// The address carries ?v=<when the entry last changed>, so a changed rating or status is a new card.
// The line under the title is the title's own short line. ?bg=<painting> picks the background (else by genre).
import type { APIRoute } from 'astro';
import { loadProfile, loadVisits } from '../../../../lib/data';
import { statusLabel } from '../../../../lib/kinds';
import { drawStory } from '../../../../lib/cards/story';
import { creditFor } from '../../../../lib/cards/credits';
import { titleLine } from '../../../../lib/cards/tagline';
import { backgroundOf, isBackground } from '../../../../lib/cards/backgrounds';
export const prerender = false;

const rendered = new Map<string, Buffer>();   // finished cards, checked against the database before every use

export const GET: APIRoute = async ({ params, url, locals }) => {
  const gone = () => new Response('Not found', { status: 404, headers: { 'Cache-Control': 'no-store' } });
  const sb = locals.supabase;
  if (!sb) return gone();
  const username = String(params.username ?? '').toLowerCase();
  const slug = String(params.slug ?? '');
  const found = await loadProfile(sb, username, locals.me);
  if (!found) return gone();
  if ('redirect' in found) return new Response(null, { status: 301, headers: { Location: `/@${found.redirect}/library/${slug}/story.png${url.search}`, 'Cache-Control': 'no-store' } });
  const { profile } = found;
  const isMe = locals.me?.id === profile.id;
  if (profile.is_private && !isMe) return gone();

  const [entry] = await loadVisits(sb, profile, slug);            // newest visit; only what this visitor may see comes back
  if (!entry || (entry.data.private && !isMe)) return gone();
  const { data: row } = await sb.from('logs').select('updated_at').eq('id', entry.logId).maybeSingle();
  if (!row) return gone();
  const v = String(Math.floor(Date.parse(row.updated_at) / 1000));
  if (url.searchParams.get('v') !== v) {
    const to = new URL(url); to.searchParams.set('v', v);
    return new Response(null, { status: 302, headers: { Location: to.pathname + to.search, 'Cache-Control': 'no-store' } });
  }

  const custom = isMe ? (url.searchParams.get('line') ?? '').replace(/\s+/g, ' ').trim().slice(0, 140) : '';
  const key = `${entry.logId}:${v}:${custom}`;
  let png = rendered.get(key);
  if (!png) {
    const d = entry.data;
    const [line, bg, credit] = await Promise.all([titleLine(sb, entry), isBackground(asked) ? asked : backgroundOf(entry), creditFor(entry)]);
    png = await drawStory({
      kind: d.type, title: d.title, year: d.year, creator: credit || undefined, season: d.season,
      rating: d.rating, loved: d.loved, status: statusLabel(d.type, d.status), line: line || undefined,
      owner: profile.username, cover: d.cover, color: d.color, bg,
    });
    if (rendered.size > 40) rendered.delete(rendered.keys().next().value!);
    rendered.set(key, png);
  }
  // the picture is for this visitor's browser only (a shared cache could not tell a blocked person from anyone else)
  return new Response(png, { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'private, max-age=31536000, immutable' } });
};
