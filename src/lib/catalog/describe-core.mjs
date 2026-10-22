// Book descriptions, the part shared by the site (src/lib/catalog/describe.ts) and scripts/fill-descriptions.mjs.
// Plain JavaScript on purpose, like trivia.mjs, so the script can use it as it is.
//
// Where a description comes from, in order:
//   1. Wikipedia's intro, when the page is clearly this book (same title, described as a book, the author's surname in it);
//   2. Open Library's text for the work.
// Either is cleaned first (cleanBlurb). If it is still long (over about 600 characters) or messy, a free AI model writes
// 2 or 3 plain sentences from that text only ("ai-wikipedia", "ai-openlibrary"). If the AI can't answer, the text is cut
// at a sentence near 600 characters instead.
import { findWikipediaPage } from '../trivia.mjs';
import { askSummary } from '../cards/facts-ai.mjs';

export const SHORT = 600;   // longer than this, and the AI shortens it
export const MAX = 2000;    // the database's limit

const QUOTE = `["“”'‘’]`;
// lines that sell the book instead of describing it
const SALES = /^(#\s?1\b|(an? |the )?(instant |international |sunday times |new york times |national |global )*(#\s?1 )?(best ?sell(er|ing))|praise for|advance praise|winner of|shortlisted for|long-?listed for|now a (major )?(motion picture|film|netflix|tv)|soon to be a|over [\d.,]+ (million )?copies|more than [\d.,]+ (million )?copies|from the (author|publisher)|a (new york times|guardian|times) (notable|book of the year))/i;
const ATTRIBUTION = new RegExp(`^${QUOTE}.{8,}${QUOTE}[.!]?\\s*(?:[-—–]{1,2}|,|:)?\\s*[A-Z][^.!?]{1,80}[.]?$`);   // “Brilliant.” The Times
const BYLINE = /^\s*[-—–]{1,2}\s*[A-Z][\w .,&'’]{1,80}$/;                                                  // — The Guardian

const letters = (s) => s.replace(/[^A-Za-z]/g, '');
const shouting = (s) => { const l = letters(s); return l.length > 12 && l.replace(/[^A-Z]/g, '').length / l.length > 0.7; };

/** Clean a catalogue or Wikipedia text: no review quotes, star ratings, sales lines or "Source:" tails. Fast; runs on every page. */
export function cleanBlurb(text) {
  if (!text) return '';
  let t = String(text).replace(/\r/g, '');
  // "Praise for ..." and everything after it is quotes
  t = t.replace(/\n[^\n]*\bpraise for\b[\s\S]*$/i, '');
  const out = [];
  for (const para of t.split(/\n{2,}/)) {
    const lines = para.split('\n').map((l) => l.trim()).filter((l) => {
      if (!l) return false;
      if (/[★☆✩✪⭐]/.test(l) || /^\(?\s*\d(\.\d)?\s*(\/\s*5|out of 5|stars?)\s*\)?\.?$/i.test(l)) return false;
      if (l.length < 220 && SALES.test(l.replace(/^[*•\s]+/, ''))) return false;
      if (l.length < 300 && (ATTRIBUTION.test(l) || BYLINE.test(l))) return false;
      if (l.length < 200 && shouting(l)) return false;
      if (/^(also contained in|contains|source|description from|from wikipedia)\s*:/i.test(l)) return false;
      return true;
    });
    if (lines.length) out.push(lines.join(' '));
  }
  t = out.join('\n\n')
    .replace(/\s*\(\s*(source|from)\s*:?[^)]{0,120}\)\s*$/i, '')     // (Source: Penguin)
    .replace(/\s*\[?\(?\s*source\s*\)?\]?\s*$/i, '')                // ([source][1]) after plain()
    .replace(/\s*(source|from)\s*:\s*\S[^\n]{0,120}$/i, '')          // Source: the publisher
    .replace(/\s*(?:pronounced:?\s*|IPA:\s*)\[[^\]]*\]/gi, '')       // Wikipedia's pronunciations: (pronounced [prɒθɒm]; transl. ...)
    .replace(/\(\s*[;,]\s*/g, '(').replace(/\s*[;,]\s*\)/g, ')')
    .replace(/\(\s*[;,]?\s*\)/g, '')                                 // brackets left empty by a removed pronunciation
    .replace(/\s+[—–]\s+/g, ', ')                                    // no dashes on the site
    .replace(/[ \t]{2,}/g, ' ').replace(/ ([,.;:)])/g, '$1').trim();
  t = unmatched(t);
  return t.length >= 40 ? t : '';
}

