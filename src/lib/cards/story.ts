// The story card: one title on a tall card (1080x1920) for Instagram and WhatsApp stories.
// Drawn with satori (layout) and resvg (pixels). Fonts and the painting are our own files in src/assets/cards,
// built into the code.
import satori from 'satori';
import { mark } from '../timing';
import { render, type Picture } from './output';
import { paletteFor } from '../data';
import type { Kind } from '../kinds';
import { backgroundData, baseColor, PAINT_H, type Background } from './backgrounds';

export interface StoryData {
  kind: Kind;
  title: string;
  year?: number;
  creator?: string;
  season?: number;
  rating?: number;         // 0.5 to 5
  loved?: boolean;         // essays
  status: string;          // "Watched", "Read" ...
  line?: string;           // the title's short line, or the owner's own line or a saved Line
  owner: string;           // username
  cover?: string;          // address of the cover image
  color?: string;          // painted cover colour when there's no image
  bg?: Background;         // the painting behind the card
}

export const W = 1080, H = 1920;
export const SITE = 'granthalaya-sarthak.vercel.app';   // printed small on the card; Instagram can't link a story
export const BG = '#121316', CREAM = '#F4ECDD', GOLD = '#E4BE94', TEAL = '#6CC9BF', GREY = '#A39D92', DIM = '#8D877D';

/* ——— fonts and the painting are built into the function (?inline makes them part of the code), so nothing is fetched at run time ——— */
import fraunces700 from '../../assets/cards/fraunces-latin-700-normal.woff?inline';
import fraunces700x from '../../assets/cards/fraunces-latin-ext-700-normal.woff?inline';
import fraunces400i from '../../assets/cards/fraunces-latin-400-italic.woff?inline';
import fraunces400ix from '../../assets/cards/fraunces-latin-ext-400-italic.woff?inline';
import sans400 from '../../assets/cards/instrument-sans-latin-400-normal.woff?inline';
import sans400x from '../../assets/cards/instrument-sans-latin-ext-400-normal.woff?inline';
import deva700 from '../../assets/cards/noto-serif-devanagari-devanagari-700-normal.woff?inline';
import deva400 from '../../assets/cards/noto-serif-devanagari-devanagari-400-normal.woff?inline';
const fontsFrom = performance.now();
const bytes = (dataUri: string) => Buffer.from(dataUri.slice(dataUri.indexOf(',') + 1), 'base64');
export const FONTS = [
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

export const fontsMs = performance.now() - fontsFrom;   // decoding the fonts, once per start-up

/** a cover image as a data address satori can draw; only our two cover hosts, and only PNG or JPEG.
 *  `big` asks for the larger picture; it gives up after 2.5 seconds (the card then shows the painted placeholder). */
export async function coverData(src?: string, big = true) {
  if (!src) return undefined;
  const t = performance.now();
  try {
    const u = new URL(src, 'https://x.invalid');
    if (!['image.tmdb.org', 'covers.openlibrary.org'].includes(u.hostname)) return undefined;
    // the card is big: ask for the larger picture
    if (u.hostname === 'image.tmdb.org') u.pathname = u.pathname.replace(/\/t\/p\/w\d+\//, big ? '/t/p/w500/' : '/t/p/w342/');
    if (u.hostname === 'covers.openlibrary.org') u.pathname = u.pathname.replace(/-[SML]\.jpg$/, big ? '-L.jpg' : '-M.jpg');
    const r = await fetch(u, { signal: AbortSignal.timeout(2500), headers: { 'User-Agent': 'Granthalaya/1.0 (share card)' } });
    if (!r.ok) return undefined;
    const b = Buffer.from(await r.arrayBuffer());
    if (b.length > 4_000_000) return undefined;
    const type = b[0] === 0xff && b[1] === 0xd8 ? 'jpeg' : b[0] === 0x89 && b[1] === 0x50 ? 'png' : undefined;
    return type ? `data:image/${type};base64,${b.toString('base64')}` : undefined;
  } catch { return undefined; } finally { mark('poster', performance.now() - t, big ? 'large' : 'small'); }
}

/** a soft shadow under a box without a blur (a real blur cost over a second per card): a few wider, fainter layers */
export const softShadow = (left: number, top: number, w: number, hgt: number, radius = 8, dy = 18) =>
  [36, 24, 14, 6].map((grow, i) => h('div', { position: 'absolute', left: left - grow, top: top - grow + dy, width: w + grow * 2, height: hgt + grow * 2, borderRadius: radius + grow, background: `rgba(0,0,0,${[0.08, 0.1, 0.12, 0.16][i]})` }, ''));

/** the painting, timed */
export async function timedPainting(key: Background) {
  const t = performance.now();
  try { return await backgroundData(key); } finally { mark('painting', performance.now() - t, key); }
}

/* ——— tiny element helpers (satori takes plain objects) ——— */
export type Node = { type: string; props: Record<string, unknown> };
export const h = (type: string, style: Record<string, unknown>, children?: unknown, extra: Record<string, unknown> = {}): Node =>
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
export const SERIF = 'Fraunces, Fraunces Ext, Noto Serif Devanagari';
export const SANS = 'Instrument Sans, Instrument Sans Ext, Noto Serif Devanagari';
export const cut = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, '') + '…' : s);

