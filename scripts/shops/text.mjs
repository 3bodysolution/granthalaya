// Comparing Marathi and Hindi titles and names across scripts and spellings.
// मृत्युंजय, "Mrutyunjay" and "Mrityunjay" must come out the same, so both scripts are turned into a loose Latin "skeleton":
// Devanagari is transliterated, then vowels are dropped (long and short vowels, the silent a, ru/ri for ऋ all disappear),
// aspirates merge with their plain letters (kh → k, chh → c), and look-alike letters merge (w/v, z/j, ph/f, sh/s, x/ks).

const CONS = {
  'क': 'k', 'ख': 'kh', 'ग': 'g', 'घ': 'gh', 'ङ': 'n', 'च': 'ch', 'छ': 'chh', 'ज': 'j', 'झ': 'jh', 'ञ': 'n',
  'ट': 't', 'ठ': 'th', 'ड': 'd', 'ढ': 'dh', 'ण': 'n', 'त': 't', 'थ': 'th', 'द': 'd', 'ध': 'dh', 'न': 'n',
  'प': 'p', 'फ': 'ph', 'ब': 'b', 'भ': 'bh', 'म': 'm', 'य': 'y', 'र': 'r', 'ल': 'l', 'ळ': 'l', 'व': 'v',
  'श': 'sh', 'ष': 'sh', 'स': 's', 'ह': 'h', 'क़': 'k', 'ख़': 'kh', 'ग़': 'g', 'ज़': 'z', 'ड़': 'd', 'ढ़': 'dh', 'फ़': 'f', 'य़': 'y',
};
const VOWELS = { 'अ': 'a', 'आ': 'aa', 'इ': 'i', 'ई': 'ee', 'उ': 'u', 'ऊ': 'oo', 'ऋ': 'ru', 'ए': 'e', 'ऐ': 'ai', 'ओ': 'o', 'औ': 'au', 'ऑ': 'o', 'ॲ': 'a' };
const SIGNS = { 'ा': 'aa', 'ि': 'i', 'ी': 'ee', 'ु': 'u', 'ू': 'oo', 'ृ': 'ru', 'े': 'e', 'ै': 'ai', 'ो': 'o', 'ौ': 'au', 'ॉ': 'o', 'ॅ': 'a' };
const DIGITS = '०१२३४५६७८९';

/** Devanagari → plain Latin letters (loose; only for comparing) */
export function deva2latin(s) {
  s = s.normalize('NFC');
  let out = '';
  const chars = [...s];
  for (let i = 0; i < chars.length; i++) {
    let c = chars[i];
    if (chars[i + 1] === '़' && CONS[c + '़']) { c += '़'; i++; }
    if (CONS[c]) {
      out += CONS[c];
      const next = chars[i + 1];
      if (next === '्') { i++; continue; }          // half letter: no vowel
      if (SIGNS[next]) { out += SIGNS[next]; i++; continue; }
      out += 'a';                                   // the inherent a (dropped later anyway)
      continue;
    }
    if (VOWELS[c]) { out += VOWELS[c]; continue; }
    if (c === 'ं' || c === 'ँ') { out += 'n'; continue; }
    if (c === 'ः') { out += 'h'; continue; }
    const d = DIGITS.indexOf(c);
    if (d >= 0) { out += String(d); continue; }
    if (/[ऀ-ॿ]/.test(c)) continue;        // other marks
    out += c;
  }
  return out;
}

/** a loose key for comparing: same for मृत्युंजय, Mrutyunjay and Mrityunjay */
export function skeleton(s) {
  let t = deva2latin(String(s ?? '')).normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
  t = t.replace(/&/g, ' and ').replace(/[^a-z0-9 ]+/g, ' ');
  t = t.replace(/x/g, 'ks').replace(/q/g, 'k').replace(/w/g, 'v').replace(/z/g, 'j').replace(/ph/g, 'f')
    .replace(/chh|ch/g, 'c').replace(/sh/g, 's').replace(/([kgjtdpb])h/g, '$1').replace(/dny|gny/g, 'jn').replace(/gya/g, 'jna');
  t = t.replace(/[aeiou ]+/g, '').replace(/h/g, '').replace(/(.)\1+/g, '$1');
  return t;
}

