# Wording review: technical words on the site (2026-11-11)

Searched all on-page text (buttons, labels, headings, empty states, errors, the legal pages, the data download, link previews) in `src/` for: entry, entries, log, logged, item, record, data, submit, user, content, status. Not covered: the sign-in emails (they live in Supabase → Authentication → Emails, not in this repo), and any text built from pieces in a way the search could not see. Code comments and variable names are left alone; only what people read counts.

## Changed already

| Where | Was | Now |
|---|---|---|
| Shelf details card (`components/shelf/Bookshelf.astro`) | Open the entry | Open |
| Entry page (`library/[slug].astro`) | Open the entry | Open it |
| After saving on Add (`add.astro`) | Open the entry | Open it |
| Entry page, panel heading and label | Your log | Your shelf |
| Title page panel (`LogPanel.astro`) | Your log (label) | Your shelf |
| Title page panel | Your entry \| Read | On your shelf \| Read |
| Title page panel | Log with a review | Save with a review |
| Title page panel (signed out) | Sign in to log, rate or save | Sign in to save, rate or review |
| Entry page | Log a season / Log it on your shelf | Add a season / Add it to your shelf |
| Entry page | Only you can see this entry | Only you can see this |
| Entry page and three-dots menu (`PersonMenu.astro`) | Report this entry | Report this |
| Add page title | Edit entry | Edit |
| Add page, "again" hint | Your first time stays as its own entry. | Your first time stays on your shelf. |
| Reviews list link (`title/Reviews.astro`, read aloud) | Open this review’s entry | Open this review |
| Films and Books page descriptions (link previews) | browse, save and log. | browse, save and review. |
| Empty collection (`collections/[collection].astro`) | …book, essay or entry. | …book or essay. |
| Error from saving (`api/log.ts`) | Couldn’t find that entry. | Couldn’t find that. |
| Settings tab, account menu | Your data | Data |
| Account menu | Sign out | Log out |

## Applied on 2026-11-11 (second round, with Sarthak's decisions)

Status → Progress everywhere people see it (shelf filter and "Any progress", the entry page label, the panel and season labels read aloud, the two messages in `api/log.ts`: "Say where you are with it." and "That doesn’t fit this one."), and in the data download's first row ("Status" → "Progress", "Kind" → "Type"; the Collections sheet's "Kind" → "Type" too, for the same reason). Admin page: "Hide this" and "…has it on their shelf or in a collection". Privacy and Terms: every plain version below, with "data fiduciary" kept and "(the person responsible for your information)" added after it; "Your data is kept in the database…" is now "Your data is kept for as long as you have an account." Kept as they are: "Sexual content" (report reason and Terms) and "Skip to content". Not done: the `supabase/schema.sql:251` message (later item in `docs/plan.md`).

## The list as it was proposed (for the record)

**status** (shown to people)
- `@[username]/index.astro:56`, the shelf's filter: "Status" / "Any status" → "Progress" / "Any progress" (the choices are Want to, Reading, Read…).
- `@[username]/library/[slug].astro:213`, small label above the status: "Status" → "Progress".
- `components/SeasonList.astro:36`, read aloud: "Season 2 status" → "Season 2 progress".
- `api/log.ts:71, 114`: "Pick a status." → "Say where you are with it."
- `api/log.ts:135`: "That status doesn’t fit here." → "That doesn’t fit this one."
- `supabase/schema.sql:251` (needs SQL run, so not touched): "That status doesn't fit a %." → "That doesn't fit a %."
- `api/export.ts:34`, the first row of the download: "Status" → "Progress", "Kind" → "Type".

**log / logged**
- `admin.astro:84` (admin only): "…refused if any member has it logged or in a collection" → "…has it on their shelf or in a collection".
- `admin.astro:56` (admin only): "Hide the entry" → "Hide this".

**entry / entries**
- `privacy.astro:70`: "report any profile, entry or comment" → "report any profile, review or comment".

**content** (the legal pages and one report reason)
- `layouts/Base.astro:183`, report reason: "Sexual content" → "Sexual material".
- `terms.astro:20`: "sexual content involving anyone under 18" → "sexual material involving anyone under 18".
- `terms.astro:40`: "Content or accounts that break these rules can be hidden or removed" → "Anything you post, or any account, that breaks these rules can be hidden or removed".
- `privacy.astro:33, 58`: "hide or remove content or accounts", "they will not carry your content" → "hide or remove posts or accounts", "they will not carry what you wrote".
- `layouts/Base.astro:93`: "Skip to content" (a hidden link for keyboard and screen-reader users) → keep, it is the standard wording, or "Skip to the page".

**data / database / records / logs** (Privacy and Terms; I left "your data" where it matches the Data menu and the "Download your data" button)
- `privacy.astro:16`: "with their status, ratings, dates and notes" → "with where you are in each, ratings, dates and notes".
- `privacy.astro:17`: "Safety records:" → "Safety reports:"; `:18`: "Technical records:" → "Behind the scenes:" and "short-lived server logs" → "short-lived records kept by the services that run the site".
- `privacy.astro:40, 80`: "the database" → "where we keep your information".
- `privacy.astro:10`: "data fiduciary" is the DPDP Act's own term, so it is quoted on purpose; keep it, or add "(the person responsible for your information)".
- `privacy.astro:59`: "Server logs are kept by the services…" → "The services that run the site keep short records for a short time, then throw them away."
- `terms.astro:49`: "keep your data forever" → "keep what you have saved forever".

**user** (no on-page use found; "username" is used in Settings and Welcome and is plain enough), **item**, **submit** (none found on pages).

## Not found or not checkable
- Sign-in and other emails (Supabase dashboard).
- Text that only appears for some people (signed-in toasts built in `layouts/Base.astro`), searched by pattern only; worth a look by hand while signed in.
