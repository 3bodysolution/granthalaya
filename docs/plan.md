# Plan and progress

Read this at the start of a session; update it when a part is done.

## Phase 2

- [x] Step 1. Tidy-ups (Collections, pinned line, settings in tabs, export).
- [x] Step 2. Title pages for films, TV, books, people and authors; lists with filters; search; collections you can make.
- [ ] Step 3. Discovery, in four parts:
  - [x] Part 1. Films, TV and Books front pages (rows of posters, browse chips) and the discovery-first home page.
  - [x] Part 2. Prize and classics lists (details below).
  - [x] Part 3. About 50 to 60 essays, chosen by Granthalaya, each linking to a free, legal original. readsomethinggreat.com has no archive (only 5 current essays on its homepage), so only those 5 carry "Found via Read Something Great". Candidates are in `docs/essay-candidates.md` (a checklist for Sarthak to tick); `node scripts/essays/check-links.mjs` marks dead links. Marathi and Hindi essays were dropped; all 75 remaining are ticked. Done: `scripts/essays/build.mjs` makes `src/data/essays.json` from the ticked lines, and `/essays/` shows all 91 (an Essays link in the top bar; credit on About). Checked: the 7 links that refused the script exist (confirmed by search), the uncertain years were confirmed from sources or removed (Idgah has none: sources disagree), and Premchand's two pieces link to the Hindi originals on Hindi Wikisource. Saving an essay to a shelf is not built yet.
  - [x] Part 4. Marathi and Hindi book lists suggested by a free AI model each week, every book checked against Open Library, Google Books or Wikipedia, with an admin "hide". Built; 003 is applied and the first run filled both lists (10 Marathi, 10 Hindi). Still needed: `CRON_SECRET` in Vercel, and the cron only runs on production, so after the merge to `main`.
- [ ] Step 4. Import from Goodreads, Letterboxd or our own export zip.
- [ ] Go live: re-run `npm run migrate`, merge `phase-1` into `main`, add the environment variables to Production in Vercel. Before that: `site.contact`, read Privacy and Terms again, Google branding links and publish the Google app, `npm audit`.

## Step 3, part 2: prize and classics lists

Each list is a JSON file in `src/data/lists/<slug>.json`:
`{ slug, title, kind: "book" | "film", intro, source: { name, url }, items: [{ year, title, creator, original_title?, language?, note?, pick?, release_year?, circa? }] }`.
Items are newest first for prizes, oldest first for classics. `pick: true` means we chose the book (Nobel, Jnanpith), not the prize. `circa: true` marks an approximate year (shown as "c. 1290").
`language` is an ISO 639-1 code (`mr`, `hi`, `en`); where a language has no 639-1 code, the 639-3 one (`kok`, `bry`). A film in several languages gets the first one listed, and English is left out on films. The classics lists use `source: { "name": "Chosen by Granthalaya", "url": "" }`.

Done (researched, checked against official sites):
- `booker` (1969 to 2025), `international-booker` (2016 to 2026), `pulitzer-fiction` (1960 to 2026), `nobel-literature` (1980 to 2026, one book per laureate).

