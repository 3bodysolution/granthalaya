// The AI question behind a share card's line and painting, shared by the site and by scripts/fill-card-facts.mjs.
// One call writes a short line about a title and picks the painting that suits it, from the title's summary, genres and setting only.
import { askGemini, askGroq } from '../trivia.mjs';

export const BG_NAMES = ['cinema', 'fair', 'fields', 'forest', 'fort', 'noir', 'rain', 'reading', 'sea', 'stars', 'wada'];
export const MAX_WORDS = 10;

/** tidy a line: one sentence, no dashes, no quotes, and short enough; null if it can't be used */
export function tidyLine(raw) {
  let s = String(raw ?? '').replace(/\s+/g, ' ').replace(/^["“”'‘’\s]+|["“”'‘’\s]+$/g, '').trim();
  if (/[—–]/.test(s)) s = s.replace(/\s*[—–]\s*/g, ', ');
  s = s.replace(/\.$/, '');
  if (s.length < 8 || s.split(' ').length > MAX_WORDS) return null;
  return s;
}

const WHAT = `cinema = film and the cinema, documentaries; fair = music, animation, fun, festivals, plays, graphic novels; fields = comedy, family, village life, countryside, self-help; forest = horror, fantasy, myth, dark woods; fort = history, war, western, biography, politics, forts and old cities; noir = thriller, crime, mystery, night in the city; rain = action, adventure, monsoon, coast road and storms; reading = essays, psychology, quiet books, libraries and ideas; sea = romance, poetry, travel, beaches and the coast; stars = science fiction, science, philosophy, religion, space and the night sky; wada = drama, family sagas, literary fiction, short stories, memoir, old houses`;

const prompt = (title, kind, genres, summary) => `Two jobs for the ${kind} "${title}", for a share card.

Use ONLY the official summary and genres below.
1. "line": one short line saying what it is about, in plain, specific words. At most ${MAX_WORDS} words. No spoilers (nothing from the middle or the end). No em dashes or en dashes. No quotation marks. Do not repeat the title. Do not start with "A story about".
2. "background": the one painting that suits it best, judged from the summary, the genres and where and when it is set. It must be exactly one of: ${BG_NAMES.join(', ')}.
What the paintings are: ${WHAT}.

Reply with JSON only: {"line": "...", "background": "..."}

GENRES: ${genres.join(', ') || 'none listed'}
SUMMARY:
${summary.slice(0, 1800)}`;

/**
 * Ask the free AI models (Gemini, then Groq). `keys` = { gemini, geminiModel, groq, groqModel }.
 * Returns { line, bg } where each is null when missing or unusable (a painting that isn't one of the 11 names is ignored), or null when no model answered.
 */
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
    const bg = String(j.background ?? '').toLowerCase().trim();
    return { line: tidyLine(j.line), bg: BG_NAMES.includes(bg) ? bg : null };
  } catch { return null; }
}
