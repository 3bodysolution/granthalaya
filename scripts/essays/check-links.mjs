// Checks every <link> in docs/essay-candidates.md and marks the dead ones.
// Run: node scripts/essays/check-links.mjs
// Marks: "⚠ DEAD (status)" for 404/410/5xx/no answer, "⚠ CHECK (status)" when the site refused the check (401/403/429).
import { readFileSync, writeFileSync } from 'node:fs'

const FILE = new URL('../../docs/essay-candidates.md', import.meta.url)
const UA = 'GranthalayaLinkCheck/1.0 (+https://granthalaya.vercel.app; checking essay links)'
const MARK = / ⚠ (DEAD|CHECK) \([^)]*\)$/

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function probe(url) {
  for (const method of ['HEAD', 'GET']) {
    try {
      const res = await fetch(url, {
        method,
        redirect: 'follow',
        headers: { 'user-agent': UA, accept: 'text/html,*/*' },
        signal: AbortSignal.timeout(20000),
      })
      if (res.status < 400) return { ok: true, status: res.status }
      // Some servers reject HEAD; try GET before judging.
      if (method === 'HEAD') continue
      return { ok: false, status: res.status }
    } catch (e) {
      if (method === 'GET') return { ok: false, status: e.name === 'TimeoutError' ? 'timeout' : 'no answer' }
    }
  }
  return { ok: false, status: 'no answer' }
}

const lines = readFileSync(FILE, 'utf8').split('\n')
const dead = []
const check = []
let total = 0

for (let i = 0; i < lines.length; i++) {
  lines[i] = lines[i].replace(MARK, '')
  const m = lines[i].match(/^- \[[ x]\] .*?<(https?:\/\/[^>]+)>/)
  if (!m) continue
  total++
  const r = await probe(m[1])
  if (!r.ok) {
    const refused = [401, 403, 429].includes(r.status)
    lines[i] += ` ⚠ ${refused ? 'CHECK' : 'DEAD'} (${r.status})`
    ;(refused ? check : dead).push(lines[i].match(/\*\*(.*?)\*\*/)?.[1] ?? m[1])
  }
  await sleep(700)
}

writeFileSync(FILE, lines.join('\n'))
console.log(`${total} links checked. ${dead.length} dead, ${check.length} refused the check.`)
if (dead.length) console.log('Dead:\n- ' + dead.join('\n- '))
if (check.length) console.log('Refused (look by hand):\n- ' + check.join('\n- '))
