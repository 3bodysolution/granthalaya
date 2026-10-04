import type { APIRoute } from 'astro';
import { isOwner, config, json } from '../../lib/server';
export const prerender = false;

type Hit = {
  type: 'book' | 'film' | 'essay'; title: string; creator?: string; year?: number;
  pages?: number; runtime?: number; words?: number; link?: string; source?: string; cover?: string; from: string;
};

const UA = { 'User-Agent': 'Mozilla/5.0 (compatible; Granthalaya/1.0; personal library)' };
async function get(url: string, ms = 7000, headers: Record<string, string> = {}) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try { return await fetch(url, { signal: ctl.signal, redirect: 'follow', headers: { ...UA, ...headers } }); }
  finally { clearTimeout(t); }
}
const decode = (s: string) => s
  .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&nbsp;/g, ' ').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16))).trim();

/* ——— books: Open Library (free, no key) ——— */
async function books(q: string): Promise<Hit[]> {
  const r = await get(`https://openlibrary.org/search.json?q=${encodeURIComponent(q)}&limit=6&fields=key,title,author_name,first_publish_year,number_of_pages_median,cover_i`);
  if (!r.ok) return [];
  const j = await r.json();
  return (j.docs ?? []).map((d: any) => ({
    type: 'book', title: d.title, creator: d.author_name?.[0], year: d.first_publish_year,
    pages: d.number_of_pages_median, cover: d.cover_i ? `https://covers.openlibrary.org/b/id/${d.cover_i}-L.jpg` : undefined, link: d.key ? `https://openlibrary.org${d.key}` : undefined, from: 'Open Library',
  }));
}

/* ——— films: TMDB if you add a key, otherwise Wikipedia ——— */
async function films(q: string): Promise<Hit[]> {
  const key = config().tmdb;
  if (key) {
    const r = await get(`https://api.themoviedb.org/3/search/movie?query=${encodeURIComponent(q)}&api_key=${key}`);
    if (r.ok) {
      const top = ((await r.json()).results ?? []).slice(0, 5);
      return Promise.all(top.map(async (m: any) => {
        let runtime, creator;
        try {
          const d = await (await get(`https://api.themoviedb.org/3/movie/${m.id}?append_to_response=credits&api_key=${key}`)).json();
          runtime = d.runtime || undefined;
          creator = d.credits?.crew?.find((c: any) => c.job === 'Director')?.name;
        } catch {}
        return { type: 'film', title: m.title, year: m.release_date ? +m.release_date.slice(0, 4) : undefined, runtime, creator, cover: m.poster_path ? `https://image.tmdb.org/t/p/w500${m.poster_path}` : undefined, link: `https://www.themoviedb.org/movie/${m.id}`, from: 'TMDB' } as Hit;
      }));
    }
  }
  const s = await get(`https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(q + ' film')}&srlimit=6&format=json&origin=*`);
  if (!s.ok) return [];
  const titles: string[] = ((await s.json()).query?.search ?? []).map((x: any) => x.title);
  const hits = await Promise.all(titles.map(async (t) => {
    try {
      const d = await (await get(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(t)}`)).json();
      const desc: string = d.description ?? '';
      const m = desc.match(/(\d{4}).*?film(?: directed)?(?: by ([^,;(]+))?/i);
      if (!m) return null;
      return { type: 'film', title: t.replace(/\s*\((?:\d{4} )?(?:[\w-]+ )?film\)$/i, ''), year: +m[1], creator: m[2]?.trim(), link: d.content_urls?.desktop?.page, from: 'Wikipedia' } as Hit;
    } catch { return null; }
  }));
  return hits.filter(Boolean) as Hit[];
}

/* ——— links: read the page's own title, author and length ——— */
function meta(html: string, name: string) {
  const re = new RegExp(`<meta[^>]+(?:property|name)=["']${name}["'][^>]*>`, 'i');
  const tag = html.match(re)?.[0];
  return tag ? decode(tag.match(/content=["']([^"']*)["']/i)?.[1] ?? '') : '';
}
async function link(url: string): Promise<Hit[]> {
  const u = new URL(url);
  const host = u.hostname.replace(/^www\./, '');
  const r = await get(url, 9000, { Accept: 'text/html' });
  if (!r.ok) throw new Error('unreadable');
  const html = (await r.text()).slice(0, 3_000_000);
  const title = meta(html, 'og:title') || decode(html.match(/<title[^>]*>([^<]*)/i)?.[1] ?? '');
  if (!title) throw new Error('unreadable');
  const site = meta(html, 'og:site_name') || host;

  if (/letterboxd\.com|imdb\.com|themoviedb\.org/.test(host)) {
    const m = title.match(/^(.*?)\s*\((\d{4})\)/);
    const director = meta(html, 'twitter:data1') || html.match(/Directed by[^<]*<[^>]*>\s*(?:<[^>]*>)*([^<]+)/i)?.[1];
    const runtime = +(html.match(/(\d{2,3})\s*(?:&nbsp;|\s)*min/i)?.[1] ?? 0) || undefined;
    return [{ type: 'film', title: decode(m?.[1] ?? title.split(/[|–-]/)[0]), year: m ? +m[2] : undefined, creator: director ? decode(director) : undefined, runtime, cover: meta(html, 'og:image') || undefined, link: url, from: site }];
  }
  if (/goodreads\.com|openlibrary\.org|amazon\./.test(host)) {
    const clean = title.replace(/\s*[|:–-]\s*(Goodreads|Open Library).*$/i, '');
    const [t, by] = clean.split(/\s+by\s+/i);
    const pages = +(meta(html, 'books:page_count') || html.match(/(\d{2,4})\s+pages/i)?.[1] || 0) || undefined;
    const fromOL = await books(clean).catch(() => []);
    const best = fromOL[0];
    return [{ type: 'book', title: decode(t), creator: by ? decode(by) : best?.creator, year: best?.year, pages: pages ?? best?.pages, cover: best?.cover || meta(html, 'og:image') || undefined, link: url, from: site }];
  }
  // anything else: an essay or article
  const body = (html.match(/<article[\s\S]*?<\/article>/i)?.[0] ?? html.match(/<body[\s\S]*<\/body>/i)?.[0] ?? html)
    .replace(/<(script|style|nav|header|footer|aside|form)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ');
  const words = decode(body).split(/\s+/).filter((w) => /\w/.test(w)).length;
  const author = meta(html, 'author') || meta(html, 'article:author') || meta(html, 'twitter:creator').replace(/^@/, '');
  const isSubstack = /substack\.com/.test(host) || /substackcdn/.test(html);
  return [{
    type: 'essay', title: title.replace(new RegExp(`\\s*[|–—-]\\s*${site.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'i'), ''),
    creator: author && !/^https?:/.test(author) ? author : site, words: words > 150 ? words : undefined,
    link: url, source: isSubstack ? 'Substack' : site, from: site,
  }];
}

export const GET: APIRoute = async ({ url, cookies }) => {
  if (!isOwner(cookies)) return json({ error: 'Please sign in again.' }, 401);
  const q = (url.searchParams.get('q') ?? '').trim();
  const type = url.searchParams.get('type') ?? 'book';
  if (!q) return json({ hits: [] });
  try {
    if (/^https?:\/\//i.test(q)) return json({ hits: await link(q) });
    return json({ hits: type === 'film' ? await films(q) : await books(q) });
  } catch {
    return json({ error: 'We couldn’t read that. Fill it in by hand instead.' }, 422);
  }
};
