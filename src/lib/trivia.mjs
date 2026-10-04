// "Behind the film" / "Behind the book": a few short facts, picked by a free AI model
// from the title's English Wikipedia page, and only from that page.
//
// Plain JavaScript on purpose: the site (when you save something) and `npm run trivia`
// (for older entries) both use this same file.
//
// Needs GEMINI_API_KEY (free, from aistudio.google.com) or GROQ_API_KEY (free, from console.groq.com).
// Without a key, or if anything fails, it returns null and the entry is simply saved without facts.

// Wikipedia limits requests much more strictly when there is no web address to contact
const UA = { 'User-Agent': 'Granthalaya/1.0 (https://granthalaya-sarthak.vercel.app; personal library, behind-the-scenes facts)' };

async function getJSON(url, init = {}, ms = 8000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { ...init, signal: ctl.signal, headers: { ...UA, ...(init.headers ?? {}) } });
    if (!r.ok) throw new Error(`${r.status} from ${new URL(url).host}`);
    return await r.json();
  } finally { clearTimeout(t); }
}

const KINDS = {
  film: /\bfilm\b|\bmovie\b|\bdocumentary\b/i,
  book: /\bnovel\b|\bbook\b|\bcollection\b|\bpoems?\b|\bpoetry\b|\bmemoir\b|\bnovella\b|\bshort stor|\bessays?\b/i,
};

// "Paterson (film)" matches "Paterson"; "Applesauce (novel)" doesn't match "A Room of One's Own"
const norm = (s = '') => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const sameTitle = (page, title) => norm(page.replace(/\s*\([^)]*\)\s*$/, '')) === norm(title);

/** Find the Wikipedia page for a film or book. Returns { title, url, text } or null. */
export async function findWikipediaPage({ title, year, type, creator }) {
  const kind = KINDS[type];
  if (!kind) return null;
  const tries = [
    `${title} ${year ?? ''} ${type === 'film' ? 'film' : 'novel'}`,
    `${title} ${creator ?? ''}`,
    title,
  ];
  for (const term of tries) {
    const q = new URLSearchParams({
      action: 'query', generator: 'search', gsrsearch: term.replace(/\s+/g, ' ').trim(), gsrlimit: '6',
      prop: 'description', format: 'json', formatversion: '2', origin: '*',
    });
    const pages = ((await getJSON(`https://en.wikipedia.org/w/api.php?${q}`)).query?.pages ?? []).sort((a, b) => a.index - b.index);
    const fits = (p) => sameTitle(p.title, title) && kind.test(p.description ?? '') &&!/^list of|disambiguation/i.test(`${p.title} ${p.description ?? ''}`);
    const hit = pages.find((p) => fits(p) && (!year || (p.description ?? '').includes(String(year)))) ?? pages.find(fits);
    if (!hit) continue;
    const ex = new URLSearchParams({ action: 'query', prop: 'extracts', explaintext: '1', titles: hit.title, format: 'json', formatversion: '2', origin: '*' });
    const text = (await getJSON(`https://en.wikipedia.org/w/api.php?${ex}`)).query?.pages?.[0]?.extract ?? '';
    if (text.length < 400) continue;
    return { title: hit.title, url: `https://en.wikipedia.org/wiki/${encodeURIComponent(hit.title.replace(/ /g, '_'))}`, text: text.slice(0, 24000) };
  }
  return null;
}

const prompt = ({ title, year, type }, page) => `You are picking facts for the "Behind the ${type}" box on a personal library website.

Below is the English Wikipedia article for the ${type} "${title}"${year ? ` (${year})` : ''}.
Pick the 3 most surprising, specific and fun facts about how it was made, written or received.
Good facts: production stories, odd constraints, real-life inspirations, records, unexpected reactions.
Avoid: plot summary, cast lists, dull dates, awards lists, anything a reader could guess.

Rules:
- Use ONLY what this article says. Do not add anything from memory.
- Each fact is one or two plain sentences, under 30 words.
- Do not use em dashes or en dashes. Use full stops or commas.
- Write in simple, natural English.

Reply with JSON only, in this shape: {"facts": ["...", "...", "..."]}

ARTICLE:
${page.text}`;

// tries > 1 waits and asks again when the free model is busy (used by `npm run trivia`)
async function askGemini(key, model, text, tries = 1) {
  const models = model ? [model] : ['gemini-flash-latest', 'gemini-2.5-flash'];
  let last;
  for (let i = 0; i < tries; i++) {
    // only wait when the model is busy (503); a used-up allowance (429) won't come back in seconds
    if (i && !String(last?.message).startsWith('503')) break;
    if (i) await new Promise((r) => setTimeout(r, 5000 * i));
    for (const m of models) {
      try {
        const j = await getJSON(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
          body: JSON.stringify({ contents: [{ parts: [{ text }] }], generationConfig: { temperature: 0.4, responseMimeType: 'application/json' } }),
        }, 20000);
        return j.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
      } catch (e) { last = e; }
    }
  }
  throw last;
}

async function askGroq(key, model, text) {
  const j = await getJSON('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model: model || 'llama-3.3-70b-versatile', temperature: 0.4, response_format: { type: 'json_object' }, messages: [{ role: 'user', content: text }] }),
  }, 20000);
  return j.choices?.[0]?.message?.content ?? '';
}

const clean = (s) => String(s).replace(/\s*[—–]\s*/g, ', ').replace(/\s+/g, ' ').trim();

/**
 * Facts for a film or book.
 * keys: { gemini, geminiModel, groq, groqModel }
 * Returns { trivia: string[], source: string } or null. Never throws.
 */
export async function getTrivia(item, keys) {
  try {
    if (!keys?.gemini && !keys?.groq) return null;
    const page = await findWikipediaPage(item);
    if (!page) return null;
    const text = prompt(item, page);
    const raw = keys.gemini ? await askGemini(keys.gemini, keys.geminiModel, text, keys.tries) : await askGroq(keys.groq, keys.groqModel, text);
    const facts = (JSON.parse(raw.replace(/^```(?:json)?|```$/g, '').trim()).facts ?? [])
      .filter((f) => typeof f === 'string' && f.trim().length > 15)
      .map(clean)
      .filter((f) => f.split(' ').length <= 45)
      .slice(0, 3);
    return facts.length ? { trivia: facts, source: page.url } : null;
  } catch {
    return null;
  }
}
