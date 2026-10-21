// The story card: one title on a tall card (1080x1920) for Instagram and WhatsApp stories.
// Drawn with satori (layout) and resvg (pixels). Fonts and the painting are our own files in src/assets/cards,
// built into the code.
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import { paletteFor } from '../data';
import type { Kind } from '../kinds';

export interface StoryData {
  kind: Kind;
  title: string;
  year?: number;
  creator?: string;
  season?: number;
  rating?: number;         // 0.5 to 5
  loved?: boolean;         // essays
  status: string;          // "Watched", "Read" ...
  line?: string;           // a saved line or the start of a note
  owner: string;           // username
  cover?: string;          // address of the cover image
  color?: string;          // painted cover colour when there's no image
}

const W = 1080, H = 1920;
const BG = '#121316', CREAM = '#F4ECDD', GOLD = '#E4BE94', TEAL = '#6CC9BF', GREY = '#A39D92', DIM = '#8D877D';

/* ——— fonts and the painting are built into the function (?inline makes them part of the code), so nothing is fetched at run time ——— */
import fraunces700 from '../../assets/cards/fraunces-latin-700-normal.woff?inline';
import fraunces700x from '../../assets/cards/fraunces-latin-ext-700-normal.woff?inline';
import fraunces400i from '../../assets/cards/fraunces-latin-400-italic.woff?inline';
import fraunces400ix from '../../assets/cards/fraunces-latin-ext-400-italic.woff?inline';
import sans400 from '../../assets/cards/instrument-sans-latin-400-normal.woff?inline';
import sans400x from '../../assets/cards/instrument-sans-latin-ext-400-normal.woff?inline';
import deva700 from '../../assets/cards/noto-serif-devanagari-devanagari-700-normal.woff?inline';
import deva400 from '../../assets/cards/noto-serif-devanagari-devanagari-400-normal.woff?inline';
import paintingNight from '../../assets/cards/painting-night.jpg?inline';
const bytes = (dataUri: string) => Buffer.from(dataUri.slice(dataUri.indexOf(',') + 1), 'base64');
const FONTS = [
  { name: 'Fraunces', data: bytes(fraunces700), weight: 700, style: 'normal' },
  { name: 'Fraunces Ext', data: bytes(fraunces700x), weight: 700, style: 'normal' },
  { name: 'Fraunces', data: bytes(fraunces400i), weight: 400, style: 'italic' },
  { name: 'Fraunces Ext', data: bytes(fraunces400ix), weight: 400, style: 'italic' },
  { name: 'Instrument Sans', data: bytes(sans400), weight: 400, style: 'normal' },
  { name: 'Instrument Sans Ext', data: bytes(sans400x), weight: 400, style: 'normal' },
  // Devanagari: the Latin fonts have none, so these fill in letter by letter. Used upright even where the text is italic.
  { name: 'Noto Serif Devanagari', data: bytes(deva700), weight: 700, style: 'normal' },
  { name: 'Noto Serif Devanagari', data: bytes(deva400), weight: 400, style: 'normal' },
  { name: 'Noto Serif Devanagari', data: bytes(deva400), weight: 400, style: 'italic' },
];

/** a cover image as a data address satori can draw; only our two cover hosts, and only PNG or JPEG */
async function coverData(src?: string) {
  if (!src) return undefined;
  try {
    const u = new URL(src, 'https://x.invalid');
    if (!['image.tmdb.org', 'covers.openlibrary.org'].includes(u.hostname)) return undefined;
    // the card is big: ask for the larger picture
    if (u.hostname === 'image.tmdb.org') u.pathname = u.pathname.replace(/\/t\/p\/w\d+\//, '/t/p/w500/');
    if (u.hostname === 'covers.openlibrary.org') u.pathname = u.pathname.replace(/-[SM]\.jpg$/, '-L.jpg');
    const r = await fetch(u, { signal: AbortSignal.timeout(5000), headers: { 'User-Agent': 'Granthalaya/1.0 (share card)' } });
    if (!r.ok) return undefined;
    const b = Buffer.from(await r.arrayBuffer());
    if (b.length > 4_000_000) return undefined;
    const type = b[0] === 0xff && b[1] === 0xd8 ? 'jpeg' : b[0] === 0x89 && b[1] === 0x50 ? 'png' : undefined;
    return type ? `data:image/${type};base64,${b.toString('base64')}` : undefined;
  } catch { return undefined; }
}

/* ——— tiny element helpers (satori takes plain objects) ——— */
type Node = { type: string; props: Record<string, unknown> };
const h = (type: string, style: Record<string, unknown>, children?: unknown, extra: Record<string, unknown> = {}): Node =>
  ({ type, props: { ...extra, style: { display: 'flex', ...style }, children } });
const star = (fill: 0 | 0.5 | 1, color: string) => ({
  type: 'svg', props: {
    width: 58, height: 58, viewBox: '0 0 24 24', xmlns: 'http://www.w3.org/2000/svg',
    children: [
      { type: 'defs', props: { children: { type: 'linearGradient', props: { id: 'g', x1: '0', x2: '1', y1: '0', y2: '0', children: [
        { type: 'stop', props: { offset: '50%', 'stop-color': color } },
        { type: 'stop', props: { offset: '50%', 'stop-color': 'rgba(255,255,255,.2)' } },
      ] } } } },
      { type: 'path', props: { d: 'M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3 6.1 20.6l1.3-6.6L2.5 9.4l6.6-.8z', fill: fill === 1 ? color : fill === 0.5 ? 'url(#g)' : 'rgba(255,255,255,.2)', 'stroke-linejoin': 'round' } },
    ],
  },
});
// each family is tried letter by letter: Latin, then Latin with marks (macrons, dots), then Devanagari
const SERIF = 'Fraunces, Fraunces Ext, Noto Serif Devanagari';
const SANS = 'Instrument Sans, Instrument Sans Ext, Noto Serif Devanagari';
const cut = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, '') + '…' : s);

