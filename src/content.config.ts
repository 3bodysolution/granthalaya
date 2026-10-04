import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

// One Markdown file per thing you've read or watched, in src/content/library/.
// The text under the --- block is your note about it.
const library = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/library' }),
  schema: z.object({
    title: z.string(),
    type: z.enum(['book', 'film', 'essay']),
    creator: z.string(),                       // author, director or writer
    year: z.number().optional(),               // year it came out
    date: z.coerce.date(),                     // when you finished / watched / read it
    status: z.enum(['done', 'reading', 'watching']).default('done'),
    progress: z.number().min(0).max(100).optional(), // for things in progress
    rating: z.number().min(0).max(5).optional(),     // 0–5, halves allowed (4.5)
    loved: z.boolean().default(false),         // for essays: a heart instead of stars
    runtime: z.number().optional(),            // films: minutes
    pages: z.number().optional(),              // books: pages
    words: z.number().optional(),              // essays: word count
    link: z.string().url().optional(),         // where it lives (essays) or a page about it
    source: z.string().optional(),             // essays: Substack, a blog, a magazine…
    where: z.string().optional(),              // "at home", "film club"…
    times: z.number().default(1),              // how many times you've read / watched it
    color: z.string().optional(),              // override the painted cover colour
    cover: z.string().optional(),              // a cover image link, or "painted" to keep the painted cover
    private: z.boolean().default(false),       // true = never shown on the site
    startHere: z.number().optional(),          // 1–5: shows in "Start here" on the home page
    startWhy: z.string().optional(),           // one line for "Start here"
    tags: z.array(z.string()).default([]),
    highlights: z.array(z.object({
      text: z.string(),
      where: z.string().optional(),            // chapter, page, timestamp
      note: z.string().optional(),             // your thought about it
      mine: z.boolean().default(false),        // true = it's your own line, not a quote
    })).default([]),
  }),
});

// Threads: hand-picked paths through the library, in src/content/threads/.
const threads = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/threads' }),
  schema: z.object({
    title: z.string(),
    order: z.number().default(99),
    items: z.array(z.object({ slug: z.string(), why: z.string() })),
  }),
});

export const collections = { library, threads };
