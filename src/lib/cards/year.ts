// The "My year" card: a roll of film, one frame per month, with the year's favourite marked (1080x1920).
// Follows private/designs/share-year.png.
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import { paletteFor } from '../data';
import { W, H, BG, CREAM, GOLD, TEAL, GREY, DIM, FONTS, SITE, SERIF, SANS, h, cut, coverData, paintingNight } from './story';

export interface YearTitle { title: string; cover?: string; color?: string }
export interface YearData {
  year: number; owner: string;
  books: number; films: number; essays: number;
  months: (YearTitle | null)[];     // 12 entries: the month's best title, or null when nothing was finished
  favourite?: number;               // index (0 to 11) of the month holding the favourite of the year
}

const MONTHS = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'];
const STRIP_X = 500, FRAME_W = 236, FRAME_H = 82, FAV_W = 286, FAV_H = 112, GAP = 10, TOP = 262;
const FILM = '#1B1C20', HOLE = '#E9E3D6';

export async function drawYear(d: YearData): Promise<Buffer> {
  const covers = await Promise.all(d.months.map((m) => coverData(m?.cover, false)));

  // a column of sprocket holes
  const holes = (height: number) => h('div', { flexDirection: 'column', justifyContent: 'space-between', height, paddingTop: 8, paddingBottom: 8 },
    Array.from({ length: Math.round(height / 26) }, () => h('div', { width: 12, height: 14, borderRadius: 3, background: HOLE })));

  const frame = (i: number) => {
    const m = d.months[i], fav = d.favourite === i;
    const fw = fav ? FAV_W : FRAME_W, fh = fav ? FAV_H : FRAME_H;
    const p = paletteFor(m?.title ?? '', m?.color);
    const art = m
      ? covers[i]
        ? { type: 'img', props: { src: covers[i], width: fw, height: fh, style: { width: fw, height: fh, objectFit: 'cover' } } }
        : h('div', { width: fw, height: fh, background: p.bg, padding: '10px 14px', fontSize: fav ? 28 : 22, lineHeight: 1.15, color: '#F6EEDF', fontFamily: SERIF, fontWeight: 700 }, cut(m.title, 30))
      : h('div', { width: fw, height: fh, background: '#26272C' }, '');
    return h('div', { width: fw + 48, height: fh + 12, position: 'relative' }, [
      h('div', { position: 'absolute', left: 0, top: 0, width: fw + 48, height: fh + 12, background: FILM, borderRadius: 4 }, ''),
      h('div', { position: 'absolute', left: 12, top: 0, height: fh + 12 }, [holes(fh + 12)]),
      h('div', { position: 'absolute', left: 24, top: 6, width: fw, height: fh, overflow: 'hidden', borderRadius: 2 }, art),
      h('div', { position: 'absolute', right: 12, top: 0, height: fh + 12 }, [holes(fh + 12)]),
      fav ? { type: 'svg', props: { width: 30, height: 64, viewBox: '0 0 30 64', style: { position: 'absolute', right: 26, top: -6 }, children: { type: 'path', props: { d: 'M0 0H30V64L15 50L0 64Z', fill: TEAL } } } } : null,
    ].filter(Boolean));
  };

  const rows: unknown[] = [];
  let y = TOP;
  for (let i = 0; i < 12; i++) {
    const fav = d.favourite === i;
    const fh = (fav ? FAV_H : FRAME_H) + 12;
    const left = STRIP_X - (fav ? 25 : 0);
    rows.push(h('div', { position: 'absolute', left, top: y }, frame(i)));
    rows.push(h('div', { position: 'absolute', left: left + (fav ? FAV_W : FRAME_W) + 48 + 26, top: y + fh / 2 - 16, fontSize: 24, letterSpacing: 6, color: CREAM, fontFamily: SANS }, MONTHS[i]));
    if (fav) rows.push(h('div', { position: 'absolute', left: 40, width: left - 40 - 26, top: y + fh / 2 - 38, justifyContent: 'flex-end', textAlign: 'right', fontSize: 24, letterSpacing: 6, lineHeight: 1.5, color: CREAM, fontFamily: SANS }, 'FAVOURITE OF THE YEAR'));
    y += fh + GAP;
  }

  const count = (n: number, label: string, color: string) =>
    h('div', { alignItems: 'baseline', gap: 14 }, [
      h('div', { fontSize: 76, color, fontFamily: SERIF, fontWeight: 700 }, String(n)),
      h('div', { fontSize: 50, letterSpacing: 1, color: CREAM, fontFamily: SERIF, fontWeight: 700 }, label.toUpperCase()),
    ]);
  const stats = [
    d.books ? count(d.books, d.books === 1 ? 'book' : 'books', GOLD) : null,
    d.films ? count(d.films, d.films === 1 ? 'film' : 'films', TEAL) : null,
    d.essays ? count(d.essays, d.essays === 1 ? 'essay' : 'essays', '#A9C79B') : null,
  ].filter(Boolean);

  const root = h('div', { width: W, height: H, background: BG, position: 'relative' }, [
    // a strip of the night painting at the top, melting into the card
    h('div', { position: 'absolute', left: 0, top: 0, width: W, height: 250, overflow: 'hidden' }, [
      { type: 'img', props: { src: paintingNight, width: W, height: 700, style: { position: 'absolute', left: 0, top: -330, width: W, height: 700 } } },
    ]),
    h('div', { position: 'absolute', left: 0, top: 110, width: W, height: 140, background: `linear-gradient(to bottom, rgba(18,19,22,0), ${BG})` }),
    h('div', { position: 'absolute', left: 60, top: 330, width: 400, flexDirection: 'column' }, [
      h('div', { fontSize: 128, lineHeight: 1, color: CREAM, fontFamily: SERIF, fontWeight: 700 }, 'ROLL'),
      h('div', { fontSize: 128, lineHeight: 1.05, color: CREAM, fontFamily: SERIF, fontWeight: 700 }, String(d.year)),
      h('div', { marginTop: 26, flexDirection: 'column', gap: 4 }, stats),
    ]),
    ...rows,
    h('div', { position: 'absolute', left: 0, top: 1572, width: W, flexDirection: 'column', alignItems: 'center' }, [
      h('div', { fontSize: 24, letterSpacing: 6, color: DIM, fontFamily: SANS }, `@${d.owner}`.toUpperCase()),
      h('div', { marginTop: 8, fontSize: 22, color: DIM, fontFamily: SANS }, SITE),
    ]),
  ]);

  const svg = await satori(root as never, { width: W, height: H, fonts: FONTS as never });
  return new Resvg(svg, { fitTo: { mode: 'width', value: W } }).render().asPng();
}
