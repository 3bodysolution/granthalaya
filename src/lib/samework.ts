// Is an older catalogue row the same film or book as one being added? Used when the older row has no TMDB or Open Library id.
// "Same title" is the exact title: only case, accents and punctuation are ignored (no looser matching).
const flat = (s?: string | null) => (s ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/&/g, 'and').replace(/[^\p{L}\p{N}]+/gu, '');

export const sameTitle = (a?: string | null, b?: string | null) => !!flat(a) && flat(a) === flat(b);

/** same title, both release years known and within one, and the same creator when both name one */
export function sameWork(add: { title: string; year?: number; creator?: string }, row: { title: string; year: number | null; creator: string | null }) {
  if (!sameTitle(add.title, row.title)) return false;
  if (!add.year || row.year == null || Math.abs(add.year - row.year) > 1) return false;
  const a = flat(add.creator), b = flat(row.creator);
  return !a || !b || a === b || a.includes(b) || b.includes(a);
}
