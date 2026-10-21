// What the share window needs before it draws a story card: the card's version, the title's short line
// and the owner's saved Lines for this title. Only for the owner (it is their share window).
import type { APIRoute } from 'astro';
import { loadVisits } from '../../../../lib/data';
import { titleLine } from '../../../../lib/cards/tagline';
export const prerender = false;

export const GET: APIRoute = async ({ params, locals }) => {
  const gone = () => new Response('Not found', { status: 404, headers: { 'Cache-Control': 'no-store' } });
  const sb = locals.supabase, me = locals.me;
  if (!sb || !me || me.username !== String(params.username ?? '').toLowerCase()) return gone();
  const [entry] = await loadVisits(sb, me, String(params.slug ?? ''));
  if (!entry) return gone();
  const { data: row } = await sb.from('logs').select('updated_at').eq('id', entry.logId).maybeSingle();
  if (!row) return gone();
  const lines = [...new Set(entry.data.highlights.map((x) => x.text.replace(/\s+/g, ' ').trim()).filter((t) => t && t.length <= 140))].slice(0, 12);
  const body = { v: String(Math.floor(Date.parse(row.updated_at) / 1000)), line: (await titleLine(sb, entry)) ?? '', lines };
  return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store' } });
};
