# Astro upgrade plan (planned 2026-10-30, not started)

Astro 5 → 7, @astrojs/vercel 8 → 11, sharp 0.34.5 → 0.35.5. Planned with Opus; build with Sonnet on a branch `upgrade-astro`, one commit per step.

**Sarthak's changes to the plan (2026-10-30, these win over anything below):**
1. Don't push the `upgrade-astro` branch for a preview: its new address isn't in Supabase's redirect list or Turnstile's domains, so sign-in would fail there. Do all checks on localhost, merge into `phase-1` locally with `--no-ff`, and when Sarthak says, push `phase-1` and test on the existing phase-1 preview. If something breaks there, revert the merge commit.
2. Stop after step 3 (Astro 6) and report to Sarthak before starting step 4 (Astro 7).

## Context

npm audit reports 1 critical, 7 high, 2 moderate and 1 low warning, all inside astro 5.18.2, @astrojs/vercel 8.2.11, sharp 0.34.5 and the packages they bring in (test report §3, "Dependency upgrades"; plan.md lists npm audit before Go live). None looked reachable as the site is set up, but they have to be cleared before going live. The fix is three upgrades. They're done on a separate branch, one major version at a time, and merged into phase-1 only when every check passes.

Targets (npm, 2026-10-30): astro 7.4.4, @astrojs/vercel 11.0.17 (needs astro ^7), sharp 0.35.5, @starwind-ui/astro 1.4.0. @astrojs/rss 4.0.19 is already the latest.

## What the site uses, and what the upgrades change for it

The site uses fewer Astro features than most, so a lot of the guide doesn't touch it. Not affected: content collections (none; src/content/ is only read by scripts/migrate.mjs with js-yaml), Astro.glob, astro:assets/<Image> (none), astro:env, i18n, actions, sessions, define:vars, Markdown plugins (reviews use our own md()), Zod (not used by the site), src/fetch.ts (doesn't exist; the reserved name only applies at the root of src/, so src/lib/catalog/fetch.ts is fine), adapter subpath imports (only @astrojs/vercel itself is imported), prefetch() with with (never called), experimental flags (none).

Affected, or needs checking:

- **Node** (6, 7): Astro 7.4.x needs Node ≥ 22.23.4. Here: This computer runs 24.19 (fine). Vercel built on nodejs22.x last time and nothing pins it. Pin "engines": { "node": "24.x" } in package.json, so only deployments of this branch change (production keeps its own setting until the merge).
- **Vite** (6 → 7 → 8): Astro 6 uses Vite 7, Astro 7 uses Vite 8 (Rolldown). Here: @tailwindcss/vite 4.3.3 must allow that Vite version (npm view @tailwindcss/vite peerDependencies at each step; upgrade it if not). astro.config.mjs imports loadEnv from vite for the env-for-dev integration, so check it still works. import.meta.glob(..., { query:  '?inline' }) in src/lib/cards/backgrounds.ts:13, and the ?inline font imports in src/lib/cards/story.ts:33-40, have to work under Rolldown.
- **import.meta.env** (6): Always inlined. Private variables no longer appear in process.env through Astro. Here: The site already reads every secret from process.env via env() (src/lib/supabase.ts:13), and env-for-dev fills it on this computer. The only import.meta.env read is DEV in src/lib/turnstile.ts:8 (still a real boolean). Check: Turnstile test keys on localhost only, and the build output holds no key (grep .vercel/output for sb_secret/SUPABASE_SECRET).
- **Script and style order** (6): Rendered in source order. Here: Base.astro has many <script>s plus the is:inline theme script, and starwind.css alongside global.css. Check that the dark mode toggle, toast and log panel still work, and that global.css still wins over Tailwind (look for changed button and chip styles in the screenshots).
- **Astro.url.pathname** (6): May be partly decoded. Here: Middleware routing goes through ctx.url.pathname (src/middleware.ts:10,38,60,91): brokenAddress, rate limits, old-address redirects and the /welcome?next= redirect. Test /@sarthak/..., %40 addresses, Devanagari book slugs, /library/x → /@sarthak/library/x, and an encoded slash (%2F) still being refused.
- **Endpoints with extensions** (6): Must be linked without a trailing slash. Here: rss.xml, *.png cards and year.png. A grep found no links to them with a slash, but check that /rss.xml → /@sarthak/rss.xml still redirects and returns XML.
- **Images** (6): The default image service crops and won't upscale. Here: Not used (no <Image>; sharp is called directly in src/lib/cards/trim.ts, output.ts). The adapter still adds a /_image route, so compare the route list before and after.
- **Adapter API** (6): setAdapter entrypoint changes. Here: Handled inside @astrojs/vercel 10/11. Nothing for us to do.
- **HTML compression** (7): compressHTML defaults to 'jsx'. Here: It can remove spaces between inline elements, e.g. "by Author", chips, star rows and the footer line. Set compressHTML: true in astro.config.mjs to keep today's output. Trying 'jsx' can be a later, separate change.
- **Middleware errors** (7): Now render our 500.astro. Here: 500.astro → Base.astro reads Astro.locals.me (line 31). If the middleware itself throws, locals is empty. Check that Base and the components it includes don't use locals.supabase or locals.user unguarded, so the 500 page can't crash too. Force a middleware error locally once to see it.
- **security.checkOrigin** (7.0.6 / 7.3.7): Now applied the same way to every endpoint. Here: Every POST under src/pages/api/ (log, review, collection, block, report, profile, welcome, username, account, admin, share, title) is called from our own pages, so it should pass. src/lib/http.ts:31 does its own Origin check too. Both cron routes are GET. Test each POST once. Also test from a *.vercel.app preview, since allowedDomains decides the origin there.
- **View transitions** (7): astro:transitions internals removed (TRANSITION_*, isTransition*Event). Here: Only ClientRouter, navigate and plain event names (astro:page-load, astro:after-swap, astro:before-preparation) are used. These stay. Test page changes and the transition:name cover animation.
- **Dev toolbar** (6, 7): Nothing in the guides affects us (part unverified). Here: Check npm run dev starts and the toolbar doesn't cover the bottom bar on a phone screenshot. If it does, add devToolbar: { enabled: false } (dev only).
- **Prefetch** (6, 7): prefetchAll + defaultStrategy: 'hover' unchanged. Here: Check links still prefetch on hover (Network tab) and that data-astro-prefetch="false" links (sign-in, sign-out, log panel) don't.
- **Redirects** (all): No redirects config. All redirects are Astro.redirect/ctx.redirect/Astro.rewrite('/404'). Here: Covered by the tests below.
- **sharp** (0.35): engines node ≥ 20.9. Changelog for breaking changes not yet read (fetch failed). Here: Read the 0.35.0 entry before step 1. Used by /api/cover (trimFrame), card PNGs (output.ts) and two scripts. Vercel must still bundle the Linux binary (@img/sharp-linux-x64 in the lockfile).
- **@vercel/functions waitUntil** (10, 11): Not mentioned. Here: Used in covers.ts, tagline.ts, titles.ts, each in a try/catch. Check that trivia facts and warm covers still arrive after a save on the preview.
- **maxDuration** (10, 11): Not mentioned in the changelogs (unverified). Here: Check that .vercel/output/functions/_render.func/.vc-config.json still says maxDuration: 60.

