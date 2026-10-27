// Finding things to add: Open Library for books, TMDB for films and TV, and reading pasted links.
// Server only (the TMDB key stays here).
import { env } from './supabase';
import type { Kind } from './kinds';
import { base } from './catalog/fetch';
import { checkUrl, safeGet } from './safefetch';

export type Hit = {
  kind: Kind; title: string; creator?: string; year?: number;
  pages?: number; runtime?: number; words?: number; episodes?: number; season?: number;
  link?: string; source?: string; cover?: string;
  tmdbId?: number; olKey?: string; from: string;
  seasons?: { n: number; name: string; episodes?: number; year?: number; cover?: string; aired: boolean }[];
};

const UA = { 'User-Agent': 'Mozilla/5.0 (compatible; Granthalaya/1.0; +https://granthalaya-sarthak.vercel.app)' };
async function get(url: string, ms = 7000, headers: Record<string, string> = {}) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try { return await fetch(url, { signal: ctl.signal, redirect: 'follow', headers: { ...UA, ...headers } }); }
  finally { clearTimeout(t); }
}
async function getJSON(url: string, ms = 7000) {
  const r = await get(url, ms);
  if (!r.ok) throw new Error(`${r.status} from ${new URL(url).host}`);
  return r.json();
}
const decode = (s: string) => s
  .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&nbsp;/g, ' ').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16))).trim();
const tmdbKey = () => env('TMDB_API_KEY');
const poster = (p?: string | null) => (p ? `https://image.tmdb.org/t/p/w500${p}` : undefined);
const yearOf = (d?: string | null) => (d ? +d.slice(0, 4) || undefined : undefined);

/* ——— books: Open Library (free, no key) ——— */
export async function books(q: string, limit = 6): Promise<Hit[]> {
  const j = await getJSON(`${base.ol()}/search.json?q=${encodeURIComponent(q)}&limit=${limit}&fields=key,title,author_name,first_publish_year,number_of_pages_median,cover_i`);
  return (j.docs ?? []).map((d: { title: string; author_name?: string[]; first_publish_year?: number; number_of_pages_median?: number; cover_i?: number; key?: string }): Hit => ({
    kind: 'book', title: d.title, creator: d.author_name?.[0], year: d.first_publish_year, pages: d.number_of_pages_median,
    cover: d.cover_i ? `https://covers.openlibrary.org/b/id/${d.cover_i}-L.jpg` : undefined,
    olKey: typeof d.key === 'string' ? d.key.replace('/works/', '') : undefined,
    link: d.key ? `https://openlibrary.org${d.key}` : undefined, from: 'Open Library',
  }));
}

