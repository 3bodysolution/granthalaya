/** only ever send people to a page on this site after signing in */
export function safeNext(next: string | null | undefined, fallback = '/') {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return fallback;
  if (/^\/(auth|signin|welcome)\b/.test(next)) return fallback;
  return next;
}