## Files that will change

- package.json / package-lock.json: versions; allowScripts (sharp@0.34.5 → sharp@0.35.5, and the esbuild versions the new Vite/adapter bring); engines.node.
- astro.config.mjs: compressHTML: true (step 3). Maybe devToolbar. Also correct the old comment saying About/Privacy/Terms are built ahead of time (all three set prerender = false).
- Only if a check fails: src/middleware.ts (pathname decoding), src/layouts/Base.astro (script order, or a guard for a 500 page with empty locals), src/lib/cards/backgrounds.ts / story.ts (?inline imports under Rolldown).
- @starwind-ui/astro → 1.4.0 if its peer range blocks Astro 6/7. (Its components aren't used by any page, only starwind.css. If 1.4.0 still blocks, remove the package and keep the CSS.)
- CLAUDE.md ("Astro 5" → "Astro 7"), docs/plan.md (progress), private/test-report.md §3 (mark it done).

## Order (on a branch, one step per commit)

Step 0. Branch and baseline. git switch -c upgrade-astro from phase-1. Save, in the scratchpad:
- npm audit output
- .vercel/output/config.json route list
- npm run build time
- npm run check:site result (with npm run dev running)
- before screenshots: npm run shots (desktop and phone) and scripts/shots-share.mjs, plus node scripts/card-sheet.mjs for the card PNGs

Step 1. sharp 0.35.5 alone (still on Astro 5; Astro may keep its own nested 0.34 until step 3). Read the 0.35.0 changelog first. Update allowScripts. Check: build, check:site, /api/cover on a shop cover with &t=1 (trim), an OG card, a story card, year.png, card sheet compared with before. Commit.

Step 2. Node pin. Add engines.node: "24.x". Build, commit.

Step 3. Astro 6 + @astrojs/vercel 10 (+ Starwind and @tailwindcss/vite if their peers need it). npm i astro@^6 @astrojs/vercel@^10. Fix whatever the build reports, then run the step 3/4 checks below. Build, check:site, screenshots compared with before. Commit.

Step 4. Astro 7 + @astrojs/vercel 11. npm i astro@^7 @astrojs/vercel@^11. Add compressHTML: true. Same checks, plus the 500 page and every POST. Commit.

Step 5. Tidy. npm audit should show 0 for these packages (if anything is left, npm ls <pkg> shows who brings it in). npm dedupe, final allowScripts, docs. Build, check:site. Commit.

After every step: npm run build and npm run check:site (dev server running). If a step fails and the fix isn't clear, stop and report rather than pile changes into the same step.

## How to prove nothing broke

On npm run dev, then again on a Vercel preview of the branch. Pushing the branch to make that preview needs Sarthak's yes at the time. The preview sits behind Vercel's login, so the signed-in checks are his or use a protection bypass he sets up. Signing in with a test account needs asking first.

1. Automatic: npm run check:site (pages load, list tiles and covers, privacy with the anon key, hidden columns). npm run time compared with the baseline (no big slowdowns).
2. Sign-in: Google button → /auth/callback → back to the page you started on (next). A new account goes to /welcome (Turnstile test keys on localhost). Sign out (origin check). On the preview, check that the return address is the preview's own (proves allowedDomains still works).
3. Cards and covers: /api/cover (TMDB, Open Library, shop cover with trim, Cache-Control kept); /og/...png; /story/...png; /@x/library/<slug>/story.png; /@x/year.png; card sheet looks the same as before.
4. Share window: open it on a title and on your own entry (data-share-early), with no "Couldn't draw the card" message; scripts/shots-share.mjs compared with before.
5. Filters and lists: /films/, /films/?kind=tv, /books/ front pages (rows, arrows, the large Popular row); grids with genre, decade (YearStrip), language (?language=mar shop books first), service, sort; Author filter search; /lists/<slug>; essays and ?theme=.
6. Search: ⌘K and /: own shelf, films/TV, books, people, members; the rate limit still answers 429 when hammered.
7. Reviews: title page reviews (md()), like, comment, delete a comment, spoiler switch, /@x/reviews/.
8. Logging: save, rate, note, tagline, status, add to collection, remove (asks first), the toast, TV season picker, a first save of a title not in the catalogue (hit), and trivia arriving later (waitUntil).
9. Settings: all four tabs (#privacy in the address), photo, links, favourites, blocked list, export zip downloads and opens, username change.
10. Admin: /admin as admin (reports, shop hiding); as a non-admin it rewrites to 404.
11. RSS: /@sarthak/rss.xml is valid XML; /rss.xml gives a 301.
12. Short links: /b/, /c/, /f/, /t/ redirect to the right title pages; old addresses (/library/x, /threads, /lines/) redirect.
13. Cron routes: GET /api/keepalive → 200; GET /api/suggest with no token → 404 (with the token only if Sarthak wants a real run, since it calls Gemini). vercel.json is unchanged; the crons only run on production, so check them again after Go live.
14. Error pages: an unknown address → painted 404; a forced error in a page and one in the middleware → painted 500, status 500.
15. Navigation: view transitions between pages, cover transition:name, dark mode toggle survives navigation, prefetch on hover, reduced motion holds still.
16. Build output: the route list matches the baseline; maxDuration: 60; region bom1; no secrets in .vercel/output; the Node runtime is the pinned one.
17. Screenshots: npm run shots desktop and phone after steps 3 and 4, compared with the baseline (spacing changes would show compressHTML or CSS order problems). Hand the phone and desktop sets to Sarthak before the merge. Page-by-page checks go to the checker agent so the main conversation stays small.

## What could go wrong, and rolling back

- Vercel's Node 22 is older than 22.23.4, so the build fails. The 24.x pin in step 2 avoids this.
- The Tailwind/Starwind peer ranges don't allow Vite 7/8 → upgrade them; if Starwind still blocks, remove the unused package.
- sharp or resvg native files are missing from the function on Vercel (cards and covers 500 on the preview but work locally) → check the bundled files in .vercel/output/functions/_render.func; the adapter's includeFiles option is the fix.
- Rolldown changes ?inline imports (cards lose fonts or backgrounds) → switch to ?url + fs.readFile, or a vite.assetsInclude tweak.
- Spacing changes from compression or CSS order → compressHTML: true; adjust the order in Base.astro.
- Sign-in or saving fails on the preview (origin) → check allowedDomains / checkOrigin behaviour on 7.x.
- Rollback: all work stays on upgrade-astro, and phase-1 isn't touched until every check passes and Sarthak has seen the screenshots. Any step can be undone with git reset to the step before (it's our branch), or dropped entirely. After the merge into phase-1, git revert -m 1 <merge> undoes it in one commit. Once on main, Vercel's "Instant rollback" to the previous deployment is the fast way back. No database change is involved, so nothing in Supabase needs undoing.
- Merge with git merge --no-ff upgrade-astro into phase-1 (one revertable commit). Push only when Sarthak says so.
