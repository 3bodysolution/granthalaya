// Collects essay metadata listed on readsomethinggreat.com into src/data/essays.json.
// Metadata only: title, author, publication, year, link. No essay text.
// Run with: node scripts/essays/collect.mjs
//
// What the site exposes (checked when this was written):
// - robots.txt allows "/" for all agents and blocks /api/, /admin, /account, /auth/, /surprise.
// - sitemap.xml lists only 5 pages (home, support, hall-of-fame, privacy, terms), no essays.
// - No RSS feed and no archive or pagination. The homepage shows the current set of articles
//   (about five cards: title, author, reading time, link to the original essay).
// - The homepage "Snippets" tab is a separate content type and is not collected.
// - The listing has no publication name and no publication date, so those fields are null.

import { writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SITE = "https://www.readsomethinggreat.com";
const UA = "Granthalaya/1.0 (+https://github.com/3bodysolution/granthalaya)";
const DELAY_MS = 2000;

const here = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(here, "../../src/data/essays.json");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url) {
  const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "text/html,text/plain,application/xml" }, redirect: "follow" });
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  return res.text();
}

function decode(s) {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function stripTags(s) {
  return decode(s.replace(/<!--[\s\S]*?-->/g, "").replace(/<[^>]+>/g, " "));
}

function checkRobots(text) {
  // Confirm the homepage is allowed for our agent (wildcard group).
  const lines = text.split(/\r?\n/);
  let applies = false;
  let disallowed = [];
  for (const raw of lines) {
    const line = raw.split("#")[0].trim();
    if (!line) continue;
    const [k, ...rest] = line.split(":");
    const key = k.trim().toLowerCase();
    const val = rest.join(":").trim();
    if (key === "user-agent") applies = val === "*";
    else if (applies && key === "disallow") disallowed.push(val);
  }
  const blocked = disallowed.filter((p) => p && "/".startsWith(p));
  if (blocked.length) throw new Error(`robots.txt disallows / for *: ${blocked.join(", ")}`);
  return disallowed;
}

function parseArticles(html) {
  const items = [];
  const re = /<article class="article-item"[\s\S]*?<\/article>/g;
  let m;
  while ((m = re.exec(html))) {
    const block = m[0];
    const a = /<h2>\s*<a [^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>\s*<\/h2>/.exec(block);
    if (!a) continue;
    const link = decode(a[1]);
    const title = stripTags(a[2]);
    const byline = /<p class="byline">([\s\S]*?)<\/p>/.exec(block);
    let author = null;
    if (byline) {
      // The byline is "Author | minutes minutes": keep the part before the separator.
      const before = byline[1].split(/<span aria-hidden="true">/)[0];
      author = stripTags(before) || null;
    }
    items.push({ title: title || null, author, publication: null, year: null, link });
  }
  return items;
}

async function main() {
  const robots = await get(`${SITE}/robots.txt`);
  const disallowed = checkRobots(robots);
  console.log(`robots.txt ok (disallowed for *: ${disallowed.join(" ")})`);
  await sleep(DELAY_MS);

  const home = await get(`${SITE}/`);
  const parsed = parseArticles(home);
  console.log(`homepage: ${parsed.length} article cards`);

  const seen = new Set();
  const items = [];
  for (const it of parsed) {
    if (!it.link || seen.has(it.link)) continue;
    seen.add(it.link);
    items.push(it);
  }

  const out = {
    source: { name: "Read Something Great", url: "https://readsomethinggreat.com" },
    items,
  };
  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(out, null, 2) + "\n", "utf8");
  console.log(`wrote ${items.length} items to ${OUT}`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
