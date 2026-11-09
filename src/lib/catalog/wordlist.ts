// The word list: common requests ("best sports movies", "Marathi novels", "newest sci-fi series", "मराठी कथा", "सर्वोत्तम हिंदी चित्रपट") are read
// here, with no AI call, so they answer at once and never use up the free model allowance. A request is read only if EVERY word is known
// (a kind, a sort word, a language, a decade, a topic or a filler word); one unknown word and it goes to the AI instead.
import type { Intent } from './ask';

const norm1 = (n: string) => n
  .replace(/\b(sci fi|scifi|science fiction)\b/g, 'scifi').replace(/\bshort stories\b/g, 'stories')
  .replace(/\b(highest rated|top rated|best rated|top rating|must read|must watch)\b/g, 'top')
  .replace(/\bstand ?up( comedy| specials?)?\b/g, 'standup').replace(/\bshort films?\b/g, 'shortfilm film')
  .replace(/\bmusic videos?\b/g, 'musicvideo film').replace(/\bconcerts?( films?)?\b/g, 'concert film');

const SORTS: [RegExp, 'top' | 'new' | 'popular'][] = [
  [/^(best|top|greatest|finest|good|great|famous|classic|classics|सर्वोत्तम|उत्तम|सर्वश्रेष्ठ|चांगले|चांगल्या|चांगली|अच्छी|अच्छे|अच्छा|बेहतरीन|सबसे)$/, 'top'],
  [/^(newest|latest|new|recent|नवीन|नवे|नवीनतम|ताज्या|नए|नई|नया)$/, 'new'],
  [/^(popular|लोकप्रिय|पॉप्युलर)$/, 'popular'],
];
const FILLER = /^(about|on|of|the|from|in|and|for|a|an|with|set|to|read|watch|some|me|my|like|बद्दल|विषयी|वरील|वर|आणि|के|की|में|का|बारे|से|यांच्या|साठी|च्या|ची|चे|मधील|मधले|है|हैं)$/;

type Kind = 'film' | 'tv' | 'book' | 'essay' | 'story' | 'novel';
const KINDS: [RegExp, Kind][] = [
  [/^(films?|movies?|cinema|चित्रपट\S*|सिनेमा\S*|फिल्म\S*|फ़िल्म\S*|पिक्चर\S*)$/, 'film'],
  [/^(series|shows?|tv|serials?|मालिका\S*|सीरीज\S*|धारावाहिक\S*)$/, 'tv'],
  [/^(novels?|कादंब[रऱ]\S*|उपन्यास\S*)$/, 'novel'],
  [/^(books?|पुस्तक\S*|किताब\S*|ग्रंथ\S*)$/, 'book'],
  [/^(essays?|articles?|निबंध\S*|लेख\S*)$/, 'essay'],
  [/^(stories|story|कथा\S*|कहानी\S*|कहानियाँ|कहानियां|गोष्टी\S*)$/, 'story'],
];

const LANG_WORDS: [RegExp, string][] = [
  [/^(marathi|मराठी|मराठीतील)$/, 'mr'], [/^(hindi|हिंदी|हिन्दी)$/, 'hi'], [/^(english|इंग्रजी|अंग्रेज़ी|अंग्रेजी)$/, 'en'], [/^tamil$/, 'ta'], [/^telugu$/, 'te'],
  [/^malayalam$/, 'ml'], [/^kannada$/, 'kn'], [/^(bengali|bangla)$/, 'bn'], [/^gujarati$/, 'gu'], [/^punjabi$/, 'pa'], [/^urdu$/, 'ur'], [/^japanese$/, 'ja'],
  [/^french$/, 'fr'], [/^korean$/, 'ko'], [/^spanish$/, 'es'], [/^german$/, 'de'], [/^italian$/, 'it'], [/^chinese$/, 'zh'], [/^russian$/, 'ru'],
];

