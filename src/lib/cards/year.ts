// The "My year" card: counts, a wall of covers, on a tall card (1080x1920).
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import { paletteFor } from '../data';
import { W, H, BG, CREAM, GOLD, TEAL, GREY, DIM, FONTS, SITE, SERIF, SANS, h, cut, coverData, paintingNight } from './story';

export interface YearTitle { title: string; kind: string; cover?: string; color?: string }
export interface YearData {
  year: number; owner: string; name: string;
  books: number; films: number; essays: number;
  covers: YearTitle[];          // up to 12, best first
}

const COLS = 4, GAP = 14, CW = 148, CH = 222;   // each tile also has a 2px border on every side

export async function drawYear(d: YearData): Promise<Buffer> {
  const covers = await Promise.all(d.covers.slice(0, 12).map(async (c) => ({ ...c, data: await coverData(c.cover, false) })));
  const rows = Math.min(3, Math.ceil(covers.length / COLS));
  const gridW = COLS * (CW + 4) + (COLS - 1) * GAP;
    const gridTop = 852 + Math.max(0, 3 - rows) * (CH + 4 + GAP) / 2;

  const tile = (c: (typeof covers)[number]) => {
    const p = paletteFor(c.title, c.color);
    return h('div', { width: CW, height: CH, borderRadius: 6, overflow: 'hidden', position: 'relative', background: p.bg, border: '2px solid rgba(255,255,255,.18)' },
      c.data
        ? { type: 'img', props: { src: c.data, width: CW, height: CH, style: { width: CW, height: CH, objectFit: 'cover' } } }
        : [
          h('div', { position: 'absolute', left: 0, right: 0, bottom: 0, height: 80, background: p.hill }),
          h('div', { position: 'absolute', left: 16, right: 16, top: 24, fontSize: 26, lineHeight: 1.15, color: '#F6EEDF', fontFamily: SERIF, fontWeight: 700 }, cut(c.title, 34)),
        ]);
  };

  const count = (n: number, label: string, color: string) =>
    h('div', { flexDirection: 'column', alignItems: 'center', width: 280 }, [
      h('div', { fontSize: 120, lineHeight: 1, color, fontFamily: SERIF, fontWeight: 700 }, String(n)),
      h('div', { marginTop: 8, fontSize: 28, letterSpacing: 5, color: GREY, fontFamily: SANS }, label.toUpperCase()),
    ]);
  const stats = [
    d.films ? count(d.films, d.films === 1 ? 'film' : 'films', TEAL) : null,
    d.books ? count(d.books, d.books === 1 ? 'book' : 'books', GOLD) : null,
    d.essays ? count(d.essays, d.essays === 1 ? 'essay' : 'essays', '#A9C79B') : null,
  ].filter(Boolean) as ReturnType<typeof count>[];
  const row: unknown[] = [];
  stats.forEach((s, i) => { if (i) row.push(h('div', { width: 2, height: 110, background: 'rgba(255,255,255,.2)' })); row.push(s); });

  const root = h('div', { width: W, height: H, background: BG, flexDirection: 'column', alignItems: 'center', position: 'relative' }, [
    { type: 'img', props: { src: paintingNight, width: W, height: 700, style: { position: 'absolute', left: 0, top: 0, width: W, height: 700 } } },
    h('div', { position: 'absolute', left: 0, top: 380, width: W, height: 320, background: `linear-gradient(to bottom, rgba(18,19,22,0), ${BG})` }),
    h('div', { position: 'absolute', left: 0, right: 0, top: 262, flexDirection: 'column', alignItems: 'center' }, [
      h('div', { fontSize: 30, letterSpacing: 9, color: CREAM, fontFamily: SANS }, 'MY YEAR'),
      h('div', { marginTop: 4, fontSize: 168, lineHeight: 1.05, color: CREAM, fontFamily: SERIF, fontWeight: 700 }, String(d.year)),
    ]),
    h('div', { position: 'absolute', left: 0, right: 0, top: 690, alignItems: 'center', justifyContent: 'center', gap: 20 }, row),
    h('div', { position: 'absolute', left: (W - gridW) / 2, top: gridTop, width: gridW, flexWrap: 'wrap', gap: GAP, justifyContent: 'center' }, covers.map(tile)),
    h('div', { position: 'absolute', left: 0, right: 0, top: 1598, flexDirection: 'column', alignItems: 'center' }, [
      h('div', { fontSize: 24, letterSpacing: 6, color: DIM, fontFamily: SANS }, `@${d.owner} ON GRANTHALAYA`.toUpperCase()),
      h('div', { marginTop: 10, fontSize: 22, color: DIM, fontFamily: SANS }, SITE),
    ]),
  ].filter(Boolean));

  const svg = await satori(root as never, { width: W, height: H, fonts: FONTS as never });
  return new Resvg(svg, { fitTo: { mode: 'width', value: W } }).render().asPng();
}
