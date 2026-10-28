# Rate limits on costly addresses (Vercel firewall)

Why: four kinds of address cost real work (a drawn card takes up to 3 seconds of computer time, search asks TMDB, Open Library and Google Books at once, `/api/cover` copies images). Anyone can ask for them with no limit. The code has a small first fence (`src/lib/ratelimit.ts`, per running copy, refuses with "429 Too many requests"); the real fence is Vercel's firewall, which counts across every copy of the site. You set it up once in the Vercel dashboard.

## Steps (do this once per rule)

1. Open https://vercel.com, pick the **granthalaya** project.
2. In the top tabs choose **Firewall**. Click **Configure**.
3. Under **Custom Rules** click **+ New Rule**.
4. **Name** the rule (for example `Limit search`).
5. Under **Configure**, build the "if" part: choose **Request Path**, the operator **Starts with**, and type the path from the table below. (For the card rule add a second condition with **Or**, as in the table.)
6. Under **Then**, choose the action **Rate Limit**.
7. Set **Fixed Window**, **Time window** and **Request limit** as in the table, and **Keyed by: IP Address**.
8. For what happens past the limit choose **Too Many Requests (429)**. (If it offers "Log" first, you can start with **Log** for a day to see who would be caught, then switch to the 429.)
9. Click **Save Rule**, then **Review Changes** and **Publish** at the top of the page. Rules only count once published.

The labels in the dashboard change now and then; if a name differs, look for the same idea (path, rate limit, window, limit, IP).

## The four rules, and the numbers

| Rule | Path (starts with) | Window | Limit per IP | Why this number |
|---|---|---|---|---|
| Limit search | `/api/search` | 60 seconds | 30 | Typing in the search box asks once every quarter second at most; a person rarely makes 30 searches in a minute. |
| Limit cards | `/og/` **or** `/story/` | 60 seconds | 20 | A person opening the share window draws one or two cards. Link previews fetched by chat apps come from their own addresses. |
| Limit card images of shelves | `/@` and the path **ends with** `.png` (for `story.png` and `year.png`) | 60 seconds | 20 | Same as above. If the dashboard can't combine "starts with" and "ends with", use **Request Path** **Contains** `.png`. |
| Limit covers | `/api/cover` | 60 seconds | 300 | A Marathi or Hindi page shows up to 48 covers at once, each one a request, so this one is higher. |

## If your plan allows only one or two rules

Vercel's free plan limits how many custom rules and rate limits you get. Keep the first and the fourth rule (search is the cheapest to abuse and the most expensive to answer), and combine the card rules into one: **Request Path** **Matches regular expression** `^/(og|story)/|\.png$`, 20 per 60 seconds.

## Also worth doing in the same place

- **Firewall → Attack Challenge Mode** can be switched on for a while if the site is ever hammered.
- Watch the free AI allowance (Gemini and Groq): title pages and added titles ask for card lines, facts and descriptions in the background. If it runs out, those just stay empty until the next day.

## What the code does by itself

`src/lib/ratelimit.ts`: 40 searches, 30 card pictures and 240 cover copies a minute per visitor address, per running copy of the site (a small first fence only). Your own computer (localhost) is never limited.
