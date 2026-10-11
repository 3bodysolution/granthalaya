// Builds the four film prize lists in src/data/lists/ from Wikipedia.
// Usage: node scripts/build-film-lists.mjs [--only oscar,palme,national,marathi] [--dump]
// Reads the award tables (wikitext via the MediaWiki API), then fetches each
// film's article in batches for director, language and release year.
// Writes: oscar-best-picture.json, palme-dor.json, national-best-feature.json,
// national-best-marathi.json. Items with a guessed or missing value get "check": true.

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "src", "data", "lists");
const UA = "Granthalaya/1.0 (+https://github.com/3bodysolution/granthalaya)";
const API = "https://en.wikipedia.org/w/api.php";

const args = process.argv.slice(2);
const only = args.includes("--only") ? args[args.indexOf("--only") + 1].split(",") : null;
const dump = args.includes("--dump");

async function api(params) {
  const url = new URL(API);
  url.search = new URLSearchParams({ format: "json", formatversion: "2", ...params }).toString();
  for (let attempt = 1; attempt <= 4; attempt++) {
    const res = await fetch(url, { headers: { "User-Agent": UA } });
    if (res.ok) return res.json();
    if (res.status !== 429 && res.status < 500) throw new Error(`HTTP ${res.status} for ${url}`);
    await new Promise((r) => setTimeout(r, 1500 * attempt));
  }
  throw new Error(`Gave up on ${url}`);
}

async function wikitext(title) {
  const j = await api({ action: "parse", page: title, prop: "wikitext", redirects: "1" });
  return j.parse.wikitext;
}

// ---------- wikitext helpers ----------

// Turn wiki markup into plain text (links, templates, refs, bold/italic removed).
function plain(s) {
  let t = s
    .replace(/<ref[^>]*\/>/gi, "")
    .replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, "")
    .replace(/<sup>[\s\S]*?<\/sup>/gi, "")
    .replace(/<br\s*\/?>/gi, ", ")
    .replace(/<!--[\s\S]*?-->/g, "");
  // Innermost templates first, repeated until none are left.
  for (let i = 0; i < 20; i++) {
    const before = t;
    t = t.replace(/\{\{([^{}]*)\}\}/g, (_, body) => templateText(body));
    if (t === before) break;
  }
  t = t
    .replace(/\[\[(?:File|Image):[^\]]*\]\]/gi, "")
    .replace(/\[\[([^\]|]*)\|([^\]]*)\]\]/g, "$2")
    .replace(/\[\[([^\]]*)\]\]/g, "$1")
    .replace(/'{2,}/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .replace(/\s+,/g, ",")
    .replace(/(,\s*)+/g, ", ")
    .trim()
    .replace(/^,\s*|,\s*$/g, "")
    .replace(/^[|!]\s*/, "");
  return t;
}

function templateText(body) {
  const parts = splitTop(body, "|").map((p) => p.trim());
  const name = (parts[0] || "").toLowerCase();
  const pos = parts.slice(1).filter((p) => !/^\w+\s*=/.test(p) || /^\d+=/.test(p)).map((p) => p.replace(/^\d+=/, ""));
  switch (name) {
    case "sort":
      return pos[1] ?? pos[0] ?? "";
    case "sortname":
      return [pos[0], pos[1]].filter(Boolean).join(" ");
    case "small":
    case "nowrap":
    case "nobold":
      return pos[0] ?? "";
    case "lang":
    case "langx":
      return pos[1] ?? pos[0] ?? "";
    case "tooltip":
      return pos[pos.length - 1] ?? "";
    case "plainlist":
    case "plain list":
    case "hlist":
    case "flatlist":
      return pos.join(", ");
    case "start date and age":
    case "start date":
    case "film date":
    case "birth date and age":
      return pos[0] ?? "";
    default:
      return "";
  }
}