/** drop a closing bracket that was never opened ("an autobiography of Sane Guruji).") */
function unmatched(t) {
  let open = 0, out = '';
  for (const c of t) {
    if (c === '(') open++;
    else if (c === ')') { if (!open) continue; open--; }
    out += c;
  }
  return out;
}

/** still not fit to show as it is: lists, links, lots of quotes */
export function messy(t) {
  if (/https?:\/\/|www\./i.test(t)) return true;
  if ((t.match(/["“”]/g) ?? []).length > 6) return true;
  const lines = t.split('\n').filter(Boolean);
  return lines.length > 4 && lines.filter((l) => l.length < 50).length > lines.length / 2;
}

/** cut at a sentence end at or before `max` characters (one sentence at least) */
export function cutAtSentence(t, max = SHORT) {
  if (t.length <= max) return t;
  const sentences = t.replace(/\n+/g, ' ').match(/[^.!?]+[.!?]+["”’)]?(\s+|$)/g) ?? [t];
  let s = '';
  for (const x of sentences) { if (s && (s + x).length > max) break; s += x; }
  return s.trim().slice(0, MAX);
}

const norm = (s = '') => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
/** the author's surname appears on the page: guards against a same-named book by someone else */
const byAuthor = (page, creator) => {
  const surname = norm(String(creator ?? '').split(/,| and | & /)[0]).split(' ').pop();
  if (!surname || surname.length < 2) return true;
  return norm(`${page.description} ${page.text.slice(0, 1500)}`).split(' ').includes(surname);
};

/**
 * The description for one book. `book` = { title, creator, year, olText }, `keys` = the AI keys.
 * `ai: false` (the dry run) asks no AI and only says what would happen. `trust: true` skips the surname check (for a page
 * checked by hand, where the author's name is spelt differently).
 * Returns { text, source, url, wiki, wikiRejected, needsAi, aiFailed, original } where text is null when nothing usable was found
 * and original is the cleaned text it came from.
 */
export async function describeBook({ title, creator, year, olText }, keys, { ai = true, trust = false } = {}) {
  let wiki = null, wikiRejected = null;
  try {
    const page = await findWikipediaPage({ title, year, type: 'book', creator }, { intro: true });
    if (page && (trust || byAuthor(page, creator))) wiki = page; else if (page) wikiRejected = page;
  } catch { /* Wikipedia busy or down: Open Library alone */ }
  const fromWiki = wiki ? cleanBlurb(wiki.text) : '';
  const fromOl = cleanBlurb(olText);
  const base = fromWiki.length >= 80 ? { text: fromWiki, from: 'wikipedia', url: wiki.url } : fromOl ? { text: fromOl, from: 'openlibrary', url: null } : null;
  const result = { text: null, source: null, url: null, wiki, wikiRejected, needsAi: false, aiFailed: false, original: null };
  if (!base) return result;
  result.url = base.url;
  result.original = base.text;
  if (base.text.length <= SHORT && !messy(base.text)) return { ...result, text: base.text, source: base.from };
  result.needsAi = true;
  if (!ai) return { ...result, text: base.text, source: `ai-${base.from}` };
  const short = await askSummary({ title, creator, text: base.text }, keys).catch(() => null);
  if (short) return { ...result, text: short, source: `ai-${base.from}` };
  return { ...result, text: cutAtSentence(base.text), source: base.from, aiFailed: true };
}
