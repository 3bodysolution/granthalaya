// Search for the top bar.
//   ?q=paterson   films, TV, people (TMDB), books and authors (Open Library, then Google Books), and members here
//   ?u=sarthak    everything on one shelf that the visitor may see (for "On your shelf")
import type { APIRoute } from 'astro';
import { json } from '../../lib/http';
import { loadProfile, loadShelf, href, palette, radius, kind, fullTitle, coverSrc } from '../../lib/data';
import { searchEverything } from '../../lib/catalog/searchall';
import { answerRequest } from '../../lib/catalog/ask';
export const prerender = false;

export const GET: APIRoute = async ({ locals, url, clientAddress }) => {
  // a request like "best sports movies": the AI turns the words into filters, we find the real results (only the typed words are used,
  // nothing about the visitor). Asked for separately so the normal results never wait for it.
  const ask = (url.searchParams.get('ask') ?? '').trim().slice(0, 100);
  if (ask) {
    let ip: string | undefined;
    try { ip = clientAddress; } catch { ip = undefined; }
    const { answer, how } = await answerRequest(ask, locals.supabase, ip);
    return new Response(JSON.stringify({ answer, how }), { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, max-age=300' } });
  }
  const text = (url.searchParams.get('q') ?? '').trim().slice(0, 100);
  if (text) {
    if (text.length < 2) return json({ titles: [], people: [], books: [], authors: [], members: [] });
    const r = await searchEverything(locals.supabase, text);
    return new Response(JSON.stringify(r), { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, max-age=60' } });
  }
  const u = (url.searchParams.get('u') ?? '').toLowerCase();
  if (!locals.supabase || !u) return json([]);
  const found = await loadProfile(locals.supabase, u);
  if (!found || 'redirect' in found) return json([]);
  const seen = new Set<string>();
  const items = (await loadShelf(locals.supabase, found.profile)).filter((e) => !seen.has(e.id) && seen.add(e.id)).map((e) => ({
    title: fullTitle(e), creator: e.data.creator, kind: kind(e), href: href(e),
    bg: palette(e).bg, r: radius(e), cover: coverSrc(e) ?? '', year: String(e.data.year ?? e.data.date.getUTCFullYear()),
  }));
  return json(items);
};
