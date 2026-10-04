# Granthalaya — notes for Claude Code

Sarthak's personal library of books, films and essays, painted in Pune. Built with Astro 5 (static pages) plus a few Vercel functions under `src/pages/api/` for the in-site Add screen. Hosted on Vercel; every push to `main` deploys.

## How the project is organised

- `src/content/library/*.md` holds one file per book, film or essay. The fields are in `src/content.config.ts` and the README has examples. The file name is the URL.
- `src/content/threads/*.md` holds the threads, hand-picked paths through the library.
- `src/data/site.ts` holds the name, season line, line of the week, reading pace and yearly goal.
- `src/pages/` holds the pages: home, library, entry pages, notes, threads, stats, about, add, rss, search.
- `src/components/Valley.astro` is the footer painting. It is four solid layers (`public/img/valley-{day,night}-{0..3}.webp`) that slide a few pixels with the cursor, plus a canvas for the flag, river glints, a falling banyan leaf and Pune rain. The footer links sit on the painting's lower edge.
- `public/art/` holds the page paintings, each in a day and a night version: home, library (also entry pages), lotw (Line of the Week), threads, stats, about and lost (404). They are shown as CSS backgrounds with the `.art` class and `--day`/`--night` variables, so they can't be dragged or saved with a right-click. `.melt` fades a painting into the page on every side, and `.bleed` makes it run the full width of the screen.
- `src/styles/global.css` holds the design tokens for light and dark (`html[data-theme]`).

## Rules Sarthak cares about

- **Never change the colours or quality of the paintings.** No filters, glows or overlays that tint them. Text goes in the quiet parts of a painting (sky, empty wall), never on a box over it.
- Motion stays subtle and slow, and nothing bends or warps the painting. Always respect `prefers-reduced-motion`.
- Keep the layout symmetrical and calm. No handwriting, tape or "moodboard" decoration.
- Keep explanations plain and non-technical.
- Never ask for or handle passwords or tokens in the chat. GitHub sign-in happens in the browser.

## Commands

- `npm run dev` starts a local preview at http://localhost:4321. The Add screen needs the Vercel environment variables, so it only works on the live site.
- `npm run build` builds the site. Run it before every commit.