// Split on a separator that is not inside [[ ]] or {{ }}.
function splitTop(s, sep) {
  const out = [];
  let depth = 0, cur = "";
  for (let i = 0; i < s.length; i++) {
    const two = s.slice(i, i + 2);
    if (two === "[[" || two === "{{") { depth++; cur += two; i++; continue; }
    if (two === "]]" || two === "}}") { depth--; cur += two; i++; continue; }
    if (s[i] === sep && depth === 0) { out.push(cur); cur = ""; continue; }
    cur += s[i];
  }
  out.push(cur);
  return out;
}

function firstTopBar(s) {
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const two = s.slice(i, i + 2);
    if (two === "[[" || two === "{{") { depth++; i++; continue; }
    if (two === "]]" || two === "}}") { depth--; i++; continue; }
    if (s[i] === "|" && depth === 0) return i;
  }
  return -1;
}

function isAttrs(s) {
  return s.trim() !== "" && (/=\s*"/.test(s) || /^\s*\w[\w-]*\s*=/.test(s));
}

// Split a cell line on a doubled separator, ignoring any inside [[ ]] or {{ }}.
function splitDouble(s, sep) {
  const out = [];
  let depth = 0, cur = "";
  for (let i = 0; i < s.length; i++) {
    const two = s.slice(i, i + 2);
    if (two === "[[" || two === "{{") { depth++; cur += two; i++; continue; }
    if (two === "]]" || two === "}}") { depth--; cur += two; i++; continue; }
    if (depth === 0 && s.slice(i, i + 2) === sep) { out.push(cur); cur = ""; i++; continue; }
    cur += s[i];
  }
  out.push(cur);
  return out;
}

// Parse every wikitable into rows of cells: { header: bool, raw, attrs }.
function parseTables(text) {
  const tables = [];
  let rows = null, row = null, cell = null;
  const flushCell = () => { if (cell && row) row.cells.push(cell); cell = null; };
  const flushRow = () => { flushCell(); if (row && rows) rows.push(row); row = null; };
  for (const line of text.split("\n")) {
    if (/^\{\|/.test(line)) { rows = []; row = { cells: [] }; cell = null; continue; }
    if (/^\|\}/.test(line)) { flushRow(); tables.push(rows); rows = null; continue; }
    if (rows === null) continue;
    if (/^\|\+/.test(line)) continue;
    if (/^\|-/.test(line)) { flushRow(); row = { cells: [] }; continue; }
    const m = /^([|!])(.*)$/.exec(line);
    if (m) {
      flushCell();
      const header = m[1] === "!";
      const parts = splitDouble(m[2], header ? "!!" : "||");
      for (let i = 0; i < parts.length; i++) {
        const body = parts[i];
        const bar = firstTopBar(body);
        const hasAttrs = bar >= 0 && isAttrs(body.slice(0, bar));
        cell = {
          header,
          raw: (hasAttrs ? body.slice(bar + 1) : body).trim(),
          attrs: hasAttrs ? body.slice(0, bar) : "",
        };
        if (i < parts.length - 1) flushCell();
      }
    } else if (cell) {
      cell.raw += "\n" + line;
    }
  }
  return tables;
}

// ---------- film article data ----------

function infoboxField(wiki, field) {
  const lines = wiki.split("\n");
  const re = new RegExp(`^\\s*\\|\\s*${field}\\s*=(.*)$`, "i");
  for (let i = 0; i < lines.length; i++) {
    const m = re.exec(lines[i]);
    if (!m) continue;
    let value = m[1];
    for (let j = i + 1; j < lines.length && !/^\s*\|\s*[\w ]+=/.test(lines[j]) && !/^\s*\}\}/.test(lines[j]); j++) {
      value += " " + lines[j];
    }
    if (/\{\{\s*(plain ?list|hlist|flatlist|ubl|unbulleted list)/i.test(value)) {
      value = value.replace(/\{\{\s*(plain ?list|hlist|flatlist|ubl|unbulleted list)\s*\|?/gi, "").replace(/\}\}/g, "").replace(/\*/g, ", ");
    }
    return plain(value.replace(/\{\{efn[\s\S]*$/i, "").replace(/<ref[\s\S]*$/i, "").trim());
  }
  return "";
}

function firstYear(s) {
  const m = /\b(1[89]\d\d|20\d\d)\b/.exec(s || "");
  return m ? Number(m[1]) : null;
}

// Batch-fetch film articles (50 titles per request). Returns Map(title -> wikitext or null).
async function fetchArticles(titles) {
  const unique = [...new Set(titles.filter(Boolean))];
  const map = new Map();
  for (let i = 0; i < unique.length; i += 50) {
    const batch = unique.slice(i, i + 50);
    const j = await api({
      action: "query",
      prop: "revisions",
      rvprop: "content",
      rvslots: "main",
      redirects: "1",
      titles: batch.join("|"),
    });
    const redirects = new Map((j.query.redirects || []).map((r) => [r.from, r.to]));
    const pages = new Map((j.query.pages || []).map((p) => [p.title, p]));
    for (const t of batch) {
      const target = redirects.get(t) || t;
      const page = pages.get(target);
      map.set(t, page?.revisions?.[0]?.slots?.main?.content ?? null);
    }
  }
  return map;
}

function linkTarget(raw) {
  const m = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/.exec(raw);
  return m ? m[1] : null;
}

// ---------- the award tables ----------

// Oscars: Best Picture winners by ceremony. The winner is the first bold cell after the ceremony header.
async function oscarItems() {
  const wiki = await wikitext("Academy Award for Best Picture");
  const items = [];
  for (const table of parseTables(wiki)) {
    for (const row of table) {
      const first = row.cells[0];
      if (!first || !first.header) continue;
      const m = /Academy Awards\|\((\d+)(st|nd|rd|th)\)/.exec(first.raw);
      if (!m) continue;
      const nth = Number(m[1]);
      const filmYear = firstYear(plain(first.raw.split("<br")[0]));
      const winnerCell = row.cells[1];
      if (!winnerCell || !/'''/.test(winnerCell.raw)) {
        items.push({ _missing: true, nth });
        continue;
      }
      items.push({
        ceremonyYear: 1928 + nth,
        nth,
        title: plain(winnerCell.raw),
        page: linkTarget(winnerCell.raw) || plain(winnerCell.raw),
        release_year: filmYear,
      });
    }
  }
  return items;
}

// Palme d'Or: header cell holds the year, then English title, original title (unless colspan), recipient, country.
async function palmeItems() {
  const wiki = await wikitext("Palme d'Or");
  const items = [];
  for (const table of parseTables(wiki)) {
    let year = null;
    for (const row of table) {
      const cells = row.cells.slice();
      if (cells.length && cells[0].header && /\b(19|20)\d\d\b/.test(plain(cells[0].raw))) {
        year = Number(/\b((?:19|20)\d\d)\b/.exec(plain(cells[0].raw))[1]);
        cells.shift();
      }
      if (!year || year < 1955 || cells.length < 3) continue;
      const hasOriginal = !/colspan/i.test(cells[0].attrs || "");
      const recip = cells[hasOriginal ? 2 : 1];
      const country = cells[hasOriginal ? 3 : 2];
      if (!recip) continue;
      items.push({
        year,
        title: plain(cells[0].raw),
        original: hasOriginal && cells[1] ? plain(cells[1].raw) : null,
        creator: plain(recip.raw),
        country: country ? plain(country.raw) : "",
        page: linkTarget(cells[0].raw),
      });
    }
  }
  return items;
}

// National Film Awards: rows of Year | Film | (Language) | Producer | Director. Column order comes
// from the header row, so the Marathi table (no language column) works too. Rows with only a
// film (the second film of a shared year) inherit the year above.
async function nationalItems(pageTitle) {
  const wiki = await wikitext(pageTitle);
  const items = [];
  for (const table of parseTables(wiki)) {
    const headerRow = table.find((r) => r.cells.some((c) => c.header && /\bYear\b/.test(plain(c.raw))));
    if (!headerRow) continue;
    const names = headerRow.cells.map((c) => plain(c.raw));
    const filmCol = names.findIndex((n) => /^Film/i.test(n));
    const langCol = names.findIndex((n) => /^Language/i.test(n));
    const dirCol = names.findIndex((n) => /^Director/i.test(n));
    let year = null;
    for (const row of table) {
      if (row === headerRow) continue;
      const cells = row.cells;
      if (!cells.length) continue;
      if (cells.some((c) => /No Award/i.test(c.raw))) { year = null; continue; }
      const filmIdx = cells.findIndex((c) => c.header);
      if (filmIdx < 0) continue;
      const yearMatch = filmIdx > 0 ? /\b((?:19|20)\d\d)\b/.exec(plain(cells[0].raw)) : null;
      if (yearMatch) year = Number(yearMatch[1]);
      if (!year) continue;
      // Column offset of each field relative to the film cell (the film is the header cell).
      const at = (col) => (col >= 0 && cells[filmIdx + (col - filmCol)] ? cells[filmIdx + (col - filmCol)] : null);
      const filmCell = cells[filmIdx];
      const lang = at(langCol);
      const dir = at(dirCol);
      items.push({
        year,
        title: plain(filmCell.raw),
        language: lang ? plain(lang.raw).replace(/\s*\|\s*/g, ", ") : "",
        creator: dir ? plain(dir.raw) : "",
        page: linkTarget(filmCell.raw),
      });
    }
  }
  return items;
}

// ---------- build ----------

function enrich(article, fallbackRelease) {
  const wiki = article ?? "";
  const released = wiki ? firstYear(infoboxField(wiki, "released")) : null;
  return {
    director: wiki ? infoboxField(wiki, "director") : "",
    language: wiki ? infoboxField(wiki, "language") : "",
    release_year: released ?? fallbackRelease ?? null,
    releaseFromArticle: released != null,
    hasArticle: article != null,
  };
}

function write(name, data) {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, name), JSON.stringify(data, null, 2) + "\n");
}

function report(label, items) {
  const years = items.map((i) => i.year);
  const missingCreator = items.filter((i) => !i.creator).length;
  const check = items.filter((i) => i.check).length;
  console.log(`${label}: ${items.length} items, years ${Math.min(...years)}-${Math.max(...years)}, missing creator ${missingCreator}, check ${check}`);
}

async function buildOscar() {
  const raw = await oscarItems();
  const missing = raw.filter((r) => r._missing);
  const rows = raw.filter((r) => !r._missing);
  const articles = await fetchArticles(rows.map((r) => r.page));
  const items = rows.map((r) => {
    const a = enrich(articles.get(r.page));
    const item = {
      year: r.ceremonyYear,
      title: r.title,
      creator: a.director,
      release_year: r.release_year ?? a.release_year,
    };
    const flags = [];
    if (!a.hasArticle) flags.push("no article");
    if (!a.director) flags.push("director");
    if (flags.length) console.log("oscar check", r.title, r.page, a.hasArticle);
    if (flags.length) item.check = true;
    return item;
  }).sort((a, b) => b.year - a.year);
  if (missing.length) console.log("Oscar ceremonies with no bold winner:", missing.map((m) => m.nth));
  return items;
}

async function buildPalme() {
  const raw = (await palmeItems()).filter((r) => r.year !== 2020);
  const articles = await fetchArticles(raw.map((r) => r.page));
  const items = raw.map((r) => {
    const a = enrich(articles.get(r.page), r.year - 1);
    const item = { year: r.year, title: r.title };
    if (r.original && r.original !== r.title) item.original_title = r.original;
    if (a.language && !/^english$/i.test(a.language)) item.language = a.language;
    item.creator = r.creator || a.director;
    item.release_year = a.release_year;
    const flags = [];
    if (!a.hasArticle) flags.push("no article");
    if (!a.releaseFromArticle) flags.push("release year guessed");
    if (!a.language) flags.push("language");
    if (flags.length) item.check = true;
    return item;
  }).sort((a, b) => b.year - a.year);
  return items;
}

async function buildNational(pageTitle) {
  const raw = await nationalItems(pageTitle);
  const articles = await fetchArticles(raw.map((r) => r.page));
  const items = raw.map((r) => {
    const a = enrich(articles.get(r.page), r.year - 1);
    const item = {
      year: r.year,
      title: r.title,
      creator: r.creator || a.director,
      language: (r.language || a.language).replace(/\s*\|\s*/g, ", "),
      release_year: a.release_year,
    };
    const flags = [];
    if (!a.hasArticle) flags.push("no article");
    if (!a.releaseFromArticle) flags.push("release year guessed");
    if (!item.creator) flags.push("director");
    if (!item.language && pageTitle.includes("Marathi")) item.language = "Marathi";
    if (!item.language) flags.push("language");
    // Awards are usually for films released the year before (or the same year).
    if (a.releaseFromArticle && ![r.year - 1, r.year].includes(item.release_year)) flags.push("release year vs award year");
    if (flags.length) item.check = true;
    return item;
  }).sort((a, b) => b.year - a.year);
  return items;
}

const LISTS = {
  oscar: async () => ({
    file: "oscar-best-picture.json",
    meta: {
      slug: "oscar-best-picture",
      title: "Academy Award for Best Picture winners",
      kind: "film",
      intro: "Every Best Picture winner at the Academy Awards since the first ceremony in 1929, with the year of the ceremony.",
      source: { name: "Wikipedia: Academy Award for Best Picture", url: "https://en.wikipedia.org/wiki/Academy_Award_for_Best_Picture" },
    },
    items: await buildOscar(),
  }),
  palme: async () => ({
    file: "palme-dor.json",
    meta: {
      slug: "palme-dor",
      title: "Palme d'Or winners",
      kind: "film",
      intro: "Every winner of the Palme d'Or, the top prize of the Cannes Film Festival, since it was first given in 1955.",
      source: { name: "Wikipedia: Palme d'Or", url: "https://en.wikipedia.org/wiki/Palme_d%27Or" },
    },
    items: await buildPalme(),
  }),
  national: async () => ({
    file: "national-best-feature.json",
    meta: {
      slug: "national-best-feature",
      title: "National Film Award for Best Feature Film",
      kind: "film",
      intro: "Every winner of India's National Film Award for Best Feature Film, the country's top prize for cinema, from its first year in 1953.",
      source: { name: "Wikipedia: National Film Award for Best Feature Film", url: "https://en.wikipedia.org/wiki/National_Film_Award_for_Best_Feature_Film" },
    },
    items: await buildNational("National_Film_Award_for_Best_Feature_Film"),
  }),
  marathi: async () => ({
    file: "national-best-marathi.json",
    meta: {
      slug: "national-best-marathi",
      title: "National Film Award for Best Marathi Feature Film",
      kind: "film",
      intro: "Every winner of India's National Film Award for the best feature film in Marathi, the language of Maharashtra.",
      source: { name: "Wikipedia: National Film Award for Best Marathi Feature Film", url: "https://en.wikipedia.org/wiki/National_Film_Award_for_Best_Marathi_Feature_Film" },
    },
    items: await buildNational("National_Film_Award_for_Best_Marathi_Feature_Film"),
  }),
};

for (const key of Object.keys(LISTS)) {
  if (only && !only.includes(key)) continue;
  const { file, meta, items } = await LISTS[key]();
  if (dump) console.log(JSON.stringify(items.slice(0, 3), null, 1));
  report(key, items);
  write(file, { ...meta, items });
}
