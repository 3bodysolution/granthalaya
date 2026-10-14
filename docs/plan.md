# Plan and progress

Read this at the start of a session; update it when a part is done.

## Phase 2

- [x] Step 1. Tidy-ups (Collections, pinned line, settings in tabs, export).
- [x] Step 2. Title pages for films, TV, books, people and authors; lists with filters; search; collections you can make.
- [ ] Step 3. Discovery, in four parts:
  - [x] Part 1. Films, TV and Books front pages (rows of posters, browse chips) and the discovery-first home page.
  - [ ] Part 2. Prize and classics lists (details below).
  - [ ] Part 3. About 50 to 60 essays chosen from readsomethinggreat.com, credited, each linking to the original.
  - [ ] Part 4. Marathi and Hindi book lists suggested by a free AI model each week, every book checked against Open Library, Google Books or Wikipedia, with an admin "hide".
- [ ] Step 4. Import from Goodreads, Letterboxd or our own export zip.
- [ ] Go live: re-run `npm run migrate`, merge `phase-1` into `main`, add the environment variables to Production in Vercel. Before that: `site.contact`, read Privacy and Terms again, Google branding links and publish the Google app, `npm audit`.

## Step 3, part 2: prize and classics lists

Each list is a JSON file in `src/data/lists/<slug>.json`:
`{ slug, title, kind: "book" | "film", intro, source: { name, url }, items: [{ year, title, creator, original_title?, language?, note?, pick?, release_year?, circa? }] }`.
Items are newest first for prizes, oldest first for classics. `pick: true` means we chose the book (Nobel, Jnanpith), not the prize. `circa: true` marks an approximate year (shown as "c. 1290").
`language` is an ISO 639-1 code (`mr`, `hi`, `en`); where a language has no 639-1 code, the 639-3 one (`kok`, `bry`). A film in several languages gets the first one listed, and English is left out on films. The classics lists use `source: { "name": "Chosen by Granthalaya", "url": "" }`.

Done (researched, checked against official sites):
- `booker` (1969 to 2025), `international-booker` (2016 to 2026), `pulitzer-fiction` (1960 to 2026), `nobel-literature` (1980 to 2026, one book per laureate).

Still to gather (use the `fetcher` agent or a script; Wikidata or the Wikipedia API, not page by page):
- Indian book prizes: `sahitya-akademi-marathi`, `sahitya-akademi-hindi` (titles in Latin letters plus Devanagari), `jnanpith` (one book per laureate).
- Film awards: `oscar-best-picture`, `palme-dor` (from 1955), `national-best-feature`, `national-best-marathi` (each film with its `release_year` for matching).
- Classics, chosen by us, about 30 to 40 each: `marathi-classics`, `hindi-classics`, `world-classics`, `indian-cinema-classics`. Well-known works only; a factual note of up to 12 words each.

Done: the lists are gathered and matched (`docs/unmatched.md` lists the doubtful ones), `/lists/` and `/lists/<slug>/` exist (`src/lib/lists.ts`), and the Books and Films front pages have the list rows and a "Prizes and classics" chip set. Still to do: the "Prizes and classics" choice in the Books filters, and a quick look at `docs/unmatched.md`.

Original steps:
1. Match every item to the catalogue with a script run locally: Open Library work key and cover for books (Google Books when Open Library has nothing), TMDB id and poster for films. Store `ol`, `gb`, `tmdb` and `cover` on each item. List the ones that didn't match for a quick look.
2. Pages: `/lists/` (all lists, grouped: book prizes, Indian book prizes, film awards, classics) and `/lists/<slug>/` (a poster grid with the year on each, save bookmarks and your statuses, the source credited at the bottom).
3. Rows on the front pages: Books gets Booker, Sahitya Akademi Marathi and Marathi classics rows plus chips for every book list; Films gets Oscar Best Picture, National Award Best Marathi Film and Indian cinema classics rows plus chips. The Books filters get a "Prizes and classics" choice that opens a list.
4. Test locally with `npm run dev`, build, commit.

## Decisions to keep

- TV lives inside Films (Films/TV switch). Book browse: subject, original language, decade, prizes and classics.
- The profile shows the pinned line, else the latest line.
- Loaders: Drawn for pages, Ink for buttons.
- AI models only surface lists and niche books; facts always come from a source.
