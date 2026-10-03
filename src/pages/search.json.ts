import type { APIRoute } from 'astro';
import { getEntries, href, palette, radius, kind } from '../lib/data';

export const GET: APIRoute = async () => {
  const all = await getEntries();
  const items = all.map((e) => ({
    title: e.data.title,
    creator: e.data.creator,
    kind: kind(e),
    href: href(e),
    bg: palette(e).bg,
    r: radius(e),
    year: String(e.data.year ?? e.data.date.getUTCFullYear()),
  }));
  return new Response(JSON.stringify(items), { headers: { 'Content-Type': 'application/json' } });
};
