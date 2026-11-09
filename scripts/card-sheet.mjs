// Draws share cards for ten varied titles from a running dev server, in both sizes (tall story card, wide link preview), puts them in
// one contact sheet and checks the text contrast on each:
//   node scripts/card-sheet.mjs [port] [out folder]
// Contrast: the card is drawn again with its text hidden (the background alone), and the pixels under each text box are compared with
// the colour of the text drawn there (the brightest 2% of the background counts, so a bright speck can't hide a failure).
import sharp from 'sharp';
import fs from 'node:fs';
const port = process.argv[2] || '4321', out = process.argv[3] || '.shots/cards-blur';
fs.mkdirSync(out, { recursive: true });
const base = `http://localhost:${port}`;
const TITLES = [
  ['bright poster (Barbie)', 'film/346698-barbie'],
  ['dark poster (The Batman)', 'film/414906-the-batman'],
  ['bright film (Amelie)', 'film/194-amelie'],
  ['TV show (Dark)', 'tv/70523-dark'],
  ['TV show (Breaking Bad)', 'tv/1396-breaking-bad'],
  ['book, mostly white cover', null, 'https://covers.openlibrary.org/b/isbn/9780374533557-L.jpg'],
  ['book, no cover (Mirasadari)', 'book/ol322826w-mirasadari'],
  ['Marathi shop book (Shodh)', 'book/shodh'],
  ['Marathi shop book (Ek hota carver)', 'book/ek-hota-carver'],
  ['no cover (shelf sample)', null],
];
const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
// where text sits (x, y, w, h) and its colour: tall card 1080x1920, wide card 1200x630
const TALL = [[60, 1250, 960, 400, '#CFC8BA'], [60, 1250, 960, 300, '#F4ECDD'], [0, 1710, 1080, 100, '#CFC8BA']];
const WIDE = [[64, 70, 640, 400, '#F4ECDD'], [64, 480, 640, 80, '#CFC8BA']];
async function worst(buf, boxes, w, h) {
  const results = [];
  for (const [x, y, bw, bh, col] of boxes) {
    const { data } = await sharp(buf).extract({ left: x, top: y, width: Math.min(bw, w - x), height: Math.min(bh, h - y) }).resize(80).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const ls = []; for (let i = 0; i < data.length; i += 3) ls.push(lum([data[i], data[i + 1], data[i + 2]]));
    ls.sort((a, b) => a - b);
    const bright = ls[Math.floor(ls.length * 0.98)];
    const t = lum(hex(col));
    results.push((t + 0.05) / (bright + 0.05));
  }
  return Math.min(...results);
}
const get = async (path) => { const r = await fetch(base + path); if (!r.ok) throw new Error(`${path}: ${r.status}`); return Buffer.from(await r.arrayBuffer()); };
const rows = [];
let failed = 0;
for (const [label, p, cov] of TITLES) {
  const q = cov ? `&cover=${encodeURIComponent(cov)}` : '';
  let tall, wide;
  try {
    tall = p ? await get(`/story/${p}.png`) : await get(`/cards/story-sample.png?kind=book${q}`);
    wide = p ? await get(`/og/${p}.png`) : await get(`/cards/preview-sample.png?x=1${q}`);
  } catch (e) { console.log(`${label}: ${e.message}`); rows.push({ label, error: true }); failed++; continue; }
  const tallBg = p ? await get(`/story/${p}.png?notext=1`) : await get(`/cards/story-sample.png?kind=book&notext=1${q}`);
  const wideBg = p ? await get(`/og/${p}.png?notext=1`) : await get(`/cards/preview-sample.png?notext=1${q}`);
  rows.push({ label, tall, wide, tallBg, wideBg });
}
const TW = 270, TH = 480, WW = 480, WH = 252, G = 12;
const sheet = [];
let y = 0;
const labels = [];
for (const r of rows) {
  if (r.error) continue;
  sheet.push({ input: await sharp(r.tall).resize(TW, TH).toBuffer(), left: 0, top: y });
  sheet.push({ input: await sharp(r.wide).resize(WW, WH).toBuffer(), left: TW + G, top: y });
  const tc = await worst(r.tallBg, TALL, 1080, 1920);
  const wc = await worst(r.wideBg, WIDE, 1200, 630);
  labels.push(`${tc >= 4.5 && wc >= 4.5 ? 'ok  ' : 'LOW '}${r.label}: story ${tc.toFixed(1)}:1, preview ${wc.toFixed(1)}:1`);
  if (tc < 4.5 || wc < 4.5) failed++;
  fs.writeFileSync(`${out}/${labels.length}-story.jpg`, r.tall); fs.writeFileSync(`${out}/${labels.length}-preview.jpg`, r.wide);
  y += TH + G;
}
await sharp({ create: { width: TW + G + WW, height: y - G, channels: 3, background: '#222' } }).composite(sheet).png().toFile(`${out}/contact-sheet.png`);
console.log(labels.join('\n'));
console.log('saved', `${out}/contact-sheet.png`);
process.exit(failed ? 1 : 0);
