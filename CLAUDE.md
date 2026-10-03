# Granthalaya — notes for Claude Code

Sarthak's personal library of books, films and essays, painted in Pune. Built with Astro 5 (static pages) plus a few Vercel functions under `src/pages/api/` for the in-site Add screen. Hosted on Vercel; every push to `main` deploys.

## First-time setup (do this once, then delete this section)

Do these in order, asking before each command:

1. **Remove old, unused footer images:**
   - `public/img/valley-day.webp`
   - `public/img/valley-night.webp`
   - `public/img/valley-depth.webp`
   - `public/img/valley-motion-day.webp`
   - `public/img/valley-motion-night.webp`
2. **Check the tools.** Make sure Node.js (LTS) and Git are installed. If either is missing, help Sarthak install it with `winget`.
3. **Check the build.** Run `npm install`, then `npm run build`. It must finish with "Complete!".
4. **Make the first commit.** Run `git init -b main`, set the git user name and email if they aren't set, then commit everything with the message "Granthalaya: first version".
5. **Put it on GitHub.**
   - Install the GitHub CLI with `winget install GitHub.cli` if it's missing.
   - Run `gh auth login`, choosing GitHub.com → HTTPS → Login with a web browser.
   - Create a **public** repository called `granthalaya` and push:
     `gh repo create granthalaya --public --source . --push`
6. **Show the repository link,** then tell Sarthak the next step is importing it into Vercel.

Never ask for or handle passwords or tokens in the chat. GitHub sign-in happens in the browser.

## How the project is organised

- `src/content/library/*.md` holds one file per book, film or essay. The fields are in `src/content.config.ts` and the README has examples. The file name is the URL.
- `src/content/threads/*.md` holds the threads, hand-picked paths through the library.
- `src/data/site.ts` holds the name, season line, line of the week, reading pace and yearly goal.
- `src/pages/` holds the pages: home, library, entry pages, notes, threads, stats, about, add, rss, search.
- `src/components/Valley.astro` is the footer painting. It is four solid layers (`public/img/valley-{day,night}-{0..3}.webp`) that slide a few pixels with the cursor, plus a canvas for the flag, waterfalls, river glints, a falling banyan leaf and Pune rain.
- `src/styles/global.css` holds the design tokens for light and dark (`html[data-theme]`).

## Rules Sarthak cares about

- **Never change the colours or quality of the footer paintings.** No filters, glows or overlays that tint them.
- Motion stays subtle and slow, and nothing bends or warps the painting. Always respect `prefers-reduced-motion`.
- Keep the layout symmetrical and calm. No handwriting, tape or "moodboard" decoration.
- Keep explanations plain and non-technical.

## Commands

- `npm run dev` starts a local preview at http://localhost:4321. The Add screen needs the Vercel environment variables, so it only works on the live site.
- `npm run build` builds the site. Run it before every commit.