/** `width` 1080 is the full card, 540 the half-size preview shown in the share window */
export async function drawStory(d: StoryData, width = W): Promise<Picture> {
  const film = d.kind === 'film' || d.kind === 'tv';
  const accent = film ? TEAL : GOLD;
  const titleColor = film ? CREAM : GOLD;
  const [cover, painting] = await Promise.all([coverData(d.cover, width >= W), timedPainting(d.bg ?? 'cinema')]);

  const title = cut(d.title, 70);
  const size = title.length <= 14 ? 72 : title.length <= 26 ? 60 : title.length <= 44 ? 50 : 42;
  const by = ({ film: 'directed by', tv: 'created by', book: 'by', essay: 'by' } as Record<Kind, string>)[d.kind];
  const meta = [d.year, d.kind === 'tv' && d.season ? `season ${d.season}` : '', d.creator ? `${by} ${d.creator}` : ''].filter(Boolean).join(' | ');
  const full = d.rating == null ? 0 : Math.floor(d.rating), half = d.rating != null && d.rating % 1 >= 0.5;

  // The top 30% (to 576) shows the painting uncovered; Instagram covers the top 13% with its own bar. The poster starts below that,
  // and text stays above 87% (1670).
  const p = paletteFor(d.title, d.color);
  const CW = 400, CH = 600, CT = 600;
  const coverBox = h('div', {
    position: 'absolute', left: (W - CW) / 2, top: CT, width: CW, height: CH, borderRadius: 8, overflow: 'hidden',
    border: '2px solid rgba(255,255,255,.2)', background: p.bg,
  }, cover
    ? { type: 'img', props: { src: cover, width: CW, height: CH, style: { width: CW, height: CH, objectFit: 'cover' } } }
    : [
      h('div', { position: 'absolute', left: 0, right: 0, bottom: 0, height: 150, background: p.hill }),
      h('div', { position: 'absolute', left: 32, right: 32, top: 56, fontSize: 46, lineHeight: 1.15, color: '#F6EEDF', fontFamily: SERIF, fontWeight: 700 }, cut(d.title, 40)),
    ]);

  const root = h('div', { width: W, height: H, background: baseColor(d.bg), flexDirection: 'column', alignItems: 'center', position: 'relative' }, [
    { type: 'img', props: { src: painting, width: W, height: PAINT_H, style: { position: 'absolute', left: 0, top: 0, width: W, height: PAINT_H } } },
    ...softShadow((W - CW) / 2, CT, CW, CH),
    coverBox,
    h('div', { position: 'absolute', left: 60, right: 60, top: CT + CH + 34, flexDirection: 'column', alignItems: 'center' }, [
      h('div', { fontSize: size, lineHeight: 1.12, color: titleColor, fontFamily: SERIF, fontWeight: 700, textAlign: 'center', justifyContent: 'center' }, title),
      meta ? h('div', { marginTop: 12, fontSize: 30, color: GREY, fontFamily: SANS, textAlign: 'center', justifyContent: 'center' }, meta) : null,
      h('div', { marginTop: 22, alignItems: 'center', gap: 22 }, [
        d.loved && d.kind === 'essay'
          ? h('div', { fontSize: 38, color: accent, fontFamily: SANS }, '♥ Loved')
          : full || half
            ? h('div', { gap: 6 }, [...Array(full).fill(1), ...(half ? [0.5] : [])].map((f) => star(f as 1 | 0.5, accent)))
            : null,
        h('div', { padding: '6px 22px', borderRadius: 999, background: 'rgba(255,255,255,.1)', fontSize: 26, color: '#C9C2B4', fontFamily: SANS }, d.status),
      ].filter(Boolean)),
      d.line ? h('div', { marginTop: 22, fontSize: 36, lineHeight: 1.25, color: CREAM, fontStyle: 'italic', fontFamily: SERIF, textAlign: 'center', justifyContent: 'center' }, cut(d.line, 90)) : null,
    ].filter(Boolean)),
    h('div', { position: 'absolute', left: 0, right: 0, top: 1722, flexDirection: 'column', alignItems: 'center' }, [
      h('div', { fontSize: 24, letterSpacing: 6, color: DIM, fontFamily: SANS }, `@${d.owner} ON GRANTHALAYA`.toUpperCase()),
      h('div', { marginTop: 8, fontSize: 22, color: DIM, fontFamily: SANS }, SITE),
    ]),
  ]);

  const t = performance.now();
  const svg = await satori(root as never, { width: W, height: H, fonts: FONTS as never });
  mark('layout', performance.now() - t);
  return render(svg, width);
}
