// A small limit on the addresses that cost the most (search, drawn cards, cover copies), per visitor address.
// It lives in the memory of one running copy of the site, so it only slows down a hammering client; Vercel's firewall
// rate limits (docs/rate-limits.md) are the real fence, and cards and covers are also kept by Vercel's CDN.
type Rule = { match: RegExp; limit: number; per: number; name: string };
const RULES: Rule[] = [
  { name: 'search', match: /^\/api\/search$/, limit: 60, per: 60_000 },   // the typed words and the request question are two asks
  { name: 'searchpage', match: /^\/search\/?$/, limit: 30, per: 60_000 },   // the full results page (it also asks TMDB, Open Library and the model once per visit)
  { name: 'cards', match: /^\/(og\/|story\/)|\/(story|year)\.png$/, limit: 30, per: 60_000 },
  { name: 'covers', match: /^\/api\/cover$/, limit: 240, per: 60_000 },
];
const seen = new Map<string, number[]>();

/** a plain yes or no for a limit of our own (the AI questions of search): `limit` times in `per` ms for `who`; counts the ask when it says yes */
export function allowed(name: string, who: string | undefined, limit: number, per: number): boolean {
  if (!who || who === '127.0.0.1' || who === '::1') return true;   // this computer (local work)
  const now = Date.now(), key = `${name}:${who}`;
  const recent = (seen.get(key) ?? []).filter((t) => now - t < per);
  if (recent.length >= limit) { seen.set(key, recent); return false; }
  recent.push(now);
  seen.set(key, recent);
  return true;
}

/** a 429 answer when this visitor has asked for this kind of address too often lately, else null */
export function rateLimited(path: string, ip: string | undefined): Response | null {
  if (!ip || ip === '127.0.0.1' || ip === '::1') return null;   // this computer (local work)
  const rule = RULES.find((r) => r.match.test(path));
  if (!rule) return null;
  const now = Date.now(), key = `${rule.name}:${ip}`;
  const recent = (seen.get(key) ?? []).filter((t) => now - t < rule.per);
  if (recent.length >= rule.limit) {
    seen.set(key, recent);
    return new Response('Too many requests. Please slow down.', { status: 429, headers: { 'Retry-After': '30', 'Cache-Control': 'no-store', 'Content-Type': 'text/plain; charset=utf-8' } });
  }
  recent.push(now);
  seen.set(key, recent);
  if (seen.size > 5000) for (const [k, v] of seen) if (!v.some((t) => now - t < 60_000)) seen.delete(k);
  return null;
}
