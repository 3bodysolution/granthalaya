// Draws a story card on every background (from a running dev server) and puts them in one picture:
//   node scripts/card-sheet.mjs [port] [out.png]
import sharp from 'sharp';
const port = process.argv[2] || '4321', out = process.argv[3] || '.shots/batch4/backgrounds-sheet.png';
const bgs = ['cinema', 'fair', 'fields', 'forest', 'fort', 'noir', 'rain', 'reading', 'sea', 'stars', 'wada'];
const covers = ['f89U3ADr1oiB1s9GkdPOEpXUk5H', 'tlm8UkiQsitc8rSuIAscQDCnP8d'];
const W = 360, H = 640, GAP = 12, COLS = 6;
const tiles = [];
for (const [i, bg] of bgs.entries()) {
  const r = await fetch(`http://localhost:${port}/cards/story-sample.png?bg=${bg}&cover=https://image.tmdb.org/t/p/w500/${covers[0]}.jpg`);
  if (!r.ok) throw new Error(`${bg}: ${r.status}`);
  tiles.push({ input: await sharp(Buffer.from(await r.arrayBuffer())).resize(W, H).toBuffer(), left: (i % COLS) * (W + GAP), top: Math.floor(i / COLS) * (H + GAP) });
}
await sharp({ create: { width: COLS * (W + GAP) - GAP, height: 2 * (H + GAP) - GAP, channels: 3, background: '#222' } }).composite(tiles).png().toFile(out);
console.log('saved', out);
