// Checks the four film prize lists against their Wikipedia pages.
// Usage: node scripts/check-film-lists.mjs
// For each list: counts items, looks for duplicate and missing years, checks that every
// title and creator appears in the Wikipedia source, and prints a random sample of 6 items.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const UA = "Granthalaya/1.0 (+https://github.com/3bodysolution/granthalaya)";

const FILES = [
  ["oscar-best-picture.json", "Academy Award for Best Picture"],
  ["palme-dor.json", "Palme d'Or"],
  ["national-best-feature.json", "National Film Award for Best Feature Film"],
  ["national-best-marathi.json", "National Film Award for Best Marathi Feature Film"],
];

async function source(title) {
  const url = new URL("https://en.wikipedia.org/w/api.php");
  url.search = new URLSearchParams({ action: "parse", page: title, prop: "wikitext", redirects: "1", format: "json", formatversion: "2" }).toString();
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${title}`);
  return (await res.json()).parse.wikitext;
}

// Source text has wiki markup, so compare on the bare words of each value.
function appears(src, value) {
  const words = value.split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 2);
  if (!words.length) return true;
  return words.every((w) => src.includes(w));
}

for (const [file, page] of FILES) {
  const data = JSON.parse(readFileSync(join(ROOT, "src", "data", "lists", file), "utf8"));
  const items = data.items;
  const years = items.map((i) => i.year);
  const all = [];
  for (let y = Math.min(...years); y <= Math.max(...years); y++) all.push(y);
  const gaps = all.filter((y) => !years.includes(y));
  const dups = [...new Set(years.filter((y, i) => years.indexOf(y) !== i))];
  const src = await source(page);
  const badTitle = items.filter((i) => !appears(src, i.title));
  const badCreator = items.filter((i) => i.creator && !appears(src, i.creator.split(/,| and /)[0]));
  const badRelease = items.filter((i) => typeof i.release_year !== "number");
  const checks = items.filter((i) => i.check).length;
  console.log(`${file}: ${items.length} items, ${Math.min(...years)}-${Math.max(...years)}, gaps [${gaps.join(", ")}], shared years [${dups.join(", ")}]`);
  console.log(`  titles not found in source: ${badTitle.length}, creators not found: ${badCreator.length}, bad release_year: ${badRelease.length}, check flags: ${checks}`);
  const sample = [...items].sort(() => Math.random() - 0.5).slice(0, 6);
  for (const s of sample) console.log(`  sample: ${s.year} | ${s.title} | ${s.creator} | ${s.release_year}`);
}
