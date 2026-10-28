// The year a book was first published, read from the opening of its Wikipedia text (shared by the site and scripts/fix-years.mjs).
// Open Library's year can be a later edition's (Yayati says 1978; it came out in 1959). Only two ways of writing it count:
//   "is a 1959 Marathi-language novel"   (a year straight after "a" or "an", then up to four words, then novel, book, play, collection...)
//   "first published in 1959" / "published in March 1959"
// Never a year the book is about ("a novel about the 1947 riots", "set in 1857", "the 1930s").
const WORK = '(?:novel|novella|book|play|collection|poem|poems|memoir|autobiography|biography|short stor(?:y|ies)|story|stories|epic|anthology|treatise|essay|essays|drama|work)';
const YEAR = '(1[0-9]{3}|20[0-2][0-9])';
const A_YEAR_WORK = new RegExp(`\\b(?:a|an)\\s+${YEAR}\\s+(?:[\\p{L}'’-]+\\s+){0,4}?${WORK}\\b`, 'iu');
const PUBLISHED = new RegExp(`\\bpublished\\s+in\\s+(?:[A-Z][a-z]+\\s+)?(?:\\d{1,2},?\\s+)?${YEAR}\\b`);

/** the year the text says the book was first published, or undefined */
export function yearInText(text) {
  if (!text) return undefined;
  const sentence = String(text).split(/(?<=[a-z)])\.\s/)[0];
  const found = [sentence.match(A_YEAR_WORK)?.[1], sentence.match(PUBLISHED)?.[1]].filter(Boolean).map(Number);
  return found.length ? Math.min(...found) : undefined;
}

/**
 * Open Library's year, unless the page's Wikipedia intro names an earlier first-publication year. Never later than Open Library's,
 * and never taken from an AI-adapted or Open Library text (only `source` "wikipedia").
 */
export function firstYear(year, text, source) {
  if (source !== 'wikipedia' || !text) return year;
  const y = yearInText(text);
  return y && y >= 1000 && (!year || y < year) ? y : year;
}
