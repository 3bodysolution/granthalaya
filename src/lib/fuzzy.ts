// Forgiving comparison of names, for search. Nothing here talks to the database.
//
//   norm()        makes a name comparable: lower case, no accents, Devanagari turned into Latin letters, Marathi and Hindi
//                 spellings brought together (aa/a, ee/i, oo/u, chh/ch, w/v, sh/s, doubled letters), and spaces and
//                 punctuation dropped, so "Batatyachi Chaal" and "batatyachi chal" become the same text.
//   similarity()  0 to 1: the best of trigram overlap (the way Postgres' pg_trgm counts), edit distance on the whole name,
//                 and how much of a short query sits inside a longer name.
//   rank()        the closest documents to a query, best first, above a threshold.

const CONS: Record<string, string> = {
  'क': 'k', 'ख': 'kh', 'ग': 'g', 'घ': 'gh', 'ङ': 'n', 'च': 'ch', 'छ': 'ch', 'ज': 'j', 'झ': 'jh', 'ञ': 'n',
  'ट': 't', 'ठ': 'th', 'ड': 'd', 'ढ': 'dh', 'ण': 'n', 'त': 't', 'थ': 'th', 'द': 'd', 'ध': 'dh', 'न': 'n',
  'प': 'p', 'फ': 'f', 'ब': 'b', 'भ': 'bh', 'म': 'm', 'य': 'y', 'र': 'r', 'ल': 'l', 'ळ': 'l', 'व': 'v',
  'श': 's', 'ष': 's', 'स': 's', 'ह': 'h',
};
const VOWEL: Record<string, string> = { 'अ': 'a', 'आ': 'a', 'इ': 'i', 'ई': 'i', 'उ': 'u', 'ऊ': 'u', 'ऋ': 'ri', 'ए': 'e', 'ऐ': 'ai', 'ओ': 'o', 'औ': 'au', 'ऍ': 'e', 'ऑ': 'o' };
const MATRA: Record<string, string> = { 'ा': 'a', 'ि': 'i', 'ी': 'i', 'ु': 'u', 'ू': 'u', 'ृ': 'ri', 'े': 'e', 'ै': 'ai', 'ो': 'o', 'ौ': 'au', 'ॅ': 'e', 'ॉ': 'o' };
const DIGIT: Record<string, string> = { '०': '0', '१': '1', '२': '2', '३': '3', '४': '4', '५': '5', '६': '6', '७': '7', '८': '8', '९': '9' };
const NUKTA = '़', VIRAMA = '्', ANUSVARA = 'ं', CHANDRABINDU = 'ँ', VISARGA = 'ः';

/** Devanagari written in Latin letters, roughly as people type it ("बटाट्याची चाळ" is "batatyachi chal"); other text is left alone */
export function latin(s: string): string {
  if (!/[ऀ-ॿ]/.test(s)) return s;
  // nukta forms (क़ ज़ फ़ ...) are written as base letter + nukta: take the nukta off so the base letter is read
  const c = [...s.normalize('NFD').replace(/़/g, '').normalize('NFC')];
  let out = '';
  for (let i = 0; i < c.length; i++) {
    const ch = c[i], next = c[i + 1];
    if (CONS[ch]) {
      out += CONS[ch];
      if (next === VIRAMA) { i++; continue; }                        // virama: no vowel
      if (next && MATRA[next]) { out += MATRA[next]; i++; continue; }
      if (next === ANUSVARA || next === CHANDRABINDU || next === VISARGA) { out += 'a'; continue; }
      // inherent "a": kept inside a word, dropped at its end (as it is spoken)
      if (next && (CONS[next] || VOWEL[next])) out += 'a';
      continue;
    }
    if (VOWEL[ch]) { out += VOWEL[ch]; continue; }
    if (ch === ANUSVARA || ch === CHANDRABINDU) { out += 'n'; continue; }
    if (ch === VISARGA) { out += 'h'; continue; }
    if (ch === NUKTA || ch === VIRAMA) continue;
    out += DIGIT[ch] ?? ch;
  }
  return out;
}

/** the comparable form of a name (see the top of the file) */
export function norm(s: string): string {
  let t = latin(s).normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
  t = t.replace(/[’'`´]/g, '').replace(/&/g, 'and');
  t = t.replace(/[^a-z0-9]+/g, '');   // spaces and punctuation go
  t = t.replace(/ck/g, 'k').replace(/q/g, 'k').replace(/x/g, 'ks')
    .replace(/chh/g, 'ch').replace(/sh/g, 's').replace(/w/g, 'v').replace(/z/g, 'j')
    .replace(/aa+/g, 'a').replace(/ee+|ii+/g, 'i').replace(/oo+|uu+/g, 'u')
    .replace(/ph/g, 'f').replace(/ou/g, 'u')
    .replace(/(.)\1+/g, '$1');         // doubled letters (kk, ss, ll...)
  return t;
}

function grams(t: string): Set<string> {
  const p = `  ${t} `;
  const set = new Set<string>();
  for (let i = 0; i + 3 <= p.length; i++) set.add(p.slice(i, i + 3));
  return set;
}

function distance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}

/** both arguments already through norm() */
export function similarityOfNorm(q: string, f: string): number {
  if (!q || !f) return 0;
  if (q === f) return 1;
  const gq = grams(q), gf = grams(f);
  let both = 0;
  for (const g of gq) if (gf.has(g)) both++;
  const jaccard = both / (gq.size + gf.size - both);
  const lev = 1 - distance(q, f) / Math.max(q.length, f.length);
  // a short query inside a longer name (first words of a title, a surname): only for queries long enough to mean something
  const contain = q.length >= 5 ? (f.includes(q) ? 0.92 : (both / gq.size) * 0.8) : 0;
  return Math.max(jaccard, lev, contain);
}

export const similarity = (q: string, field: string) => similarityOfNorm(norm(q), norm(field));

export interface Ranked<T> { doc: T; score: number }

/** documents closest to the query, best first; each document lists the (already normalised) names to compare, with a weight */
export function rank<T extends { fields: { norm: string; weight: number }[] }>(docs: T[], query: string, min = 0.5, limit = 8): Ranked<T>[] {
  const q = norm(query);
  if (q.length < 2) return [];
  const out: Ranked<T>[] = [];
  for (const d of docs) {
    let best = 0;
    for (const f of d.fields) {
      const s = similarityOfNorm(q, f.norm) * f.weight;
      if (s > best) best = s;
    }
    if (best >= min) out.push({ doc: d, score: best });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit);
}
