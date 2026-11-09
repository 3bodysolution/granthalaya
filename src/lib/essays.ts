// The essays Granthalaya picked (src/data/essays.json, built by scripts/essays/build.mjs): themes, and each author's page.
import data from '../data/essays.json';
import ny from '../data/new-yorker.json';
import access from '../data/essay-access.json';
import { authorHref } from './catalog/books';

export interface Essay {
  title: string; author: string; authorKey: string | null; authorSlug: string | null; publication: string | null; year: number | null;
  link: string; note: string | null; via?: string; theme?: string;
}
export const source = data.source;

/* Whether an essay is free to read, from its own page's data (scripts/essays/access.mjs, refreshed at most monthly). Internal only: it
   orders essays and is never shown. Free first, then unknown, then paywalled; inside each group the order stays as it was. */
type Access = 'free' | 'unknown' | 'paywalled';
const known = access as Record<string, { access: Access }>;
const RANK: Record<Access, number> = { free: 0, unknown: 1, paywalled: 2 };
export const freeFirst = <T extends { link: string }>(items: T[]): T[] =>
  items.map((e, i) => [e, i] as const).sort((a, b) => RANK[known[a[0].link]?.access ?? 'unknown'] - RANK[known[b[0].link]?.access ?? 'unknown'] || a[1] - b[1]).map((x) => x[0]);

/** Best of The New Yorker: the Electric Typewriter's selection, in the order of its page */
export const collection = {
  slug: 'new-yorker', name: ny.name, curator: ny.curator,
  items: freeFirst(ny.items as Essay[]),
};

/** one word each; the address is /essays/?theme=<slug> */
/** shown as "On writing", "On India" and so on; Picks is not a subject, so it keeps its name */
const label = (n: string) => (n === 'Picks' ? n : `On ${n === 'India' ? n : n.toLowerCase()}`);
// a New Yorker article joins a theme only where its title makes the theme obvious (new-yorker.json says which)
export const themes = data.themes.map((t) => ({
  name: t.name, label: label(t.name), slug: t.name.toLowerCase(),
  items: freeFirst([...(t.items as Essay[]), ...collection.items.filter((e) => e.theme === t.name)]),
}));
/** every essay we list, for author pages and "on your shelf" lookups */
export const allEssays: Essay[] = [...new Map([...themes.flatMap((t) => t.items), ...collection.items].map((e) => [e.link, e])).values()];
/** the count the Essays page quotes: the ones we chose ourselves */
export const total = data.themes.reduce((n, t) => n + t.items.length, 0);

/** an author's page: Open Library's own /author/ page when they're there, else a simple page of ours */
export const authorLink = (e: Pick<Essay, 'author' | 'authorKey' | 'authorSlug'>) => (e.authorKey ? authorHref(e.authorKey, e.author) : `/writer/${e.authorSlug}/`);
/** what the bookmark sends: the essay joins the shared catalogue the first time someone saves it */
export const essayHit = (e: Essay) => ({ kind: 'essay', title: e.title, creator: e.author, year: e.year ?? undefined, link: e.link, source: e.publication ?? undefined });
