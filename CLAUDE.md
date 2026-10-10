# Granthalaya — notes for Claude Code

A shelf for everything you read and watch (books, films, TV seasons, essays), in hand-painted scenes. Started as Sarthak's own library; since Phase 1 anyone can sign in with Google and keep a shelf at `/@username`. Astro 5 rendered on request (`output: 'server'`) on Vercel (functions in Mumbai, `bom1`), with a Supabase database. Every push to `main` deploys.

## How the project is organised

- **Database:** `supabase/schema.sql` is the whole schema: tables, privacy rules (row level security), triggers and grants. Change it there, and give Sarthak the extra SQL to run in Supabase → SQL Editor. Tables: `profiles`, `profile_details`, `username_history`, `titles` (the shared catalogue), `logs` (one row per visit to a title), `highlights`, `threads`, `thread_items`, `blocks`, `reports`.
- **One door to the data:** pages read shelves, profiles and threads only through `src/lib/data.ts` (`loadProfile`, `loadShelf`, `loadVisits`, `loadThreads`, `loadFeatured`). Rows become `Entry` objects shaped like the old markdown entries, so `Cover`, `Tile` and the pages share one shape.
- **Who's visiting:** `src/middleware.ts` makes a Supabase client from the visitor's cookies (`Astro.locals.supabase`), reads the signed-in person (`locals.user`) and their profile (`locals.me`). Signed in without a username yet means a redirect to `/welcome`. It also redirects old addresses (`/library/x` → `/@sarthak/library/x`).
- **Two database clients** (`src/lib/supabase.ts`): `serverClient` acts as the visitor, so the database's privacy rules always apply. `adminClient` uses the secret key and is only for the shared catalogue (`src/lib/titles.ts`), username checks, account deletion, the blocked list in Settings and the admin page, always after the code has checked who's asking. Never use it to read someone's shelf for display.
- **Pages:** `src/pages/index.astro` (welcome when signed out, your home when signed in), `@[username]/` (profile, library, entry `library/[slug]`, diary, notes, threads, stats, rss), `add.astro`, `settings.astro`, `welcome.astro`, `signin.astro`, `admin.astro`, `about`, `privacy`, `terms`, `404`. Every `/@username` page starts with `openShelf()` from `src/lib/shelfpage.ts`.
- **APIs** in `src/pages/api/`: `log` (add, change, remove entries), `lookup` (search), `favourite`, `block`, `report`, `profile`, `welcome`, `username`, `export`, `account`, `admin`, `search`, `keepalive`. Sign-in lives in `src/pages/auth/` (Google → `/auth/callback` → `/welcome` for new people).
- **Kinds and status tags:** `src/lib/kinds.ts` (`STATUSES`, labels, usernames, social links). The database checks the same rules.
- **Catalogue:** `src/lib/lookup.ts` finds things (Open Library for books, TMDB for films and TV seasons, pasted links); `src/lib/titles.ts` adds them to `titles` once, so the second person to add a film gets its cover, runtime and facts instantly. Covers are only taken from `image.tmdb.org` and `covers.openlibrary.org`; the 20 old covers stay in `public/covers` and are referenced as `/covers/<file>.jpg`.
- **Facts:** `src/lib/trivia.mjs` finds the Wikipedia page and asks a free AI model (Gemini, then Groq) for 3 facts from that page only. Run after saving, in the background (`waitUntil`); `npm run trivia` fills in titles still missing them. Facts: under 30 words, no em dashes, never the plot.
- **Notes are untrusted text:** show them with `md()` from `src/lib/md.ts` (paragraphs, italics, bold, http links only). Never `set:html` anything else people wrote.
- **Design:** `src/styles/global.css` holds the tokens for light and dark (`html[data-theme]`); Starwind UI + Tailwind 4 are set up (`src/styles/starwind.css`, `src/components/starwind/`), plus our own pieces in `src/components/ui/` (`StatusTag`, `StatusIcon`, `SectionHead`, `SocialLink`, `GoogleButton`). Watch for class names that clash with `global.css` (`.foot`, `.date`, `.key` are taken).
- `public/art/` holds the page paintings (day and night), shown as CSS backgrounds with `.art` and `--day`/`--night`. `.melt` fades a painting into the page, `.bleed` runs it full width. `src/components/Valley.astro` is the footer painting; its shepherd says the page's line of the week.
- `src/content/` (the old markdown library) is kept as a backup and as the source for `npm run migrate`. The site no longer reads it.
- `astro.config.mjs` → `security.allowedDomains` lists the site's addresses (the main one and `*.vercel.app` previews). Astro only trusts the address Vercel passes on for these, so a custom domain must be added there too, or sign-in and saving break on it (Astro would think the page is at `https://localhost`).
- `vercel.json`: functions in `bom1` (next to the database in Mumbai) and a daily cron to `/api/keepalive` so the free database never pauses.

## Rules Sarthak cares about

- **Never change the colours or quality of the paintings.** No filters, glows or overlays that tint them. Text goes in the quiet parts of a painting (sky, empty wall), never on a box over it.
- Motion stays subtle and slow, and nothing bends or warps the painting. Always respect `prefers-reduced-motion`.
- Keep the layout symmetrical and calm. No handwriting, tape or "moodboard" decoration.
- Keep explanations plain and non-technical.
- **Writing on the site:** plain, specific words. No em dashes anywhere (use a full stop, comma or brackets). No "Headline, *italic ending.*" pattern and no cute filler lines.
- The logo is the bookmark reel (`src/components/Logo.astro`, `public/favicon.svg`). The glossy 3D renders (`public/img/mark-3d-{day,night}.webp`) only where it's shown large.
- Colours: the accent `--lat` is peacock teal (#0F6A66 by day, #6CC9BF by night). Books use `--book` (coffee), films and TV `--sky`, essays `--moss`. Teal is for actions; filters and details use flat grey chips (`.gchip`). No orange accents.
- **Privacy first:** every new table gets row level security and explicit grants in `supabase/schema.sql` (this project doesn't expose new tables automatically). Private accounts, "Only me" entries and blocks must hold in the database, not just in the page.
- Never ask for or handle passwords, keys or tokens in the chat. They go in Vercel and `.env` only.
- Never add Claude as a co-author on commits.

## Commands

- `npm run dev` starts a local copy at http://localhost:4321 (needs the Supabase values in `.env`).
- `npm run build` builds the site. Run it before every commit.
- `npm run migrate` copies the old markdown library onto the `sarthak` shelf (replaces that shelf; run it once, just before switching over).
- `npm run trivia` fills in missing "Behind the film" facts.
