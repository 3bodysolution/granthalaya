// Matches every essay author to an Open Library author page, once. Run: node scripts/essays/authors.mjs
// Open Library's search throws up namesakes (several "Paul Graham"s), so the matches below were picked by hand
// from its candidates (dates and top works). The script checks each key still exists and writes
// scripts/essays/authors.json, which build.mjs adds to every essay. An author with no key gets a simple page of
// their own on the site (/writer/<slug>/).
import { readFileSync, writeFileSync } from 'node:fs'

const KEYS = {
  'John W. Gardner': 'OL4409681A', 'Andrew Chen': 'OL7318750A', 'Venkatesh Rao': 'OL10614081A', 'Simon Sarris': 'OL7297207A',
  'George Orwell': 'OL118077A', 'Francis Bacon': 'OL23720A', 'Michel de Montaigne': 'OL112816A', 'Edgar Allan Poe': 'OL28127A',
  'Percy Bysshe Shelley': 'OL20743A', 'T. S. Eliot': 'OL116256A', 'William Hazlitt': 'OL220326A', 'Mark Twain': 'OL18319A',
  'Ralph Waldo Emerson': 'OL18405A', 'Henry David Thoreau': 'OL19690A', 'Okakura Kakuzo': 'OL840964A', 'Richard Hamming': 'OL119729A',
  'Paul Lockhart': 'OL6613277A', 'Kevin Kelly': 'OL234120A', 'Eric S. Raymond': 'OL1517703A', 'Richard P. Gabriel': 'OL453405A',
  'Richard Feynman': 'OL35793A', 'Vannevar Bush': 'OL1122532A', 'Alan Turing': 'OL770877A', 'Garrett Hardin': 'OL399084A',
  'Atul Gawande': 'OL1485501A', 'Martin Luther King Jr.': 'OL233499A', 'Jonathan Swift': 'OL24522A', 'Albert Einstein': 'OL3175986A',
  'Ta-Nehisi Coates': 'OL3379613A', 'Frederick Douglass': 'OL23684A', 'W. E. B. Du Bois': 'OL26460A', 'Oscar Wilde': 'OL20646A',
  'Bertrand Russell': 'OL112912A', 'John Stuart Mill': 'OL108289A', 'Virginia Woolf': 'OL19450A', 'William James': 'OL109602A',
  'Rabindranath Tagore': 'OL1770A', 'Bhagat Singh': 'OL4769985A', 'Robert Louis Stevenson': 'OL25963A', 'Joseph Conrad': 'OL19441A',
  'Edith Wharton': 'OL20188A', 'Mary Shelley': 'OL25342A', 'G. K. Chesterton': 'OL18524A', 'John Ruskin': 'OL20108A',
  'Walter Pater': 'OL10968A', 'Henry Fielding': 'OL18298A', 'Anthony Trollope': 'OL29698A', 'Victor Hugo': 'OL107571A',
  'Premchand': 'OL4683A', 'Guy de Maupassant': 'OL29388A', 'Kate Chopin': 'OL35183A', 'Charlotte Perkins Gilman': 'OL408063A',
  'Saki': 'OL591204A', 'Leo Tolstoy': 'OL26783A', 'Arnold Bennett': 'OL29586A', 'Thomas De Quincey': 'OL34278A',
  // no safe match on Open Library: Adam Mastroianni, Paul Graham, Tim Urban, Ken Thompson, Scott Alexander, Samuel Johnson, Anton Chekhov
}

export const slug = (s) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

const data = JSON.parse(readFileSync(new URL('../../src/data/essays.json', import.meta.url), 'utf8'))
const names = [...new Set(data.themes.flatMap((t) => t.items.map((e) => e.author)))].sort()
const out = {}
let bad = 0
for (const name of names) {
  const key = KEYS[name] ?? null
  if (key) {
    const ok = await fetch(`https://openlibrary.org/authors/${key}.json`).then((r) => r.ok).catch(() => false)
    if (!ok) { console.log('NOT FOUND', name, key); bad++ }
  }
  out[name] = { key, slug: slug(name) }
}
for (const k of Object.keys(KEYS)) if (!names.includes(k)) { console.log('unused name', k); bad++ }
writeFileSync(new URL('./authors.json', import.meta.url), JSON.stringify(out, null, 2) + '\n')
console.log(`${names.length} authors, ${names.filter((n) => out[n].key).length} on Open Library, ${names.filter((n) => !out[n].key).length} with their own page${bad ? `, ${bad} problem(s)` : ''}`)
