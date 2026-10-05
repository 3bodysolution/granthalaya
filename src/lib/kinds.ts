// What each kind of thing is called, and the status tags each one can have.
// Safe to use in the browser too: nothing secret, nothing from the server.

export type Kind = 'book' | 'film' | 'tv' | 'essay';
export type Status = 'want' | 'reading' | 'watching' | 'paused' | 'done' | 'dnf' | 'dropped';

export const KINDS: Kind[] = ['book', 'film', 'tv', 'essay'];
export const kindName: Record<Kind, string> = { book: 'Book', film: 'Film', tv: 'TV', essay: 'Essay' };
export const kindPlural: Record<Kind, string> = { book: 'Books', film: 'Films', tv: 'TV', essay: 'Essays' };
export const kindColor: Record<Kind, string> = { book: 'var(--book)', film: 'var(--sky)', tv: 'var(--sky)', essay: 'var(--moss)' };

/** the tags, in the order they're offered */
export const STATUSES: Record<Kind, [Status, string][]> = {
  book: [['want', 'Want to read'], ['reading', 'Reading'], ['done', 'Read'], ['paused', 'Paused'], ['dnf', 'Didn’t finish']],
  film: [['want', 'Want to watch'], ['done', 'Watched'], ['dnf', 'Didn’t finish']],
  tv: [['want', 'Want to watch'], ['watching', 'Watching'], ['done', 'Watched'], ['paused', 'Paused'], ['dropped', 'Dropped']],
  essay: [['want', 'Saved for later'], ['done', 'Read']],
};

export function statusLabel(kind: Kind, s: Status) {
  return STATUSES[kind].find(([k]) => k === s)?.[1] ?? 'On the shelf';
}
export const statusFits = (kind: Kind, s: string): s is Status => STATUSES[kind].some(([k]) => k === s);
/** finished things count in stats; everything else is "on the shelf" */
export const finished = (s: Status) => s === 'done';
export const inProgress = (s: Status) => s === 'reading' || s === 'watching';

/* ——— usernames ——— */
export const USERNAME_RE = /^[a-z0-9_]{3,20}$/;
export function usernameProblem(u: string): string | null {
  if (u.length < 3) return 'At least 3 characters.';
  if (u.length > 20) return 'At most 20 characters.';
  if (!USERNAME_RE.test(u)) return 'Only lowercase letters, numbers and _.';
  return null;
}

/* ——— social links on profiles ——— */
export const LINKS = [
  { key: 'instagram', label: 'Instagram', base: 'https://instagram.com/' },
  { key: 'x', label: 'X', base: 'https://x.com/' },
  { key: 'letterboxd', label: 'Letterboxd', base: 'https://letterboxd.com/' },
  { key: 'goodreads', label: 'Goodreads', base: 'https://www.goodreads.com/' },
  { key: 'substack', label: 'Substack', base: '' },
  { key: 'website', label: 'Website', base: '' },
] as const;
export type LinkKey = (typeof LINKS)[number]['key'];

/** a profile's saved links, ready to show: where they go and a short label */
export function socialLinks(saved: Record<string, string> | null | undefined) {
  const out: { key: LinkKey; label: string; href: string }[] = [];
  for (const l of LINKS) {
    const v = (saved ?? {})[l.key]?.trim();
    if (!v) continue;
    const isUrl = /^https?:\/\//i.test(v);
    const href = isUrl ? v : l.base ? l.base + v.replace(/^@/, '') : `https://${v}`;
    if (!/^https?:\/\/[^\s"'<>]+$/i.test(href)) continue;
    const label = l.key === 'website' || l.key === 'substack'
      ? href.replace(/^https?:\/\/(www\.)?/i, '').replace(/\/$/, '')
      : (isUrl ? v.replace(/^https?:\/\/[^/]+\//i, '') : v).replace(/^@/, '').replace(/\/$/, '');
    out.push({ key: l.key, label, href });
  }
  return out;
}
