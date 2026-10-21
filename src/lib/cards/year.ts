// The "My year" card: a roll of film, one frame per month, with the year's favourite marked (1080x1920).
// Follows private/designs/share-year.png.
import satori from 'satori';
import { mark } from '../timing';
import { render, type Picture } from './output';
import { paletteFor } from '../data';
import { CoverMissing, softShadow, timedPainting, W, H, CREAM, GOLD, TEAL, GREY, DIM, FONTS, SITE, SERIF, SANS, h, cut, coverData } from './story';
import { baseColor, PAINT_H, type Background } from './backgrounds';

export interface YearTitle { title: string; cover?: string; color?: string }
export interface YearData {
  year: number; owner: string;
  books: number; films: number; essays: number;
  months: (YearTitle | null)[];     // 12 entries: the month's best title, or null when nothing was finished
  bg?: Background;
  fav?: YearTitle;                  // the favourite of the year, shown large on the left
  favourite?: number;               // index (0 to 11) of the month holding the favourite of the year
}

const MONTHS = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'];
const STRIP_X = 500, FRAME_W = 236, FRAME_H = 78, FAV_W = 286, FAV_H = 100, GAP = 8, TOP = 336;   // the strip starts below where the painting fades out
const FILM = '#1B1C20', HOLE = '#E9E3D6';

export async function drawYear(d: YearData, width = W): Promise<Picture> {
  const [covers, favCover, painting] = await Promise.all([Promise.all(d.months.map((m) => coverData(m?.cover, false))), coverData(d.fav?.cover, width >= W), timedPainting(d.bg ?? 'cinema')]);
  if ((d.fav?.cover && !favCover) || d.months.some((m, i) => m?.cover && !covers[i])) throw new CoverMissing();

  // a column of sprocket holes
  const holes = (height: number) => h('div', { flexDirection: 'column', justifyContent: 'space-between', height, paddingTop: 8, paddingBottom: 8 },
    Array.from({ length: Math.round(height / 26) }, () => h('div', { width: 12, height: 14, borderRadius: 3, background: HOLE })));

  const frame = (i: number) => {
    const m = d.months[i], fav = d.favourite === i;
    const fw = fav ? FAV_W : FRAME_W, fh = fav ? FAV_H : FRAME_H;
    const p = paletteFor(m?.title ?? '', m?.color);
    const room = fw - 28 - (fav ? 44 : 0);   // a title shrinks to fit, then is cut with an ellipsis, before it reaches the frame's edge (or the marker)
    const size = Math.max(16, Math.min(fav ? 28 : 22, Math.floor(room / ((m?.title.length ?? 1) * 0.56))));
    const art = m
      ? covers[i]
        ? { type: 'img', props: { src: covers[i], width: fw, height: fh, style: { width: fw, height: fh, objectFit: 'cover' } } }
        : h('div', { width: fw, height: fh, background: p.bg, padding: '10px 14px' }, h('div', { width: room, fontSize: size, lineHeight: 1.15, color: '#F6EEDF', fontFamily: SERIF, fontWeight: 700 }, cut(m.title, Math.floor(room / (size * 0.56)))))
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

  const root = h('div', { width: W, height: H, background: baseColor(d.bg), position: 'relative' }, [
    // a strip of the painting at the top, melting into the card
    h('div', { position: 'absolute', left: 0, top: 0, width: W, height: 310, overflow: 'hidden' }, [
      { type: 'img', props: { src: painting, width: W, height: PAINT_H, style: { position: 'absolute', left: 0, top: 0, width: W, height: PAINT_H } } },
    ]),
    h('div', { position: 'absolute', left: 0, top: 150, width: W, height: 160, background: `linear-gradient(to bottom, rgba(18,19,22,0), ${baseColor(d.bg)})` }),
    h('div', { position: 'absolute', left: 60, top: 350, width: 420, flexDirection: 'column' }, [
      h('div', { fontSize: 88, whiteSpace: 'nowrap', lineHeight: 1.05, color: CREAM, fontFamily: SERIF, fontWeight: 700 }, `My ${d.year}`),
      h('div', { marginTop: 18, flexDirection: 'column', gap: 0 }, stats),
    ]),
    ...(d.fav ? softShadow(60, 800 + 20 + 14 + 0, 300, 450, 6, 14) : []),
    d.fav ? h('div', { position: 'absolute', left: 60, top: 800, width: 380, flexDirection: 'column' }, [
      h('div', { fontSize: 20, letterSpacing: 4, color: CREAM, fontFamily: SANS, whiteSpace: 'nowrap' }, 'FAVOURITE OF THE YEAR'),
      h('div', { marginTop: 14, width: 300, height: 450, borderRadius: 6, overflow: 'hidden', border: '2px solid rgba(255,255,255,.2)', background: paletteFor(d.fav.title, d.fav.color).bg },
        favCover ? { type: 'img', props: { src: favCover, width: 300, height: 450, style: { width: 300, height: 450, objectFit: 'cover' } } }
          : h('div', { padding: '24px 20px', fontSize: 36, lineHeight: 1.15, color: '#F6EEDF', fontFamily: SERIF, fontWeight: 700 }, cut(d.fav.title, 40))),
      h('div', { marginTop: 14, width: 380, fontSize: 32, lineHeight: 1.15, color: CREAM, fontFamily: SERIF, fontWeight: 700 }, cut(d.fav.title, 44)),
    ]) : null,
    ...rows,
    h('div', { position: 'absolute', left: 0, top: 1600, width: W, flexDirection: 'column', alignItems: 'center' }, [
      h('div', { fontSize: 24, letterSpacing: 6, color: DIM, fontFamily: SANS }, `@${d.owner}`.toUpperCase()),
      h('div', { marginTop: 8, fontSize: 22, color: DIM, fontFamily: SANS }, SITE),
    ]),
  ]);

  const t = performance.now();
  const svg = await satori(root as never, { width: W, height: H, fonts: FONTS as never });
  mark('layout', performance.now() - t);
  return render(svg, width);
}
