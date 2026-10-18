// Picture sizes. A poster tile is about 150 to 180 pixels wide, so ordinary screens get a small file and
// sharp (2x) screens get the larger one. Only TMDB and Open Library covers are resized; anything else is
// left as it is.
const TMDB = /^(https:\/\/image\.tmdb\.org\/t\/p\/)(?:w\d+|original)(\/.+)$/;
const OL = /^(https:\/\/covers\.openlibrary\.org\/b\/id\/\d+)-[SML](\.jpg)$/;

/** the `src` and `srcset` for a poster or cover shown in a tile */
export function tileImage(url: string): { src: string; srcset?: string } {
  const t = url.match(TMDB);
  if (t) return { src: `${t[1]}w185${t[2]}`, srcset: `${t[1]}w185${t[2]} 1x, ${t[1]}w342${t[2]} 2x` };
  const o = url.match(OL);
  if (o) return { src: `${o[1]}-M${o[2]}`, srcset: `${o[1]}-M${o[2]} 1x, ${o[1]}-L${o[2]} 2x` };
  return { src: url };
}

/** a wide still behind a title: the 780 pixel one for phones and small windows, the 1280 pixel one for big screens */
export function stillImage(url: string): { src: string; srcset?: string; sizes?: string } {
  const t = url.match(TMDB);
  if (!t) return { src: url };
  return { src: `${t[1]}w780${t[2]}`, srcset: `${t[1]}w780${t[2]} 780w, ${t[1]}w1280${t[2]} 1280w`, sizes: '100vw' };
}
