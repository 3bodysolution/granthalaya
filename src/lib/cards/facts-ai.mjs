// The AI question behind a share card's line, shared by the site and by scripts/fill-card-facts.mjs.
// One call writes a short line about a title, from the title's summary and genres only.
import { askGemini, askGroq } from '../trivia.mjs';

export const MAX_WORDS = 10;

/** tidy a line: one sentence, no dashes, no quotes, and short enough; null if it can't be used */
export function tidyLine(raw) {
  let s = String(raw ?? '').replace(/\s+/g, ' ').replace(/^["“”'‘’\s]+|["“”'‘’\s]+$/g, '').trim();
  if (/[—–]/.test(s)) s = s.replace(/\s*[—–]\s*/g, ', ');
  s = s.replace(/\.$/, '');
  if (s.length < 8 || s.split(' ').length > MAX_WORDS) return null;
  return s;
}

const prompt = (title, kind, genres, summary) => `One job for the ${kind} "${title}", for a share card.

Use ONLY the official text and genres below.
Write "line": one short line saying what it is about, in plain, specific words. At most ${MAX_WORDS} words. No spoilers (nothing from the middle or the end). No em dashes or en dashes. No quotation marks. Do not repeat the title. Do not start with "A story about".

Reply with JSON only: {"line": "..."}

GENRES: ${genres.join(', ') || 'none listed'}
TEXT:
${summary.slice(0, 1800)}`;

// a book description from a long or messy text: what the book is, in 2 or 3 plain sentences, from that text only
const summaryPrompt = (title, creator, text) => `Write the short description shown on the page of the book "${title}"${creator ? ` by ${creator}` : ''}.

Use ONLY the text below. Do not add anything from memory.
- 2 or 3 plain sentences, at most 70 words in all.
- Say what kind of book it is and what it is about. Only the setup: nothing from the middle or the end.
- No praise, no review quotes, no sales lines ("bestseller", "masterpiece", "must-read").
- No em dashes or en dashes. No quotation marks around the whole text.
- Simple, natural English.

Reply with JSON only: {"description": "..."}

TEXT:
${text.slice(0, 5000)}`;

/** 2 or 3 plain sentences about a book, from `text` only. Returns the description, or null when no model answered or the answer can't be used. */
export async function askSummary({ title, creator, text }, keys) {
  if (!keys.gemini && !keys.groq) return null;
  const q = summaryPrompt(title, creator, text);
  let raw;
  try {
    if (!keys.gemini) throw new Error('no Gemini key');
    raw = await askGemini(keys.gemini, keys.geminiModel, q, 1);
  } catch (e) {
    if (!keys.groq) return null;
    try { raw = await askGroq(keys.groq, keys.groqModel, q, 1); } catch { return null; }
  }
  try {
    const s = String(JSON.parse(raw.replace(/^```(?:json)?|```$/g, '').trim()).description ?? '')
      .replace(/\s*[—–]\s*/g, ', ').replace(/\s+/g, ' ').replace(/^["“]+|["”]+$/g, '').trim();
    return s.length >= 60 && s.length <= 700 ? s : null;
  } catch { return null; }
}

/** Ask the free AI models (Gemini, then Groq). `keys` = { gemini, geminiModel, groq, groqModel }. Returns { line } (null when unusable), or null when no model answered. */
export async function askFacts({ title, kind, genres, summary }, keys) {
  if (!keys.gemini && !keys.groq) return null;
  const text = prompt(title, kind === 'tv' ? 'TV series' : kind, genres, summary);
  let raw;
  try {
    if (!keys.gemini) throw new Error('no Gemini key');
    raw = await askGemini(keys.gemini, keys.geminiModel, text, 1);
  } catch (e) {
    if (!keys.groq) return null;
    raw = await askGroq(keys.groq, keys.groqModel, text, 1);
  }
  try {
    const j = JSON.parse(raw.replace(/^```(?:json)?|```$/g, '').trim());
    return { line: tidyLine(j.line) };
  } catch { return null; }
}