/** a topic word and what it means for each kind: a TMDB genre (film, tv), a TMDB keyword (kw), a book subject, one of our essay themes */
interface Topic { film?: string; tv?: string; kw?: string; subject?: string; theme?: string }
const TOPICS: [RegExp, Topic][] = [
  [/^(sports?|खेळ\S*|क्रीडा|खेल)$/, { kw: 'sports', subject: 'sports' }],
  [/^standup$/, { kw: 'stand-up comedy' }],
  [/^shortfilm$/, { kw: 'short film' }],
  [/^musicvideo$/, { kw: 'music video' }],
  [/^concert$/, { kw: 'concert' }],
  [/^(war|wars|युद्ध\S*|लढाई|जंग)$/, { film: 'War', tv: 'War & Politics', subject: 'war' }],
  [/^(horror|हॉरर|भयपट|डरावनी)$/, { film: 'Horror', kw: 'horror', subject: 'horror' }],
  [/^(comedy|comedies|funny|कॉमेडी|विनोदी|हास्य\S*|हास्यपट)$/, { film: 'Comedy', tv: 'Comedy', subject: 'humor' }],
  [/^(romance|romantic|love|रोमँटिक|रोमांटिक|प्रेम\S*|रोमांस)$/, { film: 'Romance', kw: 'romance', subject: 'romance' }],
  [/^(documentary|documentaries|डॉक्युमेंटरी|माहितीपट\S*)$/, { film: 'Documentary', tv: 'Documentary' }],
  [/^(animated|animation|anime|cartoons?|कार्टून\S*|ॲनिमेशन|अॅनिमेशन)$/, { film: 'Animation', tv: 'Animation' }],
  [/^(scifi|sf)$/, { film: 'Science Fiction', tv: 'Sci-Fi & Fantasy', subject: 'science-fiction' }],
  [/^(crime|crimes|क्राईम|गुन्हेगारी|गुन्हे\S*)$/, { film: 'Crime', tv: 'Crime', subject: 'crime' }],
  [/^(thriller|thrillers|थ्रिलर)$/, { film: 'Thriller', kw: 'thriller', subject: 'thriller' }],
  [/^(mystery|mysteries|रहस्य\S*|रहस्यपट)$/, { film: 'Mystery', tv: 'Mystery', subject: 'mystery' }],
  [/^(action|ॲक्शन|अॅक्शन|एक्शन)$/, { film: 'Action', tv: 'Action & Adventure' }],
  [/^(adventure|साहस\S*)$/, { film: 'Adventure', tv: 'Action & Adventure' }],
  [/^(drama|dramas|ड्रामा)$/, { film: 'Drama', tv: 'Drama' }],
  [/^(fantasy|फँटसी|फैंटेसी)$/, { film: 'Fantasy', tv: 'Sci-Fi & Fantasy', subject: 'fantasy' }],
  [/^(family|कौटुंबिक)$/, { film: 'Family', tv: 'Family' }],
  [/^(western|westerns)$/, { film: 'Western', tv: 'Western' }],
  [/^(history|historical|इतिहास\S*|ऐतिहासिक)$/, { film: 'History', subject: 'history' }],
  [/^(music|musical|संगीत\S*)$/, { film: 'Music', theme: 'Music' }],
  [/^(philosophy|philosophical|तत्त्वज्ञान\S*|तत्वज्ञान\S*|दर्शन)$/, { subject: 'philosophy', theme: 'Philosophy' }],
  [/^(poetry|poems?|कविता\S*|कविताएँ|कविताएं)$/, { subject: 'poetry' }],
  [/^(travel|travels|प्रवास\S*|यात्रा\S*)$/, { subject: 'travel' }],
  [/^(nature|निसर्ग\S*|प्रकृती|प्रकृति)$/, { subject: 'nature', theme: 'Nature' }],
  [/^(writing|लेखन\S*)$/, { theme: 'Writing' }],
  [/^(freedom|स्वातंत्र्य\S*|आझादी|आज़ादी)$/, { theme: 'Freedom' }],
  [/^(work|काम)$/, { theme: 'Work' }],
  [/^(art|arts|कला|कलेचा|कलेवर)$/, { theme: 'Art' }],
  [/^(society|समाज\S*)$/, { theme: 'Society' }],
  [/^(memory|memories|स्मृती|आठवणी\S*)$/, { theme: 'Memory' }],
  [/^(theatre|theater|नाटक\S*)$/, { theme: 'Theatre', subject: 'drama' }],
  [/^(villages?|गाव\S*|ग्रामीण)$/, { kw: 'village', subject: 'village-life' }],
  [/^(politics|political|राजकारण\S*)$/, { subject: 'politics' }],
  [/^(science|विज्ञान\S*)$/, { subject: 'science' }],
  [/^(religion|धर्म\S*)$/, { subject: 'religion' }],
  [/^(biography|biographies|memoirs?|चरित्र\S*|आत्मचरित्र\S*)$/, { subject: 'biography' }],
  [/^(psychology|मानसशास्त्र\S*)$/, { subject: 'psychology' }],
];

