// What the share window needs for one thing: its public short link and the text that goes with it (WhatsApp, X).
// It never waits for the AI: the line is the saved one, if any. Public things only: private accounts, "Only me" entries and blocks give a 404.
//   ?title=film:<address part> | tv:... | book:...   a film, show or book page
//   ?entry=<username>/<slug>                         a title on someone's shelf
//   ?year=<username>/<year>                          the My year card
//   ?col=<collection id>                             a collection
import type { APIRoute } from 'astro';
import { json } from '../../lib/http';
import { loadProfile, loadShelf, loadVisits, loadCollections } from '../../lib/data';
import { pageBits } from '../../lib/cards/titlepage';
import { within } from '../../lib/cards/output';
import { creditFor } from '../../lib/cards/credits';
import { cardFacts } from '../../lib/cards/tagline';
import { shortPath, pageText, entryText, yearText, collectionText } from '../../lib/share';
import { titlePageHref } from '../../lib/catalog/onsite';
export const prerender = false;

export const GET: APIRoute = async ({ url, locals, site }) => {
  const gone = () => json({ error: 'Not found' }, 404);
  const sb = locals.supabase;
  if (!sb) return gone();
  const abs = (path: string | null) => new URL(path ?? '/', site ?? url.origin).href;
  const q = (k: string) => url.searchParams.get(k) ?? '';

  if (q('title')) {
    const [type, ...rest] = q('title').split(':');
    const b = await pageBits(sb, type, rest.join(':'));
    if (!b) return gone();
    const link = abs(b.short);
    return json({ link, text: pageText(b, b.line, link) });
  }

  if (q('entry')) {
    const [user, slug] = q('entry').split('/');
    const found = await loadProfile(sb, (user ?? '').toLowerCase(), locals.me);
    if (!found || 'redirect' in found) return gone();
    const { profile } = found;
    const isMe = locals.me?.id === profile.id;
    if (profile.is_private && !isMe) return gone();
    const [e] = await loadVisits(sb, profile, slug ?? '');
    if (!e || (e.data.private && !isMe)) return gone();
    const d = e.data;
    const row = { kind: d.type, tmdb_id: d.tmdbId ?? null, ol_key: d.olKey ?? null, slug: e.id, link: d.link ?? null, title: d.title };
    const short = shortPath(row);
    const [facts, by] = await Promise.all([cardFacts(sb, e), within(creditFor(e), 2000, d.creator)]);   // never waits for the AI
    // a title with no short address (an essay, or a film we only know by name) goes to its full page, or to the home page
    const link = abs(short ?? titlePageHref(row));
    return json({ link, text: entryText({ kind: d.type, title: d.title, year: d.year, creator: by }, d.status, d.rating, facts.line, link) });
  }

  if (q('year')) {
    const [user, y] = q('year').split('/');
    const found = await loadProfile(sb, (user ?? '').toLowerCase(), locals.me);
    if (!found || 'redirect' in found) return gone();
    const { profile } = found;
    if (profile.is_private && locals.me?.id !== profile.id) return gone();
    const year = Number(y);
    const list = (await loadShelf(sb, profile, { byShow: false })).filter((e) => e.data.status === 'done' && !e.data.private && e.data.date.getUTCFullYear() === year);
    const books = list.filter((e) => e.data.type === 'book').length;
    const films = list.filter((e) => e.data.type === 'film' || e.data.type === 'tv').length;
    const link = abs(profile.is_private ? null : `/@${profile.username}/stats/?year=${year}`);
    return json({ link, text: yearText(year, books, films, link) });
  }

  if (q('col')) {
    const { data } = await sb.from('threads').select('user_id, profiles(username)').eq('id', q('col')).maybeSingle();
    const owner = (data as any)?.profiles?.username as string | undefined;
    if (!owner) return gone();
    const found = await loadProfile(sb, owner, locals.me);
    if (!found || 'redirect' in found) return gone();
    if (found.profile.is_private && locals.me?.id !== found.profile.id) return gone();
    const col = (await loadCollections(sb, found.profile)).find((c) => c.uuid === q('col'));
    if (!col) return gone();
    const books = col.data.items.filter((i) => i.title.kind === 'book').length;
    const link = abs(`/c/${col.uuid}`);
    return json({ link, text: collectionText(col.data.title, books, col.data.items.length - books, link) });
  }
  return gone();
};
