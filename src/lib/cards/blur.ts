// Card backgrounds: the title's own poster or cover, scaled to fill the card and blurred heavily, with a little more colour, a soft
// vignette, fine grain and a dark gradient behind the text. satori can't blur, so sharp does it before the card is drawn, and the
// finished background is kept in memory per picture and size. A title with no cover gets a soft two-colour gradient (warm palette).
import { mark } from '../timing';

export type Shape = 'tall' | 'wide';
/** a bright poster must still leave every piece of text 4.5:1, so the dark gradient is strong where the text is */
const SHADE: Record<Shape, string> = {
  // text sits between 55% and 90% of the height: dark there, lighter above where the poster's colours show through
  tall: `<stop offset="0" stop-color="#0c0c0f" stop-opacity=".30"/><stop offset=".45" stop-color="#0c0c0f" stop-opacity=".55"/><stop offset=".62" stop-color="#0c0c0f" stop-opacity=".84"/><stop offset="1" stop-color="#0c0c0f" stop-opacity=".94"/>`,
  wide: ``,
};

const kept = new Map<string, string>();
const remember = (key: string, v: string) => { kept.set(key, v); if (kept.size > 24) kept.delete(kept.keys().next().value!); return v; };

/** fine grain: a grey noise layer at low strength (made once per size) */
const grains = new Map<string, Buffer>();
function grain(w: number, h: number): Buffer {
  const key = `${w}x${h}`;
  let g = grains.get(key);
  if (!g) {
    g = Buffer.alloc(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      const v = Math.random() < 0.5 ? 0 : 255;
      g[i * 4] = g[i * 4 + 1] = g[i * 4 + 2] = v;
      g[i * 4 + 3] = 7;          // about 3% strength
    }
    grains.clear();              // only one size at a time is worth keeping
    grains.set(key, g);
  }
  return g;
}

/** overlays drawn as one SVG: the vignette, then the dark gradient behind the text */
function overlay(w: number, h: number, shape: Shape): Buffer {
  const text = shape === 'tall'
    ? `<linearGradient id="s" x1="0" y1="0" x2="0" y2="1">${SHADE.tall}</linearGradient><rect width="${w}" height="${h}" fill="url(#s)"/>`
    // link preview: the text is on the left, so the dark is on the left and fades out under the poster on the right
    : `<linearGradient id="s" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#0c0c0f" stop-opacity=".93"/><stop offset=".5" stop-color="#0c0c0f" stop-opacity=".88"/><stop offset=".75" stop-color="#0c0c0f" stop-opacity=".5"/><stop offset="1" stop-color="#0c0c0f" stop-opacity=".3"/></linearGradient><rect width="${w}" height="${h}" fill="url(#s)"/>`;
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
    <defs><radialGradient id="v" cx=".5" cy=".5" r=".75"><stop offset=".55" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".45"/></radialGradient></defs>
    <rect width="${w}" height="${h}" fill="url(#v)"/>${text}</svg>`);
}

/** the warm pairs used when a title has no cover; chosen from the title so the same title always gets the same one */
const WARM: [string, string][] = [
  ['#7a3b2e', '#c98b4f'], ['#6b3a4a', '#d28f6e'], ['#7d5a2b', '#d9b36a'], ['#5d4636', '#c4875a'],
  ['#8a4a35', '#e0a96d'], ['#6f4b3a', '#b9735b'], ['#74503a', '#cf9a5b'], ['#6a3f3a', '#c97f62'],
];
const pairFor = (seed: string) => { let n = 0; for (const c of seed) n = (n * 31 + c.charCodeAt(0)) >>> 0; return WARM[n % WARM.length]; };

/**
 * The card's background as a JPEG data address.
 * `cover`: the poster as a data address (or nothing); `seed`: any text that stays the same for a title (used for the gradient and the cache).
 */
export async function blurredBackground(cover: string | undefined, seed: string, w: number, h: number, shape: Shape): Promise<string> {
  const key = `${shape}|${w}x${h}|${cover ? `${cover.length}:${cover.slice(-48)}` : `gradient:${seed}`}`;
  const hit = kept.get(key);
  if (hit) { mark('background', 0, 'memory'); return hit; }
  const t = performance.now();
  const { default: sharp } = await import('sharp');
  let base;
  if (cover) {
    const src = Buffer.from(cover.slice(cover.indexOf(',') + 1), 'base64');
    // blur on a small copy (the blur is the same to the eye and far cheaper), then scale up: a blur of 3% of the card width
    const sw = Math.max(48, Math.round(w / 6)), sh = Math.round(sw * h / w);
    const small = await sharp(src).resize(sw, sh, { fit: 'cover' }).blur(Math.max(1, sw * 0.03)).modulate({ saturation: 1.25, brightness: 0.92 }).toBuffer();
    base = sharp(small).resize(w, h, { kernel: 'cubic' });
  } else {
    const [a, b] = pairFor(seed);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="${w}" height="${h}" fill="url(#g)"/></svg>`;
    base = sharp(Buffer.from(svg));
  }
  const out = await base
    .composite([{ input: overlay(w, h, shape), top: 0, left: 0 }, { input: grain(w, h), raw: { width: w, height: h, channels: 4 }, top: 0, left: 0 }])
    .removeAlpha().jpeg({ quality: 78 }).toBuffer();
  mark('background', performance.now() - t, cover ? 'blurred' : 'gradient');
  return remember(key, `data:image/jpeg;base64,${out.toString('base64')}`);
}