/* ——— films: TMDB if there's a key, otherwise Wikipedia ——— */
export async function filmDetails(id: number): Promise<Hit | null> {
  const key = tmdbKey();
  if (!key) return null;
  const m = await getJSON(`${base.tmdb()}/movie/${id}?append_to_response=credits&api_key=${key}`).catch(() => null);
  if (!m?.id) return null;
  return {
    kind: 'film', title: m.title, year: yearOf(m.release_date), runtime: m.runtime || undefined,
    creator: m.credits?.crew?.find((c: any) => c.job === 'Director')?.name, cover: poster(m.poster_path),
    tmdbId: m.id, link: `https://www.themoviedb.org/movie/${m.id}`, from: 'TMDB',
  };
}
export async function films(q: string): Promise<Hit[]> {
  const key = tmdbKey();
  if (key) {
    const j = await getJSON(`${base.tmdb()}/search/movie?query=${encodeURIComponent(q)}&api_key=${key}`);
    const top = (j.results ?? []).slice(0, 5);
    const full = await Promise.all(top.map((m: any) => filmDetails(m.id)));
    return full.filter(Boolean) as Hit[];
  }
  const s = await getJSON(`https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(q + ' film')}&srlimit=6&format=json&origin=*`);
  const titles: string[] = (s.query?.search ?? []).map((x: any) => x.title);
  const hits = await Promise.all(titles.map(async (t) => {
    try {
      const d = await getJSON(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(t)}`);
      const m = String(d.description ?? '').match(/(\d{4}).*?film(?: directed)?(?: by ([^,;(]+))?/i);
      if (!m) return null;
      return { kind: 'film', title: t.replace(/\s*\((?:\d{4} )?(?:[\w-]+ )?film\)$/i, ''), year: +m[1], creator: m[2]?.trim(), link: d.content_urls?.desktop?.page, from: 'Wikipedia' } as Hit;
    } catch { return null; }
  }));
  return hits.filter(Boolean) as Hit[];
}

/* ——— TV: TMDB shows, then their seasons ——— */
export async function shows(q: string): Promise<Hit[]> {
  const key = tmdbKey();
  if (!key) return [];
  const j = await getJSON(`${base.tmdb()}/search/tv?query=${encodeURIComponent(q)}&api_key=${key}`);
  return (j.results ?? []).slice(0, 6).map((t: any) => ({
    kind: 'tv', title: t.name, year: yearOf(t.first_air_date), cover: poster(t.poster_path), tmdbId: t.id, from: 'TMDB',
  }));
}
export async function showSeasons(id: number): Promise<Hit | null> {
  const key = tmdbKey();
  if (!key) return null;
  const t = await getJSON(`${base.tmdb()}/tv/${id}?api_key=${key}`).catch(() => null);
  if (!t?.id) return null;
  return {
    kind: 'tv', title: t.name, year: yearOf(t.first_air_date), creator: t.created_by?.[0]?.name, cover: poster(t.poster_path), tmdbId: t.id, from: 'TMDB',
    seasons: (t.seasons ?? []).filter((s: any) => s.season_number > 0).map((s: any) => ({
      n: s.season_number, name: s.name, episodes: s.episode_count, year: yearOf(s.air_date), cover: poster(s.poster_path),
      aired: !!s.air_date && s.air_date <= new Date().toISOString().slice(0, 10),
    })),
  };
}
export async function seasonDetails(id: number, n: number): Promise<Hit | null> {
  const show = await showSeasons(id);
  if (!show) return null;
  const s = await getJSON(`${base.tmdb()}/tv/${id}/season/${n}?api_key=${tmdbKey()}`).catch(() => null);
  if (!s) return null;
  const eps: any[] = s.episodes ?? [];
  const runtime = eps.reduce((m, e) => m + (e.runtime || 0), 0) || undefined;
  return {
    kind: 'tv', title: show.title, creator: show.creator, season: n, episodes: eps.length || undefined, runtime,
    year: yearOf(s.air_date) ?? show.year, cover: poster(s.poster_path) ?? show.cover, tmdbId: id,
    link: `https://www.themoviedb.org/tv/${id}/season/${n}`, from: 'TMDB',
  };
}

/* ——— links: read the page's own title, author and length ——— */
function meta(html: string, name: string) {
  const re = new RegExp(`<meta[^>]+(?:property|name)=["']${name}["'][^>]*>`, 'i');
  const tag = html.match(re)?.[0];
  return tag ? decode(tag.match(/content=["']([^"']*)["']/i)?.[1] ?? '') : '';
}
export async function link(raw: string): Promise<Hit[]> {
  const u = checkUrl(raw);
  const host = u.hostname.replace(/^www\./, '');
  const tm = u.href.match(/themoviedb\.org\/(movie|tv)\/(\d+)/);
  if (tm) {
    const h = tm[1] === 'movie' ? await filmDetails(+tm[2]) : await showSeasons(+tm[2]);
    if (h) return [h];
  }
  const r = await safeGet(u.href, 9000, { ...UA, Accept: 'text/html' });
  if (!r.ok) throw new Error('unreadable');
  const html = r.text().slice(0, 3_000_000);
  const title = meta(html, 'og:title') || decode(html.match(/<title[^>]*>([^<]*)/i)?.[1] ?? '');
  if (!title) throw new Error('unreadable');
  const site = meta(html, 'og:site_name') || host;

  if (/letterboxd\.com|imdb\.com/.test(host)) {
    const m = title.match(/^(.*?)\s*\((\d{4})\)/);
    const name = decode(m?.[1] ?? title.split(/[|–-]/)[0]);
    const year = m ? +m[2] : undefined;
    if (tmdbKey()) {
      const found = await films(name).catch(() => []);
      const best = found.find((f) => !year || f.year === year) ?? found[0];
      if (best) return [best];
    }
    const director = meta(html, 'twitter:data1') || html.match(/Directed by[^<]*<[^>]*>\s*(?:<[^>]*>)*([^<]+)/i)?.[1];
    return [{ kind: 'film', title: name, year, creator: director ? decode(director) : undefined, link: u.href, from: site }];
  }
  if (/goodreads\.com|openlibrary\.org|amazon\./.test(host)) {
    const clean = title.replace(/\s*[|:–-]\s*(Goodreads|Open Library).*$/i, '');
    const [t, by] = clean.split(/\s+by\s+/i);
    const best = (await books(clean, 3).catch(() => []))[0];
    if (best) return [{ ...best, link: u.href }];
    return [{ kind: 'book', title: decode(t), creator: by ? decode(by) : undefined, link: u.href, from: site }];
  }
  // anything else: an essay or article
  const body = (html.match(/<article[\s\S]*?<\/article>/i)?.[0] ?? html.match(/<body[\s\S]*<\/body>/i)?.[0] ?? html)
    .replace(/<(script|style|nav|header|footer|aside|form)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ');
  const words = decode(body).split(/\s+/).filter((w) => /\w/.test(w)).length;
  const author = meta(html, 'author') || meta(html, 'article:author') || meta(html, 'twitter:creator').replace(/^@/, '');
  const isSubstack = /substack\.com/.test(host) || /substackcdn/.test(html);
  return [{
    kind: 'essay', title: title.replace(new RegExp(`\\s*[|–—-]\\s*${site.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'i'), '').slice(0, 300),
    creator: author && !/^https?:/.test(author) ? author.slice(0, 200) : site, words: words > 150 ? words : undefined,
    link: u.href, source: isSubstack ? 'Substack' : site, from: site,
  }];
}
