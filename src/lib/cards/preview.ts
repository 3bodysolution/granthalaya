// The link preview: a wide card (1200x630) shown when a page is shared in a chat or on social media (og:image).
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import { paletteFor } from '../data';
import { BG, CREAM, GOLD, TEAL, GREY, DIM, FONTS, SITE, SERIF, SANS, h, cut, coverData } from './story';
import { backgroundData, type Background } from './backgrounds';

export interface PreviewData {
  kicker: string;                  // "Film", "Book", "Shelf" ...
  title: string;
  meta?: string;                   // "1953 | directed by ..."
  line?: string;                   // a short line under the meta
  rating?: number;
  bg?: Background;
  accent?: 'film' | 'book' | 'plain';
  covers: { src?: string; title: string; color?: string }[];   // one poster, or up to 3 for a shelf or collection
}
const PW = 1200, PH = 630;

export async function drawPreview(d: PreviewData): Promise<Buffer> {
  const accent = d.accent === 'film' ? TEAL : d.accent === 'book' ? GOLD : CREAM;
  const one = d.covers.length <= 1;
  const CW = one ? 290 : 190, CH = one ? 435 : 285;
  const covers = await Promise.all(d.covers.slice(0, 3).map(async (c) => ({ ...c, data: await coverData(c.src, false) })));
  const title = cut(d.title, 80);
  const size = title.length <= 18 ? 76 : title.length <= 36 ? 62 : 50;
  const full = d.rating == null ? 0 : Math.floor(d.rating), half = d.rating != null && d.rating % 1 >= 0.5;

  const tile = (c: (typeof covers)[number], i: number) => {
    const p = paletteFor(c.title, c.color);
    return h('div', {
      position: 'absolute', left: one ? 775 : 640 + i * 175, top: one ? 98 : 150 + (i === 1 ? 40 : 0), width: CW, height: CH, borderRadius: 6, overflow: 'hidden',
      background: p.bg, border: '2px solid rgba(255,255,255,.2)', boxShadow: '0 24px 48px rgba(0,0,0,.55)',
    }, c.data
      ? { type: 'img', props: { src: c.data, width: CW, height: CH, style: { width: CW, height: CH, objectFit: 'cover' } } }
      : [
        h('div', { position: 'absolute', left: 0, right: 0, bottom: 0, height: CH * 0.28, background: p.hill }),
        h('div', { position: 'absolute', left: 20, right: 20, top: 32, fontSize: one ? 38 : 26, lineHeight: 1.15, color: '#F6EEDF', fontFamily: SERIF, fontWeight: 700 }, cut(c.title, 36)),
      ]);
  };

  const root = h('div', { width: PW, height: PH, background: BG, position: 'relative' }, [
    // the top of the painting fills the card
    { type: 'img', props: { src: await backgroundData(d.bg ?? 'cinema'), width: PW, height: 1800, style: { position: 'absolute', left: 0, top: 0, width: PW, height: 1800 } } },
    h('div', { position: 'absolute', left: 0, top: 0, width: 860, height: PH, background: `linear-gradient(to right, ${BG} 0%, ${BG} 30%, rgba(18,19,22,0) 100%)` }),
    ...covers.map(tile),
    h('div', { position: 'absolute', left: 64, top: 70, width: 640, height: 490, flexDirection: 'column' }, [
      h('div', { fontSize: 24, letterSpacing: 8, color: accent, fontFamily: SANS }, d.kicker.toUpperCase()),
      h('div', { marginTop: 22, fontSize: size, lineHeight: 1.1, color: CREAM, fontFamily: SERIF, fontWeight: 700 }, title),
      d.meta ? h('div', { marginTop: 18, fontSize: 30, color: GREY, fontFamily: SANS }, cut(d.meta, 70)) : null,
      full || half ? h('div', { marginTop: 14, fontSize: 38, color: accent, fontFamily: SANS, letterSpacing: 4 }, '★'.repeat(full) + (half ? '½' : '')) : null,
      d.line ? h('div', { marginTop: 22, fontSize: 32, lineHeight: 1.3, color: CREAM, fontStyle: 'italic', fontFamily: SERIF }, cut(d.line, 100)) : null,
      h('div', { flexGrow: 1 }, ''),
      h('div', { flexDirection: 'column' }, [
        h('div', { fontSize: 24, letterSpacing: 6, color: DIM, fontFamily: SANS }, 'GRANTHALAYA'),
        h('div', { marginTop: 6, fontSize: 22, color: DIM, fontFamily: SANS }, SITE),
      ]),
    ].filter(Boolean)),
  ]);
  const svg = await satori(root as never, { width: PW, height: PH, fonts: FONTS as never });
  return new Resvg(svg, { fitTo: { mode: 'width', value: PW } }).render().asPng();
}