Done (part 2 is finished): the lists are gathered and matched (`docs/unmatched.md` lists the doubtful ones), `/lists/` and `/lists/<slug>/` exist (`src/lib/lists.ts`), and the Books and Films front pages have the list rows and a "Prizes and classics" chip set. A second pass (`node scripts/lists/match.mjs --second`, unmatched items only: original titles, author alone, closest title; films by original title and language) cut the unmatched items. A third run with the Google Books key (4 items at a time, Google Books first for Devanagari titles) left: marathi-classics 15, hindi-classics 7, jnanpith 34, sahitya-akademi-hindi 49, sahitya-akademi-marathi 60, and a few others (international-booker 2, national-best-feature 4, national-best-marathi 1, pulitzer-fiction 1, world-classics 3). Open Library and Google Books barely cover Marathi and Hindi books, so these need another source (Part 4, or hand-picked ids). Unmatched tiles open the search with the title filled in, and the front page rows only show matched items with a cover. The second pass's "Check" matches are listed under "Second pass" in `docs/unmatched.md`. Books that Open Library and Google Books don't have now have our own catalogue record: `node scripts/lists/make-records.mjs` made 168 `titles` rows (kind book, `source = 'Granthalaya lists'`, with `original_title`, `language` and `note`; prize lists get no year because their year is the prize's) and reused 3. Each item carries its `slug`, so its tile opens `/book/<slug>/` and can be saved. Records marked `Granthalaya lists` are never looked up on Open Library (`LIST_SOURCE` in `src/lib/catalog/onsite.ts`). Lists open in place on Books and Films: `/books/?list=booker`, `/films/?list=palme-dor` (film lists only, not for TV) show the list as the grid under the filter bar, with its intro above and the source below (`components/title/ListGrid.astro`, `pickList` in `src/lib/lists.ts`). Decade filters the list's own years; choosing a list resets the other filters, and changing another filter leaves the list (`clears` on `Filters.astro` fields). Filter changes keep the scroll position and skip the loader (`__keepPlace` in `Base.astro`). Chips and "See all" use the in-place address; `/lists/` and `/lists/<slug>/` stay for sharing. Books without an Open Library or Google Books match have our own records, with painted covers. Attaching Open Library ids by hand to those records is parked for now.

Database changes: `npm run db:apply -- --dry` lists the files in `supabase/changes/` still waiting, `npm run db:apply` runs them (needs `SUPABASE_DB_URL` in `.env`; `--mark 001` records a file you ran by hand). Applied files are kept in `public.applied_changes` (row level security, no policies, no grants). 001 and 002 are applied. See the rule in `CLAUDE.md`: only run when Sarthak asks in that message, dry run first.

Original steps:
1. Match every item to the catalogue with a script run locally: Open Library work key and cover for books (Google Books when Open Library has nothing), TMDB id and poster for films. Store `ol`, `gb`, `tmdb` and `cover` on each item. List the ones that didn't match for a quick look.
2. Pages: `/lists/` (all lists, grouped: book prizes, Indian book prizes, film awards, classics) and `/lists/<slug>/` (a poster grid with the year on each, save bookmarks and your statuses, the source credited at the bottom).
3. Rows on the front pages: Books gets Booker, Sahitya Akademi Marathi and Marathi classics rows plus chips for every book list; Films gets Oscar Best Picture, National Award Best Marathi Film and Indian cinema classics rows plus chips. The Books filters get a "Prizes and classics" choice that opens a list.
4. Test locally with `npm run dev`, build, commit.

## Step 3, part 4: weekly Marathi and Hindi suggestions

- `src/lib/suggest.ts`: asks Gemini (then Groq) for 20 books; keeps one only if Open Library, then Google Books, then Wikipedia has the same title and the author's surname (an invented book is dropped); up to 10 new per run, published automatically. Books Open Library lacks get our own record (`source = 'Granthalaya lists'`). Table `book_suggestions` (`supabase/changes/003-book-suggestions.sql`, also in `schema.sql`); hidden rows stay so a book never comes back.
- `/api/suggest?lang=mr|hi` needs `Authorization: Bearer <CRON_SECRET>` (Vercel sends it on its own when `CRON_SECRET` is set); `&dry=1` shows what it would add and writes nothing. One cron in `vercel.json` (`/api/suggest`, 04:30 UTC on Mondays and Thursdays); the route picks Marathi on Mondays and Hindi on Thursdays, so the cron path has no query string. `maxDuration` is now 60.
- Shown as two lists, `suggested-marathi` and `suggested-hindi` (`suggestedLists` in `src/lib/lists.ts`): rows on the Books front page (only books with a cover), the "Prizes and classics" filter and chips, and `/books/?list=suggested-marathi`. Admin page: "Suggested books" with Hide / Show again.
- Live steps: 003 applied; first run done by hand on 2026-10-18 (10 books per language). Still to do: add `CRON_SECRET` (any long random text) to Vercel Production. Vercel runs crons only on production deployments, so the weekly job starts after `phase-1` is merged into `main`. Limits checked: 100 crons per project, daily at most on Hobby, functions up to 300 seconds with Fluid Compute (we ask for 60). A dry run on this computer with real Gemini and Open Library found 9 to 10 real books per language.

## Checks and tools

- `npm run check:site` (dev server running): main pages load, every list's links (a sample per list, `-- --full` for all) and covers answer, and with only the public key the database keeps "Only me" entries, private accounts' entries, blocks, reports and hidden suggestions closed. Not covered yet: blocked users (needs a test account signed in as the blocked person).
- `npm run shots -- --fold /books/ ...` takes phone (390px) and desktop pictures into `.shots/` (Playwright, Chromium). In Git Bash start with `MSYS_NO_PATHCONV=1`. The checker agent knows about it.
- Catalogue fetches (`src/lib/catalog/fetch.ts`) now ask once more after a timeout, 429 or 5xx, because a busy TMDB used to turn a title page into a 404.

## Decisions to keep

- TV lives inside Films (Films/TV switch). Book browse: subject, original language, decade, prizes and classics.
- The profile shows the pinned line, else the latest line.
- Loaders: Drawn for pages, Ink for buttons.
- AI models only surface lists and niche books; facts always come from a source.