/** "90s", "1990s", "1990", "2000s": the first year of the decade */
const decadeOf = (w: string): number | null => {
  const m = w.match(/^((?:19|20)\d0)s?$/) ?? w.match(/^(\d0)s$/);
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 1900 ? n : n >= 30 ? 1900 + n : 2000 + n;
};

/** a request the word list can read completely, as filters; null as soon as one word isn't known (then the AI is asked) */
export function parseSimple(norm: string): Intent | null {
  const words = norm1(norm).split(' ').filter(Boolean);
  let kind: Kind | null = null, sort: Intent['sort'], language: string | undefined, decade: number | undefined;
  const topics: Topic[] = [];
  for (const w of words) {
    const k = KINDS.find(([rx]) => rx.test(w));
    if (k) {
      const bookish = (a: Kind | null, b: Kind) => (a === 'novel' && b === 'book') || (a === 'book' && b === 'novel');
      if (kind && kind !== k[1] && !bookish(kind, k[1])) return null;   // two different kinds: not for the word list
      kind = kind === 'novel' || k[1] === 'novel' ? 'novel' : k[1];
      continue;
    }
    const st = SORTS.find(([rx]) => rx.test(w));
    if (st) { if (sort && sort !== st[1]) return null; sort = st[1]; continue; }
    const lg = LANG_WORDS.find(([rx]) => rx.test(w));
    if (lg) { if (language && language !== lg[1]) return null; language = lg[1]; continue; }
    const d = decadeOf(w);
    if (d) { decade = d; continue; }
    const tp = TOPICS.find(([rx]) => rx.test(w));
    if (tp) { topics.push(tp[1]); continue; }
    if (FILLER.test(w)) continue;
    return null;   // a word we don't know
  }
  if (!kind || (!topics.length && !language && !decade && !sort)) return null;
  const i: Intent = { kind: 'film', genres: [], keywords: [], subjects: [], themes: [], language, decade, sort };
  const add = (a: string[], v?: string) => { if (v && !a.includes(v)) a.push(v); };
  if (kind === 'film' || kind === 'tv') {
    i.kind = kind;
    for (const t of topics) { const g = t[kind]; if (g) add(i.genres, g); else if (t.kw) add(i.keywords, t.kw); else return null; }
  } else if (kind === 'essay' || (kind === 'story' && language === 'mr')) {
    // Marathi stories are Hakara's; they are in our essays data, so "stories" in Marathi is read as the essay kind with the story form
    i.kind = 'essay';
    if (kind === 'story') i.form = 'story';
    for (const t of topics) { if (t.theme) add(i.themes, t.theme); else return null; }
  } else {
    i.kind = 'book';
    if (kind === 'story') add(i.subjects, 'short-stories');
    if (kind === 'novel' && language !== 'mr' && language !== 'hi') add(i.subjects, 'fiction');
    for (const t of topics) { if (t.subject) add(i.subjects, t.subject); else return null; }
  }
  return i;
}
