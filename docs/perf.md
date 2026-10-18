# Page speed

Plan and numbers for "pages take seconds to load" (Batch 2, item 2).

## How to measure

- **On the Vercel preview (the real server numbers):** open the page, then the browser's DevTools → Network → click the first row (the page itself) → Timing tab. The `Server-Timing` header lists every call the server waited for: `tmdb`, `ol` (Open Library), `gb` (Google Books) with the address and "memory" when the answer came from the server's own memory, and `db` with the table name. `total` is the server's whole time. The `x-vercel-id` response header should contain `bom1`. Not sent on the live site (`VERCEL_ENV=production`). Cold = first visit after a new deploy or a quiet spell; warm = a reload straight after.
- **On this computer:** `npm run dev`, then `npm run time` (signed out). Three visits per page (cold, warm, warm), then the images on the page with sizes. Dev mode adds its own overhead, so the images and the catalogue call times are the useful part; the real server numbers come from the preview.

## Local readings (dev, signed out, 2026-10-18)

| Page | Cold | Warm | Images at once | Images lazy |
|---|---|---|---|---|
| Home | 2.6 s | 0.13 s | 387 KB | 4.2 MB (footer valley both themes, rows) |
| Films | 0.9 s | 0.04 to 0.5 s | 0 KB | 10.3 MB, 164 images |
| Books | 3.6 s | 0.1 to 0.2 s | 0 KB | 2.1 MB reported, 76 covers with no reported size |
| A film (Inception) | 1.0 s | 0.08 to 0.15 s | 312 KB (backdrop 206 KB) | 1.7 MB |

Things seen:
- Cold is the catalogue: Home waits on 4 lookups, Books on 2 Open Library searches that took 1.8 s and 2.8 s one after the other, Films had a lookup fail twice (`watch/providers/movie`) and one `discover/movie` that failed twice.
- Warm pages are fast only because the server remembers answers. On Vercel that memory is per copy of the function, so a visit is often "cold".
- Films posters in rows are 135 to 160 KB each (`w500`, from the prize and classics list rows), where the catalogue rows use `w342`.
- Open Library covers don't report a size, so the Books image total is higher than shown. Check the real transfer size in the browser's Network tab.

## Preview readings (fill in from the browser)

| Page | Cold: total | Slowest call | Warm: total | Slowest call |
|---|---|---|---|---|
| Home | | | | |
| Films | | | | |
| Books | | | | |
| A film | | | | |

## Fixes, in order of expected impact

1. **Shared catalogue memory, refreshed in the background.** Serve an old answer at once and refresh it afterwards (`waitUntil`). Store: a Supabase table `catalog_cache (key, value jsonb, fetched_at, read_at)`, only `adminClient` reads and writes it, row level security on with no grants to visitors. Expected 1.5 to 4 s off front pages, 0.3 to 1 s off film pages.
   - **The table must not grow without limit** (the free database has a size cap).
     - Keep entries small: store only what the page uses (the cards and fields already turned into our own shapes), not whole TMDB or Open Library answers; skip big ones (a person's whole credit list, full search pages); cap an entry at about 50 KB.
     - Clean up automatically: a daily job (the existing cron in `vercel.json`, a new `/api/...` call, or a database `pg_cron` job) deletes rows with `read_at` older than 30 days, and rows past a hard cap on the count (say the oldest 5,000 beyond that). `read_at` is updated at most once a day per row so reads stay cheap.
     - Key by address only (no visitor data), so nothing private lands in it.
2. **Time budget, no retry after a timeout.** Rows get about 2.5 s; a row that isn't back is left out (or shown from the old copy). Only 429 and 5xx are retried.
3. **Send the page before the rows arrive.** Rows wait inside their own component, so the header, painting and title go first. Start the Books `suggestedLists` lookup alongside the rows.
4. **Smaller images.** Open Library `-M` covers (with `-L` for sharp screens), TMDB `w185` posters (with `w342`), film page backdrop `w780` on phones. Paintings stay as they are.
5. **Prefetch that is reused** (only if the preview shows each hovered page being made twice).
6. **Fewer database trips in a row** on film pages (`plainOf` and `bareOf` together); check whether the sign-in check shows as a network call (`db` with `auth`) and, if so, switch to the project's new signing keys.
7. **Cold starts:** check Fluid compute is on for the project in Vercel.
