/** only ever send people to a page on this site after signing in */
export function safeNext(next: string | null | undefined, fallback = '/') {
  if (!next || !next.startsWith('/') || next.startsWith('//')) return fallback;
  // tabs, new lines, other control characters and backslashes are dropped or turned into slashes by browsers
  if (/[\s\x00-\x1f\x7f-\x9f\\]/.test(next)) return fallback;
  // the address has to stay on this site once it is read as a URL
  try {
    const u = new URL(next, 'https://site.invalid');
    if (u.origin !== 'https://site.invalid') return fallback;
  } catch { return fallback; }
  if (/^\/(auth|signin|welcome)\b/.test(next)) return fallback;
  return next;
}