export async function drawStory(d: StoryData): Promise<Buffer> {
  const film = d.kind === 'film' || d.kind === 'tv';
  const accent = film ? TEAL : GOLD;
  const titleColor = film ? CREAM : GOLD;
  const cover = await coverData(d.cover);

  const title = cut(d.title, 70);
  const size = title.length <= 14 ? 84 : title.length <= 26 ? 70 : title.length <= 44 ? 58 : 48;
  const by = d.kind === 'film' ? 'directed by' : d.kind === 'tv' ? 'created by' : 'by';
  const meta = [d.year, d.kind === 'tv' && d.season ? `season ${d.season}` : '', d.creator ? `${by} ${d.creator}` : ''].filter(Boolean).join(' | ');
  const full = d.rating == null ? 0 : Math.floor(d.rating), half = d.rating != null && d.rating % 1 >= 0.5;

  const p = paletteFor(d.title, d.color);
  const CW = 420, CH = 630;
  const coverBox = h('div', {
    position: 'absolute', left: (W - CW) / 2, top: 540, width: CW, height: CH, borderRadius: 8, overflow: 'hidden',
    border: '2px solid rgba(255,255,255,.2)', boxShadow: '0 30px 60px rgba(0,0,0,.55)', background: p.bg,
  }, cover
    ? { type: 'img', props: { src: cover, width: CW, height: CH, style: { width: CW, height: CH, objectFit: 'cover' } } }
    : [
      h('div', { position: 'absolute', left: 0, right: 0, bottom: 0, height: 170, background: p.hill }),
      h('div', { position: 'absolute', left: 36, right: 36, top: 60, fontSize: 52, lineHeight: 1.15, color: '#F6EEDF', fontFamily: SERIF, fontWeight: 700 }, cut(d.title, 40)),
    ]);

  const root = h('div', { width: W, height: H, background: BG, flexDirection: 'column', alignItems: 'center', position: 'relative' }, [
    { type: 'img', props: { src: paintingNight, width: W, height: 700, style: { position: 'absolute', left: 0, top: 0, width: W, height: 700 } } },
    // melts the painting into the card, the way the site's paintings melt into the page
    h('div', { position: 'absolute', left: 0, top: 380, width: W, height: 320, background: `linear-gradient(to bottom, rgba(18,19,22,0), ${BG})` }),
    coverBox,
    h('div', { position: 'absolute', left: 60, right: 60, top: 1210, flexDirection: 'column', alignItems: 'center' }, [
      h('div', { fontSize: size, lineHeight: 1.12, color: titleColor, fontFamily: SERIF, fontWeight: 700, textAlign: 'center', justifyContent: 'center' }, title),
      meta ? h('div', { marginTop: 18, fontSize: 34, color: GREY, fontFamily: SANS, textAlign: 'center', justifyContent: 'center' }, meta) : null,
      h('div', { marginTop: 34, alignItems: 'center', gap: 22 }, [
        d.loved && d.kind === 'essay'
          ? h('div', { fontSize: 40, color: accent, fontFamily: SANS }, '♥ Loved')
          : full || half
            ? h('div', { gap: 6 }, [...Array(full).fill(1), ...(half ? [0.5] : [])].map((f) => star(f as 1 | 0.5, accent)))
            : null,
        h('div', { padding: '8px 24px', borderRadius: 999, background: 'rgba(255,255,255,.1)', fontSize: 28, color: '#C9C2B4', fontFamily: SANS }, d.status),
      ].filter(Boolean)),
      d.line ? h('div', { marginTop: 40, fontSize: 46, lineHeight: 1.3, color: CREAM, fontStyle: 'italic', fontFamily: SERIF, textAlign: 'center', justifyContent: 'center' }, `“${cut(d.line, 120)}”`) : null,
      h('div', { marginTop: 56, fontSize: 25, letterSpacing: 7, color: DIM, fontFamily: SANS }, `@${d.owner} ON GRANTHALAYA`.toUpperCase()),
    ].filter(Boolean)),
  ]);

  const svg = await satori(root as never, { width: W, height: H, fonts: FONTS as never });
  return new Resvg(svg, { fitTo: { mode: 'width', value: W } }).render().asPng();
}
