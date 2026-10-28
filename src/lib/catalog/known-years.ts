// First publication years checked by hand (src/data/first-years.json, each with its source link). They win over Open Library's year
// and over the year read from a Wikipedia text, on the book's page and on every tile.
import data from '../../data/first-years.json';
import { firstYear } from './years.mjs';

type Known = { slug?: string; ol?: string; year: number };
const known = data.books as Known[];

/** the hand-checked year for a book (by catalogue slug or Open Library work key), if there is one */
export const knownYear = (ids: { slug?: string | null; ol?: string | null }): number | undefined =>
  known.find((k) => (ids.slug && k.slug === ids.slug) || (ids.ol && k.ol === ids.ol))?.year;

/** the year to show: the hand-checked one, else Open Library's unless the Wikipedia intro says an earlier one (years.mjs) */
export const shownYear = (ids: { slug?: string | null; ol?: string | null }, year: number | null | undefined, text?: string | null, source?: string | null): number | undefined =>
  knownYear(ids) ?? firstYear(year ?? undefined, text, source);
