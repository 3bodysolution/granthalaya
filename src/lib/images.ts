// Picture sizes. A poster tile is about 150 to 180 pixels wide, so ordinary screens get a small file and
// sharp (2x) screens get the larger one. Only TMDB and Open Library covers are resized; anything else is
// left as it is.
const TMDB = /^(https:\/\/image\.tmdb\.org\/t\/p\/)(?:w\d+|original)(\/.+)$/;
const OL = /^(https:\/\/covers\.openlibrary\.org\/b\/id\/\d+)-[SML](\.jpg)$/;

/** covers from the two bookshops (Akshardhara on Shopify, BookGanga): only their own cover folders */
export const SHOP_COVER = /^https:\/\/(cdn\.shopify\.com\/s\/files\/1\/0800\/1214\/9058\/|www\.bookganga\.com\/eBooks\/Content\/images\/books\/)[\w./%-]+$/;
const SHOPIFY = /^https:\/\/cdn\.shopify\.com\//;
/** a shop's cover is never loaded from the shop by visitors: it goes through our /api/cover, which Vercel's CDN keeps.
 *  Shopify covers are asked for at `width` pixels (its originals are large); other addresses are returned as they are. */
export function viaCover(url: string, width = 400): string {
  if (!SHOP_COVER.test(url)) return url;
  const u = SHOPIFY.test(url) ? `${url}?width=${width}` : url;
  return `/api/cover?u=${encodeURIComponent(u)}`;
}

/** the `src` and `srcset` for a poster or cover shown in a tile */
export function tileImage(url: string, large = false): { src: string; srcset?: string } {
  if (SHOP_COVER.test(url)) return { src: viaCover(url, large ? 500 : 300), srcset: `${viaCover(url, large ? 500 : 300)} 1x, ${viaCover(url, large ? 800 : 500)} 2x` };
  const t = url.match(TMDB);
  if (t && large) return { src: `${t[1]}w342${t[2]}`, srcset: `${t[1]}w342${t[2]} 1x, ${t[1]}w500${t[2]} 2x` };
  if (t) return { src: `${t[1]}w185${t[2]}`, srcset: `${t[1]}w185${t[2]} 1x, ${t[1]}w342${t[2]} 2x` };
  const o = url.match(OL);
  if (o && large) return { src: `${o[1]}-L${o[2]}` };
  if (o) return { src: `${o[1]}-M${o[2]}`, srcset: `${o[1]}-M${o[2]} 1x, ${o[1]}-L${o[2]} 2x` };
  return { src: url };
}

/** a wide still behind a title: the 780 pixel one for phones and small windows, the 1280 pixel one for big screens */
export function stillImage(url: string): { src: string; srcset?: string; sizes?: string } {
  const t = url.match(TMDB);
  if (!t) return { src: url };
  return { src: `${t[1]}w780${t[2]}`, srcset: `${t[1]}w780${t[2]} 780w, ${t[1]}w1280${t[2]} 1280w`, sizes: '100vw' };
}