// words that mark an edition, a format or a part of the shop's own naming, not the title
const NOISE = /\b(paperback|hardcover|hard bound|combo|set of \d+|vol(ume)?\.?\s*\d+|part\s*\d+|new edition|revised|आवृत्ती|संच|कॉम्बो)\b|\(.*?(edition|आवृत्ती).*?\)/gi;
/**
 * A shop's book name split into its English spelling, its Devanagari and an author named in it:
 *   "Swami (स्वामी) By Ranjit Desai", "Panipat (पानिपत) | Vishvas Patil", "Radha ( राधा )",
 *   "डिसिप्लिन इज डेस्टिनी (हिंदी) (Discipline is Destiny (Hindi))", "मुसाफिर (Musafir)".
 */
export function splitTitle(name) {
  let t = String(name ?? '').replace(/\s+/g, ' ').trim();
  let author = '';
  const m = t.match(/\s(?:by|BY|By)\s+([^()]+)$/) ?? t.match(/\s\|\s*([^()|]+)$/);
  if (m) { author = m[1].trim(); t = t.slice(0, m.index).trim(); }
  const DEVA = /[ऀ-ॿ][ऀ-ॿ\s.,:;!?'"‘’“”०-९0-9–-]*/g;
  const runs = (t.match(DEVA) ?? []).map((s) => s.replace(/[\s.,:;–-]+$/, '').trim()).filter((s) => /[ऀ-ॿ]{2}/.test(s));
  // the longest Devanagari run is the title (a short one like "हिंदी" is a note about the edition)
  const deva = [...runs].sort((a, b) => b.length - a.length)[0] ?? '';
  let latin = t.replace(DEVA, ' ').replace(/\(\s*\)/g, ' ').replace(/\s+/g, ' ').trim();
  while (/^\(.*\)$/.test(latin) && latin.split('(').length === latin.split(')').length) latin = latin.slice(1, -1).trim();
  latin = latin.replace(/^[\s|,:-]+|[\s|,:-]+$/g, '').replace(/\(\s*$/, '').trim();
  if (!/[A-Za-z]{2}/.test(latin)) latin = '';
  return { latin, deva, author };
}

/** a title's key: edition words removed; the whole title, so volumes of a series ("… : Ghalib", "… : Mir") stay apart */
export function titleKey(s) {
  return skeleton(String(s ?? '').replace(NOISE, ' ').replace(/\s+by\s+.*$/i, ''));
}
/** a title's key without its subtitle (after ":" or " - "): only for comparing with our own catalogue ("Premchand: Kalam Ka Sipahi") */
export function mainKey(s) {
  return titleKey(String(s ?? '').split(/\s[:\-–|]\s|:\s/)[0]);
}
/** the part number of a multi-part title ("Part 2", "भाग २"), so volumes never merge */
export const partOf = (s) => (String(s ?? '').match(/(?:part|vol(?:ume)?\.?|भाग|खंड)\s*([0-9०-९]+)/i)?.[1] ?? '').replace(/[०-९]/g, (d) => String(DIGITS.indexOf(d)));

/** a surname's key: the last real word of a name ("B D KHER" → kr, "शिवाजी सावंत" → svnt) */
export function surnameKey(name) {
  const words = deva2latin(String(name ?? '')).replace(/[.,]/g, ' ').split(/\s+/).filter((w) => w.replace(/[^a-zA-Z]/g, '').length > 1);
  return words.length ? skeleton(words[words.length - 1]) : '';
}

/** how alike two keys are, 0 to 1 (edit distance) */
export function alike(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const m = a.length, n = b.length;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return 1 - prev[n] / Math.max(m, n);
}
