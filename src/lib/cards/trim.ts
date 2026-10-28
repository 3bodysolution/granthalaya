// A plain white frame around a shop's cover (Akshardhara's template: a white mat with the picture inset and "www.akshardhara.com"
// under it) is trimmed away, so the cover fills its space. The picture itself is never cut into:
//   · trimming only happens when the picture is a solid rectangle (its top, bottom, left and right edges are picture, not white)
//     sitting inside a white frame, so a white design, or a cover with white parts inside, is left exactly as it is;
//   · only whole rows and columns of white are removed from the outside, and a small, thin band of text under the picture
//     (the shop's address) when a clear white gap separates it from the picture;
//   · anything that doesn't look like exactly that is returned untouched (null).
import sharp from 'sharp';

const WHITE = 244;        // a pixel with every colour at or above this counts as white
const NOISE = 0.01;       // a row or column with at most this share of non-white pixels counts as empty
const EDGE = 0.9;         // an edge of the picture must be at least this much non-white
const MIN_FRAME = 0.03;   // there must be a frame at least this wide (share of the side) on some side, or there is nothing to gain
const FOOTER = 0.1;       // the text under the picture is at most this much of the height
const FOOTER_INK = 0.35;  // and at most this dense (text on white)

type Run = [number, number];
const runs = (full: (i: number) => boolean, n: number): Run[] => {
  const out: Run[] = [];
  for (let i = 0, from = -1; i <= n; i++) {
    const on = i < n && full(i);
    if (on && from < 0) from = i;
    if (!on && from >= 0) { out.push([from, i - 1]); from = -1; }
  }
  return out;
};

export interface Trimmed { body: Buffer; type: 'image/jpeg'; box: { left: number; top: number; width: number; height: number }; from: { width: number; height: number } }

/** the cover without its white frame, or null when it has none (or isn't framed in the plain way described above) */
export async function trimFrame(src: Buffer): Promise<Trimmed | null> {
  const { data, info } = await sharp(src, { failOn: 'none' }).flatten({ background: '#ffffff' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h, channels: c } = info;
  const ink = (x: number, y: number) => { const i = (y * w + x) * c; return data[i] < WHITE || data[i + 1] < WHITE || data[i + 2] < WHITE; };
  const rowInk = new Array<number>(h).fill(0);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (ink(x, y)) rowInk[y]++;
  const bands = runs((y) => rowInk[y] > w * NOISE, h);
  if (!bands.length) return null;

  // the picture is the tallest band; only a small band of text below it may be dropped, nothing above it
  const main = bands.reduce((a, b) => (b[1] - b[0] > a[1] - a[0] ? b : a));
  const after = bands.filter((b) => b[0] > main[1]);
  if (bands.some((b) => b[1] < main[0])) return null;
  const [y0, y1] = main;
  const colInk = new Array<number>(w).fill(0);
  for (let y = y0; y <= y1; y++) for (let x = 0; x < w; x++) if (ink(x, y)) colInk[x]++;
  const cols = runs((x) => colInk[x] > (y1 - y0 + 1) * NOISE, w);
  if (!cols.length) return null;
  if (cols.some((c, i) => i && c[0] - cols[i - 1][1] - 1 >= w * 0.02)) return null;   // two pictures side by side (a set), not one framed cover
  const x0 = cols[0][0], x1 = cols[cols.length - 1][1];
  const bw = x1 - x0 + 1, bh = y1 - y0 + 1;

  // the text under the picture: small, thin and apart
  let footerInk = 0;
  for (const [a, b] of after) for (let y = a; y <= b; y++) footerInk += rowInk[y];
  const footerRows = after.length ? after[after.length - 1][1] - after[0][0] + 1 : 0;
  if (after.length && (footerRows > h * FOOTER || footerInk > footerRows * bw * FOOTER_INK || after[0][0] - y1 < h * 0.015)) return null;

  // the picture's four edges must be picture all the way along (a solid rectangle), not a design that happens to be pale
  const edge = (cells: number, at: (i: number) => boolean) => { let n = 0; for (let i = 0; i < cells; i++) if (at(i)) n++; return n / cells >= EDGE; };
  const mid = (a: number, b: number) => Math.min(b, a + 1);
  const solid = edge(bw, (i) => ink(x0 + i, mid(y0, y1))) && edge(bw, (i) => ink(x0 + i, Math.max(y0, y1 - 1)))
    && edge(bh, (i) => ink(mid(x0, x1), y0 + i)) && edge(bh, (i) => ink(Math.max(x0, x1 - 1), y0 + i));
  if (!solid) return null;

  // there has to be a real frame to take off, and what is left has to be most of the image
  const frame = Math.max(x0 / w, (w - 1 - x1) / w, y0 / h, (h - 1 - y1) / h);
  const footer = after.length ? 1 : 0;
  if (frame < MIN_FRAME && !footer) return null;
  if ((bw * bh) / (w * h) < 0.35) return null;
  if (bw / bh < 0.5 || bw / bh > 0.85) return null;   // a book cover stands upright; anything else (two books in one picture) is left alone

  const box = { left: x0, top: y0, width: bw, height: bh };
  const body = await sharp(src, { failOn: 'none' }).flatten({ background: '#ffffff' }).extract(box).jpeg({ quality: 90, mozjpeg: true }).toBuffer();
  return { body, type: 'image/jpeg', box, from: { width: w, height: h } };
}
