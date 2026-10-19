// Where a streaming icon goes: the service's own search for the title, keyed by TMDB's provider id.
// Each address was opened in a browser from India with a real title and showed that title's results
// (Netflix asks you to sign in first, then carries on to the search). Services left out either drop the
// title from the address (JioHotstar, SonyLIV, Hungama) or have no working search (MX Player), so their
// icons keep opening the JustWatch page for the title, which lists every service.
const SEARCH: Record<number, string> = {
  8: 'https://www.netflix.com/search?q=',
  175: 'https://www.netflix.com/search?q=',
  119: 'https://www.primevideo.com/search/?phrase=',
  10: 'https://www.primevideo.com/search/?phrase=',
  350: 'https://tv.apple.com/in/search?term=',
  2: 'https://tv.apple.com/in/search?term=',
  192: 'https://www.youtube.com/results?search_query=',
  232: 'https://www.zee5.com/search?q=',
  11: 'https://mubi.com/en/search/films?query=',
  283: 'https://www.crunchyroll.com/search?q=',
  482: 'https://www.manoramamax.com/search?q=',
  315: 'https://hoichoi.tv/search?q=',
  309: 'https://www.sunnxt.com/search?q=',
  510: 'https://www.discoveryplus.in/search?q=',
  532: 'https://www.aha.video/search?q=',
  474: 'https://www.shemaroome.com/search?q=',
  190: 'https://curiositystream.com/search/',
};

/** the service's own search for this title, or null when we can't send people there reliably */
export function serviceHref(providerId: number, title: string): string | null {
  const base = SEARCH[providerId];
  return base ? base + encodeURIComponent(title) : null;
}
