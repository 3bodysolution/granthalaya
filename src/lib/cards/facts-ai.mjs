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

// each painting: what it shows, its mood, and what it suits
const WHAT = `
- cinema: a lit cinema street at dusk, wet road, marquee bulbs. Warm and nostalgic. Suits cinema itself, films about films, documentaries, city evenings.
- fair: a festival fair at sunset, ferris wheel, lanterns, balloons. Playful, festive, bright. Suits music, animation, fun, plays, graphic novels, satire and mischief.
- fields: sunny farmland under a blue sky, kites, a village house. Light, warm, easy. Suits comedy, family, childhood, village and rural life, self-help.
- forest: a moonlit misty forest with fireflies. Dark, eerie, enchanted. Suits horror, fantasy, myth, folklore, the supernatural.
- fort: misty hills at sunrise and an old hill fort. Historic, heroic, solemn. Suits history, war, western, biography, politics, epics, rulers and empires.
- noir: a rainy city seafront at night, lights on wet roads. Tense, moody, urban. Suits thriller, crime, mystery, corruption, fear and guilt.
- rain: monsoon hills, a waterfall, a bus on a mountain road. Wild, stormy, journeys. Suits action, adventure, struggle, nature, travel by road.
- reading: a warm wooden library with arched windows. Quiet, thoughtful, studious. Suits essays, ideas, psychology, scholarship, literary non-fiction, books about books.
- sea: a golden sunset beach with boats and palms. Romantic, wistful, open. Suits romance, poetry, longing, travel, the coast, love songs.
- stars: the Milky Way over a crater lake and an old temple. Vast and contemplative. Suits science fiction, science, philosophy, religion, spirituality, space and time.
- wada: the lantern-lit courtyard of an old wada at dusk. Rooted, domestic, nostalgic. Suits drama, family sagas, memory, tradition, literary fiction, short stories, memoir.`;

const prompt = (title, kind, genres, summary, needLine) => `${needLine ? 'Two jobs' : 'One job'} for the ${kind} "${title}", for a share card.

Use ONLY the official text and genres below.
${needLine ? `1. "line": one short line saying what it is about, in plain, specific words. At most ${MAX_WORDS} words. No spoilers (nothing from the middle or the end). No em dashes or en dashes. No quotation marks. Do not repeat the title. Do not start with "A story about".
2. "background"` : '"background"'}: the one painting whose mood and subject suit it best, judged from the text, the genres and where and when it is set. It must be exactly one of: ${BG_NAMES.join(', ')}.
The paintings:${WHAT}

Reply with JSON only: {${needLine ? '"line": "...", ' : ''}"background": "..."}

GENRES: ${genres.join(', ') || 'none listed'}
TEXT:
${summary.slice(0, 1800)}`;

/**
 * Ask the free AI models (Gemini, then Groq). `keys` = { gemini, geminiModel, groq, groqModel }. With `needLine: false` only the painting is asked for.
 * Returns { line, bg } where each is null when missing or unusable (a painting that isn't one of the 11 names is ignored), or null when no model answered.
 */
export async function askFacts({ title, kind, genres, summary, needLine = true }, keys) {
  if (!keys.gemini && !keys.groq) return null;
  const text = prompt(title, kind === 'tv' ? 'TV series' : kind, genres, summary, needLine);
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
    return { line: needLine ? tidyLine(j.line) : null, bg: BG_NAMES.includes(bg) ? bg : null };
  } catch { return null; }
}
