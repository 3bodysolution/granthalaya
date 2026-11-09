// The hand-kept list of titles that request answers never show (src/data/search-hidden.json). Names are compared with capitals, accents and
// punctuation ignored. Only request answers ("best animated movies") use it: typing a hidden title's own name still finds it.
import list from '../../data/search-hidden.json';

const fold = (s: string) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const hidden = new Set((list.titles as string[]).map(fold));

export const isHidden = (title: string) => hidden.has(fold(title));
