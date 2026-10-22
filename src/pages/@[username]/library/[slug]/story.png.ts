// The story card for one title on someone's shelf, as a picture: /@username/library/<slug>/story.png (a JPEG, whatever the name).
// Drawn as the visitor, so the database's privacy rules apply: "Only me" entries, private accounts and blocks give a 404.
// The address may carry ?v=<when the entry last changed>: with it the browser keeps the card for good (a changed rating or status
// is a new address); without it the current card is sent and kept for a minute only.
// ?w=540 gives the half-size preview; ?bg=<painting> is for tests (otherwise the title's saved pick, else by genre).
// The line on it: the entry's review tagline (unless the review has spoilers), else the title's saved line.
// It never waits for the AI: with no saved line it draws without one, and the AI step runs in the background for next time.
import type { APIRoute } from 'astro';
import { loadProfile, loadVisits } from '../../../../lib/data';
import { statusLabel } from '../../../../lib/kinds';
import { drawStory } from '../../../../lib/cards/story';
import { creditFor } from '../../../../lib/cards/credits';
import { cardFacts } from '../../../../lib/cards/tagline';
import { backgroundOf, isBackground } from '../../../../lib/cards/backgrounds';
import { picture, within, coverSlow, type Picture } from '../../../../lib/cards/output';
import { CoverMissing, setOrigin } from '../../../../lib/cards/covers';
import { timed, mark } from '../../../../lib/timing';
export const prerender = false;

const rendered = new Map<string, Picture>();   // finished cards, checked against the database before every use

export const GET: APIRoute = async ({ params, url, locals }) => {
  const gone = () => new Response('Not found', { status: 404, headers: { 'Cache-Control': 'no-store' } });
  setOrigin(url.origin);
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
  // only a card asked for with the entry's current ?v= may be kept by the browser for good; without it (the share window) or with an
  // old one, the current card is sent straight away (no redirect, which costs a whole extra round trip on a phone) and not kept
  const current = url.searchParams.get('v') === v;

  const asked = url.searchParams.get('bg');
  const width = url.searchParams.get('w') === '540' ? 540 : 1080;
  const key = `${entry.logId}:${v}:${asked ?? ''}:${width}`;
  const cached = rendered.get(key);
  // the picture is for this visitor's browser only (a shared cache could not tell a blocked person from anyone else)
  const keep = current ? 'private, max-age=31536000, immutable' : 'private, max-age=60';
  if (cached) return picture(cached, keep);

  const d = entry.data;
  const facts = await timed('line', 'saved line and painting', cardFacts(sb, entry));
  const line = (!d.spoiler && d.tagline) || facts.line;
  // with no saved painting yet: by genre, but only for a moment (the catalogue may be slow)
  const [bg, credit] = await Promise.all([
    isBackground(asked) ? asked : facts.bg ?? within(timed('genre', 'painting by genre', backgroundOf(entry)), 2500, d.type === 'book' ? 'reading' as const : 'cinema' as const),
    within(creditFor(entry), 2000, d.creator),
  ]);
  let pic: Picture;
  try {
    pic = await drawStory({
    kind: d.type, title: d.title, year: d.year, creator: credit || undefined, season: d.season,
    rating: d.rating, loved: d.loved, status: statusLabel(d.type, d.status), line,
    owner: profile.username, cover: d.cover, color: d.color, bg,
    }, width);
  } catch (e) {
    if (e instanceof CoverMissing) return coverSlow();
    throw e;
  }
  mark('size', pic.body.length / 1024, 'KB');
  // a card drawn before its line is saved is not kept: the next one will have the line
  const complete = !!line || d.type === 'essay';
  // the header tells the share window to ask again in a few seconds: the line is being written
  if (!complete) return picture(pic, 'private, no-store', { 'X-Card': 'pending' });
  if (rendered.size > 40) rendered.delete(rendered.keys().next().value!);
  rendered.set(key, pic);
  return picture(pic, keep);
};
