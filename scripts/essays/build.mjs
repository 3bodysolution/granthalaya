// Builds src/data/essays.json from the ticked lines of docs/essay-candidates.md.
// Run: node scripts/essays/build.mjs
// Only ticked lines count. Line format:
//   - [x] **Title** · Author · Publication · Year · <url> · note
import { readFileSync, writeFileSync } from 'node:fs'

const SRC = new URL('../../docs/essay-candidates.md', import.meta.url)
const OUT = new URL('../../src/data/essays.json', import.meta.url)

const blank = (s) => (!s || s.trim() === '?' || /^(publication|year) \?$/.test(s.trim()) ? null : s.trim())

const themes = []
let theme = null
for (const line of readFileSync(SRC, 'utf8').split('\n')) {
  const h = line.match(/^## (.+)/)
  if (h) {
    theme = { name: h[1].trim(), items: [] }
    themes.push(theme)
    continue
  }
  const m = line.match(/^- \[x\] \*\*(.+?)\*\* · (.+?) · (.+?) · (.+?) · <(https?:\/\/[^>]+)> · (.*)$/)
  if (!m || !theme) continue
  const [, title, author, publication, year, link, rest] = m
  const note = rest.replace(/ ⚠ (DEAD|CHECK) \([^)]*\)$/, '').replace(/ \(check\)$/, '').trim()
  const y = parseInt(year, 10)
  theme.items.push({
    title,
    author: author.trim(),
    publication: blank(publication),
    year: Number.isFinite(y) ? y : null,
    link,
    note,
    ...(theme.name === 'Found via Read Something Great' ? { via: 'Read Something Great' } : {}),
  })
}

const data = {
  source: { name: 'Read Something Great', url: 'https://readsomethinggreat.com' },
  themes: themes.filter((t) => t.items.length),
}
writeFileSync(OUT, JSON.stringify(data, null, 2) + '\n')
console.log(data.themes.map((t) => `${t.name}: ${t.items.length}`).join('\n'))
console.log('Total', data.themes.reduce((n, t) => n + t.items.length, 0))
