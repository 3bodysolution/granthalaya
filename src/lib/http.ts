// Small helpers for the /api routes.
import type { APIContext } from 'astro';

export const json = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers } });

export const oops = (error: string, status = 400) => json({ error }, status);

/** the signed-in person with a profile, or a ready-made error response */
export function needMe(ctx: APIContext) {
  const me = ctx.locals.me;
  if (!me) return { me: null, res: oops('Please sign in again.', 401) } as const;
  return { me, res: null } as const;
}

/** read a JSON body without throwing */
export async function body<T = Record<string, unknown>>(request: Request): Promise<T | null> {
  try { return (await request.json()) as T; } catch { return null; }
}

/** trim a string field, or undefined if it's empty / not a string */
export const str = (v: unknown, max = 300) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined);
export const int = (v: unknown, min = 0, max = 1e9) => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : undefined;
};
export const isoDate = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !isNaN(Date.parse(v)) ? v : null);

/** only accept a form or fetch coming from this site */
export function sameOrigin(ctx: APIContext) {
  const o = ctx.request.headers.get('Origin');
  return !o || o === ctx.url.origin;
}
