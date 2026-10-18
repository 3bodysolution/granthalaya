// The essays Granthalaya picked (src/data/essays.json, built by scripts/essays/build.mjs): themes, and each author's page.
import data from '../data/essays.json';
import { authorHref } from './catalog/books';

export type Essay = (typeof data.themes)[number]['items'][number];
export const source = data.source;
/** one word each; the address is /essays/?theme=<slug> */
/** shown as "On writing", "On India" and so on; Picks is not a subject, so it keeps its name */
const label = (n: string) => (n === 'Picks' ? n : `On ${n === 'India' ? n : n.toLowerCase()}`);
export const themes = data.themes.map((t) => ({ name: t.name, label: label(t.name), slug: t.name.toLowerCase(), items: t.items as Essay[] }));
export const allEssays = themes.flatMap((t) => t.items);
export const total = allEssays.length;

/** an author's page: Open Library's own /author/ page when they're there, else a simple page of ours */
export const authorLink = (e: Pick<Essay, 'author' | 'authorKey' | 'authorSlug'>) => (e.authorKey ? authorHref(e.authorKey, e.author) : `/writer/${e.authorSlug}/`);
/** what the bookmark sends: the essay joins the shared catalogue the first time someone saves it */
export const essayHit = (e: Essay) => ({ kind: 'essay', title: e.title, creator: e.author, year: e.year ?? undefined, link: e.link, source: e.publication ?? undefined });
