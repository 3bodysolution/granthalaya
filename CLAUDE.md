# Granthalaya — notes for Claude Code

Sarthak's personal library of books, films and essays, in hand-painted scenes. Built with Astro 5 (static pages) plus a few Vercel functions under `src/pages/api/` for the in-site Add screen. Hosted on Vercel; every push to `main` deploys.

## How the project is organised

- `src/content/library/*.md` holds one file per book, film or essay. The fields are in `src/content.config.ts` and the README has examples. The file name is the URL.
- `src/content/threads/*.md` holds the threads, hand-picked paths through the library.
- `src/data/site.ts` holds the site settings and, under `owner`, everything personal: name, season line, line of the week, reading pace, yearly goal and where to check for rain. Never hardcode the owner's name or city in a page; read it from here.
- `src/pages/` holds the pages: home, library, entry pages, notes, threads, stats, about, add, rss, search.
- `src/components/Valley.astro` is the footer painting. It is four solid layers (`public/img/valley-{day,night}-{0..3}.webp`) that slide a few pixels with the cursor, plus a canvas for the flag, river glints, a falling banyan leaf and rain (when it's raining at `site.owner.weather`). The footer links sit on the painting's lower edge.
- `public/art/` holds the page paintings, each in a day and a night version: home, library (also entry pages), lotw (Line of the Week), threads, stats, about and lost (404). They are shown as CSS backgrounds with the `.art` class and `--day`/`--night` variables, so they can't be dragged or saved with a right-click. `.melt` fades a painting into the page on every side, and `.bleed` makes it run the full width of the screen.
- Covers: `src/components/Cover.astro` shows a real cover when `coverSrc()` in `src/lib/data.ts` finds one (the entry's `cover` link, or `public/covers/<file name>.jpg`), and the painted one otherwise. `npm run covers` (`scripts/covers.mjs`) fetches missing covers: books from Open Library, films only from TMDB (key in `.env` as `TMDB_API_KEY`, never committed). Never use Wikipedia for film posters; it returns photos of people instead. `cover: painted` on an entry, or `covers: 'painted'` in `site.ts`, keeps painted covers.
- Books in progress store `page` (the page you're on) next to `pages`; `percent()` and `whereAt()` in `src/lib/data.ts` turn that into "Page 142 of 320" and the time left. Old entries may still have `progress` (a percent).
- `trivia` (a list of short facts) and `triviaSource` (a link) on an entry show as "Behind the film" or "Behind the book". `src/lib/trivia.mjs` finds the Wikipedia page and asks a free AI model (Gemini with `GEMINI_API_KEY`, or Groq with `GROQ_API_KEY`) to pick 3 facts from that page only. The Add screen runs it when saving a film or book; `npm run trivia` fills in older entries (keys in `.env`). If it fails, the entry saves without facts. Facts: under 30 words, no em dashes.
- `src/styles/global.css` holds the design tokens for light and dark (`html[data-theme]`).

## Architecture: built so friends can join later

The plan is one shared Granthalaya where each person has their own shelf. Today there is one person (Sarthak) and the library lives in markdown files. Keep these rules so that day needs no redesign:

- **One door to the data.** Pages read entries and threads only through `src/lib/data.ts` (`getEntries`, `getAllEntries`, `getThreads`). Never call `getCollection` from a page. Moving to a database later means rewriting that file only.
- **Nothing personal is hardcoded.** Names, season line, quote, goal, weather spot: all from `site.owner` in `src/data/site.ts`.
- **Sign-in knows the person.** `src/lib/server.ts` stores the person's id in the session (`currentUser`), and edits are checked with `canEdit(cookies, shelf)`. New features should ask "who is this?" rather than "is this the owner?".
- **Film and book data belongs to the title, not the person.** Covers (`scripts/covers.mjs`) and facts (`src/lib/trivia.mjs`) take only a title, year and type, so they can be shared between everyone who adds the same film.
- **The future step** (only when the first friend joins): a free database (Supabase or Neon) behind `src/lib/data.ts`, Google sign-in, addresses like `/sarthak/library/paterson` with redirects from today's links, and pages rendered on request instead of at build time. The design, components and paintings stay as they are.

## Rules Sarthak cares about

- **Never change the colours or quality of the paintings.** No filters, glows or overlays that tint them. Text goes in the quiet parts of a painting (sky, empty wall), never on a box over it.
- Motion stays subtle and slow, and nothing bends or warps the painting. Always respect `prefers-reduced-motion`.
- Keep the layout symmetrical and calm. No handwriting, tape or "moodboard" decoration.
- Keep explanations plain and non-technical.
- **Writing on the site:** plain, specific words in Sarthak's voice. No em dashes anywhere (use a full stop, comma or brackets). No "Headline, *italic ending.*" pattern and no cute filler lines.
- The logo is the bookmark reel (`src/components/Logo.astro`, `public/favicon.svg`): a bookmark that is also a strip of film, holes cut through. The flat one-colour version is used in the header and browser tab; the glossy 3D renders (`public/img/mark-3d-{day,night}.webp`) only where it is shown large (About page, link preview, phone icon).
- Colours: the accent `--lat` is peacock teal (#0F6A66 by day, #6CC9BF by night). Books use `--book` (coffee), films `--sky`, essays `--moss`. No orange accents.
- Never ask for or handle passwords or tokens in the chat. GitHub sign-in happens in the browser.

## Commands

- `npm run dev` starts a local preview at http://localhost:4321. The Add screen needs the Vercel environment variables, so it only works on the live site.
- `npm run build` builds the site. Run it before every commit.
