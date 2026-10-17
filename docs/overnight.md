# Overnight, 18 October 2026

What I did, what went wrong, and what needs you. Plain words.

## What I did

1. **Vercel limits (Part 4).** Checked against Vercel's own pages. We're within them: 100 cron jobs per project, at most once a day on the free plan, functions allowed up to 300 seconds (we ask for 60). So I did not fold anything into the keepalive cron. I did make one change: the two weekly jobs are now one cron (`/api/suggest`, 04:30 UTC on Mondays and Thursdays) and the page picks Marathi on Mondays and Hindi on Thursdays. I couldn't confirm that Vercel allows `?lang=mr` in a cron address, so this way doesn't depend on it.
2. **First suggestion run (Part 4).** Ran for real on this computer with a throwaway secret that only existed on the command line. Marathi: 20 named by the model, 10 added, 6 dropped for not being found. Hindi: 20 named, 10 added, 6 dropped.
   - Marathi added: Kosala, Mrityunjay, Yayati, Shyamchi Aai, Smritichitre, Fakira, Panipat, Golpitha, Shriman Yogi, Rau.
   - Hindi added: Godaan, Maila Anchal, Shekhar: Ek Jivani, Chitralekha, Parinde, Rashmirathi, Zindaginama, Raag Darbari, Tamas, Adhe Adhure.
   - Both lists show on the Books page and in its filter.
3. **Part 3 leftovers.**
   - The 7 links that refused the script all exist (confirmed by search). They are marked "exists" in the list so the checker leaves them alone.
   - The 17 uncertain years were checked against sources. Six were corrected or sharpened: Stevenson's two essays, Saki's The Open Window (1911, not 1914), Twain, Pater and Wilde (publication names). Idgah has no year now, because sources disagree (1933 or 1938).
   - Premchand's "Idgah" and "Sahitya ka Uddeshya" now link to the Hindi originals on Hindi Wikisource, not a translation.
4. **Playwright.** Installed (dev dependency, Chromium only). `npm run shots -- --fold /books/ ...` takes phone and desktop pictures into `.shots/`. The checker agent's notes mention it.
5. **`npm run check:site`.** Checks the main pages, every list's links (a sample of 6 per list; `-- --full` for all) and covers, and, with only the public key, that private things stay private. Last run: all good.
6. **Screenshots.** Home, Films, Books, the Booker list, a Marathi book page (Rau) and the Essays page, phone and desktop. I found no clear layout problems, so I changed nothing.
7. Updated `docs/plan.md` (parts 3 and 4 ticked), wrote this file, pushed `phase-1`.

## What went wrong (and what I did about it)

- `check:site` first reported 5 failures. They were not real: a busy TMDB made some film pages answer 404 when the script asked several at once. That is also a real weakness, because a slow TMDB would show a visitor a "not found" page. I made the catalogue fetches ask once more after a timeout or a "busy" answer. A true "not found" is still not retried. After that the check passed.
- A scripted edit to the admin page half-applied at first (the files use Windows line endings). I caught it in the diff and redid it.

## What needs you

1. **`CRON_SECRET` in Vercel (Production).** Without it the weekly job refuses to run. I haven't touched `.env` or any keys.
2. **Cron only runs on production.** The weekly suggestions won't run on the preview. They start after `phase-1` is merged into `main`. The lists are filled by hand until then.
3. **Blocked users are not tested.** That needs a test account signed in as the blocked person. Only one private account exists, so the private-account checks ran against that one only.
4. **Decisions for you (taste, left alone):**
   - "Marathi books to try" repeats books already in "Marathi classics" (Mrityunjay, Smritichitre). Two rows with the same books looks thin.
   - The Essays page is one long list of 91 with no filter or search. It's fine to scroll, but it may want a theme jump or search later.
   - Some old Marathi and Hindi records have only a painted cover, so the rows show fewer books than the lists hold. That's by design (rows need a cover).
5. Phone screenshots show the bottom bar sitting over the middle of the page. That is how full-page pictures capture a fixed bar, not a bug.

## Not done, by your rules

No `db:apply`, nothing in `.env`, no change to `main`, nothing deleted.
