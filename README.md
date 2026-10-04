# Granthalaya

A personal library of books, films and essays, painted in Pune. It's built with [Astro](https://astro.build) and hosted free on Vercel.

## Adding from the site (the easy way)

Go to **/add** on your site (or click **Sign in** in the footer). Once you're signed in, an **Add** button sits in the header on every page.

1. Pick Book, Film or Essay, then search a title or paste a link (Goodreads, Letterboxd, Substack, any article).
2. Rate it, write a line, pick threads, save.
3. It appears on the site about a minute later.

"Finish something from Now" updates a book you're reading or a film you're watching.

### One-time setup in Vercel

In Vercel, open your project, then **Settings → Environment Variables**, and add:

| Name | Value |
| --- | --- |
| `ADMIN_PASSWORD` | A long password only you know |
| `GITHUB_REPO` | `your-username/granthalaya` |
| `GITHUB_TOKEN` | A fine-grained GitHub token (github.com → Settings → Developer settings → Fine-grained tokens). Give it access to **only** the granthalaya repository, with **Contents: Read and write**. |
| `TMDB_API_KEY` | Optional, for better film search |

Then click **Redeploy** once. The token stays on Vercel's servers and is never sent to the browser.

## Adding by hand

You can also add one Markdown file to `src/content/library/`. The file name becomes the web address, so `perfect-days.md` is served at `/library/perfect-days/`.

### A book

```md
---
title: "Walden"
type: "book"
creator: "Henry David Thoreau"
year: 1854
date: "2026-09-29"        # the day you finished it
rating: 4.5                # 0–5, halves allowed
pages: 352                 # used to work out reading time
highlights:
  - text: "Time is but the stream I go a-fishing in."
    where: "Chapter 2"
    note: "My thought about it (optional)"
---

What you thought. The first paragraph is shown large, with a painted drop cap.
```

### A film

```md
---
title: "Perfect Days"
type: "film"
creator: "Wim Wenders"     # the director
year: 2023
date: "2026-09-27"         # the day you watched it
rating: 5
runtime: 124               # minutes
where: "at home"           # printed on the ticket stub
---
```

### An essay, Substack post or article

```md
---
title: "How to Do Great Work"
type: "essay"
creator: "Paul Graham"
source: "paulgraham.com"   # or "Substack", a magazine…
date: "2026-09-23"
loved: true                # a heart instead of stars
words: 11000               # used to work out reading time
link: "https://paulgraham.com/greatwork.html"
---

Why you saved it.
```

### Optional fields for any entry

| Field | What it does |
| --- | --- |
| `status: "reading"` + `progress: 62` | Shows the entry under **Now** on the home page, with a progress bar |
| `status: "watching"` | Shows a film under **Now** |
| `times: 2` | How many times you've read or watched it |
| `startHere: 1` + `startWhy: "…"` | Adds it to **Start here** on the home page (1–5) |
| `color: "#2F4A5C"` | Chooses the painted cover colour yourself |
| `private: true` | Keeps the entry off the site |
| `highlights` with `mine: true` | A line you wrote, rather than a quote |

## Covers

Books and films show their real cover or poster when there is one, and a painted cover otherwise. Essays always use their own card.

- **Things you add from the site** pick up a cover automatically when you choose a search result.
- **To fetch covers for everything else,** ask Claude Code to run `npm run covers`. It saves them in `public/covers/`. Film posters need a free TMDB key in a `.env` file (`TMDB_API_KEY=...`); without one, films keep their painted covers.
- **Wrong cover?** Put your own image at `public/covers/<file name>.jpg`, or add `cover: painted` to that entry to keep the painted one.
- **Painted covers everywhere:** set `covers: 'painted'` in `src/data/site.ts`.

## Threads

A thread is a hand-picked path through the library. Each one is a file in `src/content/threads/`. The `slug` of each item is the file name of the entry, without `.md`.

```md
---
title: "On slowness"
order: 1
items:
  - slug: perfect-days
    why: "Start here."
  - slug: walden
    why: "The original case for doing less."
---

One or two sentences about the thread.
```

## Site settings

`src/data/site.ts` holds your name, the season line, the line of the week, your reading pace and your yearly goal.

## Running it on your computer (optional)

```sh
npm install
npm run dev      # opens at http://localhost:4321
```

## Publishing

When you change a file on GitHub, Vercel rebuilds the site by itself within about a minute.
