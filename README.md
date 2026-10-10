# Granthalaya

A shelf for everything you read and watch: books, films, TV seasons and essays, in hand-painted scenes. Anyone can sign in with Google, keep a shelf, and have a public (or private) profile at `/@username`.

Built with [Astro](https://astro.build), hosted on Vercel, with the shelves in a [Supabase](https://supabase.com) database. Everything runs on free plans.

## Using it

- **Sign in** with Google, pick a username, and you land on your home page.
- **Add** (the button in the header): pick Book, Film, TV or Essay, search or paste a link (Goodreads, Letterboxd, IMDb, Substack, any article), choose a status tag, rate it, write a few lines, save. It's on your shelf straight away.
- **Status tags** instead of pages or percent:
  - Books: Want to read · Reading · Read · Paused · Didn't finish
  - Films: Want to watch · Watched · Didn't finish
  - TV seasons: Want to watch · Watching · Watched · Paused · Dropped
  - Essays: Saved for later · Read
- **Again** logs a re-read or re-watch as a new visit. **Only me** hides one entry from everyone else.
- **Lines:** save the lines that stayed with you when you log something. Pin one to your profile from the entry or the Lines page.
- **Settings** has four tabs: Profile (photo, name, username, bio, favourites, links), Privacy (private account, feature my shelf, blocked people), Your data (download everything as a zip of spreadsheets) and Account (delete it).

## Addresses

| Address | What it is |
| --- | --- |
| `/` | Welcome page when signed out; your home when signed in |
| `/@username` | A profile |
| `/@username/library`, `/diary`, `/collections`, `/stats` | The parts of a shelf (the tabs) |
| `/@username/lines` | Every line saved on a shelf |
| `/@username/library/<title>` | One entry |
| `/add`, `/settings` | Adding things; your settings |
| `/admin` | Reports (only for accounts with `is_admin` set in the database) |
| `/privacy`, `/terms`, `/about` | The fine print |

Old addresses like `/library/paterson` redirect to `/@sarthak/library/paterson`, and the old Threads and Notes pages redirect to Collections and Lines.

## Setting it up

1. **Database:** in Supabase, open SQL Editor → New query, paste all of `supabase/schema.sql`, and Run. It creates the tables and the privacy rules. (An existing database instead gets the files in `supabase/changes/`, in order.)
2. **Sign-in:** Supabase → Authentication → Sign In / Providers → Google, with a client ID and secret from Google Cloud. Add your site's address under Authentication → URL Configuration.
3. **Environment variables** (Vercel → Settings → Environment Variables, and the `.env` file for scripts). See `.env.example` for the list.
4. **Make yourself admin** (for the reports page): in SQL Editor, `update profiles set is_admin = true where username = 'sarthak';`

## Scripts

- `npm run dev` starts a local copy at http://localhost:4321 (it needs the Supabase values in `.env`).
- `npm run build` builds the site. Run it before every commit.
- `npm run migrate` copies the old markdown library (`src/content/`) onto the `sarthak` shelf. Safe to run again: it replaces that shelf with the files' version.
- `npm run trivia` fills in "Behind the film" facts for titles that don't have them yet.
