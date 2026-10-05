// Everything on one shelf that the visitor may see, for the ⌘K search box.
import type { APIRoute } from 'astro';
import { json } from '../../lib/http';
import { loadProfile, loadShelf, href, palette, radius, kind, fullTitle } from '../../lib/data';
export const prerender = false;

export const GET: APIRoute = async ({ locals, url }) => {
  const u = (url.searchParams.get('u') ?? '').toLowerCase();
  if (!locals.supabase || !u) return json([]);
  const found = await loadProfile(locals.supabase, u);
  if (!found || 'redirect' in found) return json([]);
  const seen = new Set<string>();
  const items = (await loadShelf(locals.supabase, found.profile)).filter((e) => !seen.has(e.id) && seen.add(e.id)).map((e) => ({
    title: fullTitle(e), creator: e.data.creator, kind: kind(e), href: href(e),
    bg: palette(e).bg, r: radius(e), year: String(e.data.year ?? e.data.date.getUTCFullYear()),
  }));
  return json(items);
};
