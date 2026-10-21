// From a drawn card (satori's SVG) to the picture we send: JPEG (a 1080x1920 story card as a PNG was 2 to 3 MB).
// resvg paints the pixels at the width asked for (a half-size preview is cheaper to draw), sharp packs them.
import { Resvg } from '@resvg/resvg-js';
import { mark } from '../timing';

export interface Picture { body: Buffer; type: 'image/jpeg' | 'image/png' }

export async function render(svg: string, width: number, quality = 80): Promise<Picture> {
  const t = performance.now();
  try {
    const img = new Resvg(svg, { fitTo: { mode: 'width', value: width } }).render();
    mark('pixels', performance.now() - t, `${width} wide`);
    try {
      const { default: sharp } = await import('sharp');
      const t2 = performance.now();
      const body = await sharp(img.pixels, { raw: { width: img.width, height: img.height, channels: 4 } }).removeAlpha().jpeg({ quality }).toBuffer();
      mark('jpeg', performance.now() - t2);
      return { body, type: 'image/jpeg' };
    } catch (e) {
      console.error('JPEG packing failed, sending a PNG', e);
      return { body: img.asPng(), type: 'image/png' };
    }
  } finally { mark('packing', performance.now() - t, `${width} wide`); }
}

/** a picture as a response; `cache` is the Cache-Control value */
export const picture = (p: Picture, cache: string, extra: Record<string, string> = {}) => new Response(p.body, { headers: { 'Content-Type': p.type, 'Cache-Control': cache, ...extra } });

/** the answer when a title's cover could not be fetched in time: no card (it would carry a placeholder), and nothing kept, so the next ask tries again */
export const coverSlow = () => new Response('The cover is slow. Try again.', { status: 503, headers: { 'Cache-Control': 'no-store', 'Retry-After': '2' } });

/** wait for a promise, but only so long: after `ms` the fallback is used instead (the promise carries on unwatched) */
export function within<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([p.catch(() => fallback), new Promise<T>((res) => setTimeout(() => res(fallback), ms))]);
}
