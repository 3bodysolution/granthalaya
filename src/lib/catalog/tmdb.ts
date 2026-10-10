// Films, TV and the people who make them, from TMDB (The Movie Database). Where-to-watch data comes
// through TMDB from JustWatch, and must be credited to JustWatch wherever it's shown.
import { env } from '../supabase';
import { base, getJSON, plain, slug, yearOf } from './fetch';

const key = () => env('TMDB_API_KEY');
export const tmdbReady = () => !!key();
const IMG = 'https://image.tmdb.org/t/p/';
export const img = (p: string | null | undefined, size: 'w92' | 'w185' | 'w342' | 'w500' | 'w780' | 'w1280' | 'original') => (p ? `${IMG}${size}${p}` : undefined);
const q = (path: string, params: Record<string, string | number | undefined> = {}) => {
  const u = new URL(base.tmdb() + path);
  u.searchParams.set('api_key', key() ?? '');
  u.searchParams.set('language', 'en-US');
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') u.searchParams.set(k, String(v));
  return u.toString();
};
export const REGION = 'IN';

/* ——— names for codes ——— */
const langNames = new Intl.DisplayNames(['en'], { type: 'language' });
const regionNames = new Intl.DisplayNames(['en'], { type: 'region' });
export const languageName = (code?: string | null) => { try { return code ? langNames.of(code) ?? code : undefined; } catch { return code ?? undefined; } };
export const countryName = (code?: string | null) => { try { return code ? regionNames.of(code) ?? code : undefined; } catch { return code ?? undefined; } };

/* ——— genres (TMDB's own lists, which rarely change) ——— */
export const FILM_GENRES: [number, string][] = [
  [28, 'Action'], [12, 'Adventure'], [16, 'Animation'], [35, 'Comedy'], [80, 'Crime'], [99, 'Documentary'], [18, 'Drama'],
  [10751, 'Family'], [14, 'Fantasy'], [36, 'History'], [27, 'Horror'], [10402, 'Music'], [9648, 'Mystery'], [10749, 'Romance'],
  [878, 'Science Fiction'], [53, 'Thriller'], [10752, 'War'], [37, 'Western'], [10770, 'TV Movie'],
];
export const TV_GENRES: [number, string][] = [
  [10759, 'Action & Adventure'], [16, 'Animation'], [35, 'Comedy'], [80, 'Crime'], [99, 'Documentary'], [18, 'Drama'],
  [10751, 'Family'], [10762, 'Kids'], [9648, 'Mystery'], [10763, 'News'], [10764, 'Reality'], [10765, 'Sci-Fi & Fantasy'],
  [10766, 'Soap'], [10767, 'Talk'], [10768, 'War & Politics'], [37, 'Western'],
];
export const genreSlug = (name: string) => slug(name);
export function genreById(kind: 'film' | 'tv', id: number) {
  const list = kind === 'tv' ? TV_GENRES : FILM_GENRES;
  const g = list.find(([i]) => i === id);
  return g ? { id: g[0], name: g[1], slug: genreSlug(g[1]) } : null;
}
export function genreBySlug(kind: 'film' | 'tv', s: string) {
  const list = kind === 'tv' ? TV_GENRES : FILM_GENRES;
  const g = list.find(([, n]) => genreSlug(n) === s);
  return g ? { id: g[0], name: g[1], slug: s } : null;
}

/* ——— addresses ——— */
export const filmHref = (id: number, title = '') => `/film/${id}${slug(title) ? '-' + slug(title) : ''}/`;
export const showHref = (id: number, title = '') => `/tv/${id}${slug(title) ? '-' + slug(title) : ''}/`;
export const personHref = (id: number, name = '') => `/person/${id}${slug(name) ? '-' + slug(name) : ''}/`;
/** "370755-paterson" → 370755 */
export const idFrom = (param: string | undefined) => { const m = String(param ?? '').match(/^(\d{1,9})(?:-|$)/); return m ? +m[1] : null; };

/* ——— shapes ——— */
export interface Person { id: number; name: string; role: string; photo?: string; href: string }
export interface Provider { id: number; name: string; logo?: string }
export interface Where { link?: string; stream: Provider[]; free: Provider[]; rent: Provider[]; buy: Provider[] }
export interface Card { kind: 'film' | 'tv'; id: number; title: string; year?: number; poster?: string; href: string; role?: string; popularity?: number }
interface Common {
  id: number; title: string; original?: string; year?: number; overview: string; tagline?: string;
  poster?: string; backdrop?: string; genres: { id: number; name: string; slug: string }[];
  language?: { code: string; name: string }; countries: { code: string; name: string }[];
  cast: Person[]; crew: { job: string; people: Person[] }[]; where: Where | null; imdb?: string; trailer?: string;
  score?: number; votes?: number; keywords: string[];
}
export interface FilmPage extends Common { kind: 'film'; released?: string; runtime?: number; studios: string[]; directors: Person[]; writers: Person[] }
export interface ShowPage extends Common {
  kind: 'tv'; lastYear?: number; status?: string; networks: string[]; creators: Person[]; episodeRuntime?: number;
  seasons: { n: number; name: string; episodes?: number; year?: number; poster?: string; overview: string }[];
}

const person = (p: any, role: string): Person => ({ id: p.id, name: p.name, role, photo: img(p.profile_path, 'w185'), href: personHref(p.id, p.name) });
function where(wp: any): Where | null {
  const r = wp?.results?.[REGION];
  if (!r) return null;
  const list = (a: any[] | undefined) => (a ?? []).sort((x, y) => (x.display_priority ?? 99) - (y.display_priority ?? 99))
    .map((p) => ({ id: p.provider_id, name: p.provider_name, logo: img(p.logo_path, 'w92') }));
  const w = { link: r.link, stream: list(r.flatrate), free: [...list(r.free), ...list(r.ads)], rent: list(r.rent), buy: list(r.buy) };
  return w.stream.length || w.free.length || w.rent.length || w.buy.length ? w : null;
}
function trailer(videos: any) {
  const v = (videos?.results ?? []).filter((x: any) => x.site === 'YouTube' && /trailer|teaser/i.test(x.type));
  const best = v.find((x: any) => x.official && x.type === 'Trailer') ?? v.find((x: any) => x.type === 'Trailer') ?? v[0];
  return best?.key && /^[\w-]{6,20}$/.test(best.key) ? `https://www.youtube.com/watch?v=${best.key}` : undefined;
}
const CREW_ORDER = ['Director', 'Writer', 'Screenplay', 'Novel', 'Story', 'Director of Photography', 'Original Music Composer', 'Editor', 'Producer', 'Production Design', 'Costume Design'];
const CREW_LABEL: Record<string, string> = { Writer: 'Writer', Screenplay: 'Screenplay', Novel: 'Based on the novel by', Story: 'Story', 'Director of Photography': 'Cinematography', 'Original Music Composer': 'Music', 'Production Design': 'Production design', 'Costume Design': 'Costumes' };
function crewGroups(crew: any[], jobOf: (c: any) => string[]) {
  const groups = new Map<string, Person[]>();
  for (const c of crew ?? []) for (const job of jobOf(c)) {
    if (!CREW_ORDER.includes(job)) continue;
    const list = groups.get(job) ?? [];
    if (!list.some((p) => p.id === c.id)) list.push(person(c, job));
    groups.set(job, list);
  }
  return CREW_ORDER.filter((j) => groups.has(j)).map((j) => ({ job: CREW_LABEL[j] ?? j, people: groups.get(j)!.slice(0, 8) }));
}
function common(m: any, kind: 'film' | 'tv'): Omit<Common, 'cast' | 'crew'> {
  return {
    id: m.id, title: kind === 'film' ? m.title : m.name, original: (kind === 'film' ? m.original_title : m.original_name) || undefined,
    year: yearOf(kind === 'film' ? m.release_date : m.first_air_date), overview: plain(m.overview), tagline: m.tagline || undefined,
    poster: img(m.poster_path, 'w500'), backdrop: img(m.backdrop_path, 'w1280'),
    genres: (m.genres ?? []).map((g: any) => ({ id: g.id, name: g.name, slug: genreSlug(g.name) })),
    language: m.original_language ? { code: m.original_language, name: languageName(m.original_language)! } : undefined,
    countries: (m.production_countries ?? m.origin_country?.map((c: string) => ({ iso_3166_1: c })) ?? [])
      .map((c: any) => ({ code: c.iso_3166_1, name: c.name ?? countryName(c.iso_3166_1) })),
    where: where(m['watch/providers']), imdb: m.external_ids?.imdb_id || m.imdb_id || undefined, trailer: trailer(m.videos),
    score: m.vote_count > 20 ? Math.round(m.vote_average * 10) / 10 : undefined, votes: m.vote_count,
    keywords: (m.keywords?.keywords ?? m.keywords?.results ?? []).map((k: any) => k.name).slice(0, 12),
  };
}

/* ——— a film ——— */
export async function film(id: number): Promise<FilmPage | null> {
  if (!key()) return null;
  const m = await getJSON(q(`/movie/${id}`, { append_to_response: 'credits,watch/providers,external_ids,videos,keywords' }), { ttl: 21600 });
  if (!m?.id) return null;
  const crew = m.credits?.crew ?? [];
  return {
    kind: 'film', ...common(m, 'film'), released: m.release_date || undefined, runtime: m.runtime || undefined,
    studios: (m.production_companies ?? []).map((c: any) => c.name).slice(0, 4),
    directors: crew.filter((c: any) => c.job === 'Director').map((c: any) => person(c, 'Director')),
    writers: crew.filter((c: any) => c.department === 'Writing').map((c: any) => person(c, c.job)).filter((p: Person, i: number, a: Person[]) => a.findIndex((x) => x.id === p.id) === i).slice(0, 4),
    cast: (m.credits?.cast ?? []).slice(0, 40).map((c: any) => person(c, c.character || '')),
    crew: crewGroups(crew, (c) => [c.job]),
  };
}

/* ——— a TV show and its seasons ——— */
export async function show(id: number): Promise<ShowPage | null> {
  if (!key()) return null;
  const t = await getJSON(q(`/tv/${id}`, { append_to_response: 'aggregate_credits,watch/providers,external_ids,videos,keywords' }), { ttl: 21600 });
  if (!t?.id) return null;
  const ac = t.aggregate_credits ?? {};
  return {
    kind: 'tv', ...common(t, 'tv'), lastYear: yearOf(t.last_air_date), status: t.status || undefined,
    networks: (t.networks ?? []).map((n: any) => n.name).slice(0, 3),
    creators: (t.created_by ?? []).map((c: any) => person(c, 'Creator')),
    episodeRuntime: t.episode_run_time?.[0] || undefined,
    seasons: (t.seasons ?? []).filter((s: any) => s.season_number > 0).map((s: any) => ({
      n: s.season_number, name: s.name, episodes: s.episode_count || undefined, year: yearOf(s.air_date),
      poster: img(s.poster_path, 'w342'), overview: plain(s.overview, 400),
    })),
    cast: (ac.cast ?? []).slice(0, 40).map((c: any) => person(c, (c.roles ?? []).map((r: any) => r.character).filter(Boolean).slice(0, 2).join(', '))),
    crew: crewGroups(ac.crew ?? [], (c) => (c.jobs ?? []).map((j: any) => j.job)),
  };
}

/* ——— a person and their work ——— */
export interface PersonPage {
  id: number; name: string; bio: string; born?: string; died?: string; place?: string; photo?: string; known?: string; imdb?: string;
  groups: { label: string; items: Card[] }[];
}
const GROUP_LABEL: Record<string, string> = { Directing: 'Director', Writing: 'Writer', Acting: 'Actor', Camera: 'Cinematography', Sound: 'Music', Editing: 'Editor', Production: 'Producer' };
export async function personPage(id: number): Promise<PersonPage | null> {
  if (!key()) return null;
  const p = await getJSON(q(`/person/${id}`, { append_to_response: 'combined_credits,external_ids' }), { ttl: 21600 });
  if (!p?.id) return null;
  const card = (c: any, role: string): Card => {
    const kind = c.media_type === 'tv' ? 'tv' : 'film';
    const title = kind === 'tv' ? c.name : c.title;
    return { kind, id: c.id, title, year: yearOf(kind === 'tv' ? c.first_air_date : c.release_date), poster: img(c.poster_path, 'w342'),
      href: kind === 'tv' ? showHref(c.id, title) : filmHref(c.id, title), role, popularity: (c.vote_count ?? 0) + (c.popularity ?? 0) };
  };
  const groups = new Map<string, Card[]>();
  const add = (label: string, c: Card) => {
    const list = groups.get(label) ?? [];
    const same = list.find((x) => x.kind === c.kind && x.id === c.id);
    if (same) { if (c.role && same.role && !same.role.includes(c.role)) same.role = `${same.role}, ${c.role}`; }
    else list.push(c);
    groups.set(label, list);
  };
  for (const c of p.combined_credits?.cast ?? []) {
    if (c.media_type === 'tv' && (/^(self|himself|herself|host|narrator)\b/i.test(c.character ?? '') || (c.genre_ids ?? []).some((g: number) => g === 10767 || g === 10763))) continue;
    add('Actor', card(c, c.character ?? ''));
  }
  for (const c of p.combined_credits?.crew ?? []) {
    const label = GROUP_LABEL[c.department] ?? null;
    if (!label || (c.department === 'Production' && c.job !== 'Producer')) continue;
    add(label, card(c, c.job));
  }
  const known = GROUP_LABEL[p.known_for_department] ?? undefined;
  const order = [known, 'Director', 'Actor', 'Writer', 'Cinematography', 'Music', 'Editor', 'Producer'].filter((x, i, a) => x && a.indexOf(x) === i) as string[];
  return {
    id: p.id, name: p.name, bio: plain(p.biography, 1600), born: p.birthday || undefined, died: p.deathday || undefined,
    place: p.place_of_birth || undefined, photo: img(p.profile_path, 'w500'), known, imdb: p.external_ids?.imdb_id || p.imdb_id || undefined,
    groups: order.filter((l) => groups.has(l)).map((l) => ({ label: l, items: groups.get(l)!.filter((c) => c.title).sort((a, b) => (b.popularity ?? 0) - (a.popularity ?? 0)) })),
  };
}

/* ——— lists: by genre, year, language or service ——— */
export interface Filters { kind: 'film' | 'tv'; genre?: number; year?: number; decade?: number; language?: string; service?: number; sort?: 'popular' | 'top' | 'new'; page?: number }
export async function discover(f: Filters): Promise<{ items: Card[]; pages: number; total: number }> {
  if (!key()) return { items: [], pages: 0, total: 0 };
  const tv = f.kind === 'tv';
  const date = tv ? 'first_air_date' : 'primary_release_date';
  const today = new Date().toISOString().slice(0, 10);
  const params: Record<string, string | number | undefined> = {
    include_adult: 'false', page: Math.min(Math.max(f.page ?? 1, 1), 500),
    with_genres: f.genre, with_original_language: f.language,
    sort_by: f.sort === 'top' ? 'vote_average.desc' : f.sort === 'new' ? `${date}.desc` : 'popularity.desc',
    'vote_count.gte': f.sort === 'top' ? (f.language && f.language !== 'en' ? 40 : 250) : undefined,
  };
  if (f.year) params[tv ? 'first_air_date_year' : 'primary_release_year'] = f.year;
  else if (f.decade) { params[`${date}.gte`] = `${f.decade}-01-01`; params[`${date}.lte`] = `${f.decade + 9}-12-31`; }
  if (f.sort === 'new' && !params[`${date}.lte`]) params[`${date}.lte`] = today;
  if (f.service) { params.watch_region = REGION; params.with_watch_providers = f.service; params.with_watch_monetization_types = 'flatrate|free|ads'; }
  const j = await getJSON(q(`/discover/${tv ? 'tv' : 'movie'}`, params), { ttl: 3600 });
  const items = (j?.results ?? []).map((m: any): Card => {
    const title = tv ? m.name : m.title;
    return { kind: f.kind, id: m.id, title, year: yearOf(tv ? m.first_air_date : m.release_date), poster: img(m.poster_path, 'w342'), href: tv ? showHref(m.id, title) : filmHref(m.id, title) };
  });
  return { items, pages: Math.min(j?.total_pages ?? 0, 500), total: j?.total_results ?? 0 };
}

/** streaming services in India, most used first */
export async function services(): Promise<Provider[]> {
  if (!key()) return [];
  const j = await getJSON(q('/watch/providers/movie', { watch_region: REGION }), { ttl: 86400 });
  return (j?.results ?? [])
    .sort((a: any, b: any) => (a.display_priorities?.[REGION] ?? 999) - (b.display_priorities?.[REGION] ?? 999))
    .map((p: any) => ({ id: p.provider_id, name: p.provider_name, logo: img(p.logo_path, 'w92') }));
}

/* ——— search ——— */
export interface PersonCard { id: number; name: string; photo?: string; known?: string; href: string }
export async function searchAll(text: string): Promise<{ titles: Card[]; people: PersonCard[] }> {
  if (!key() || !text.trim()) return { titles: [], people: [] };
  const j = await getJSON(q('/search/multi', { query: text.trim().slice(0, 100), include_adult: 'false' }), { ttl: 600 });
  const titles: Card[] = [], people: PersonCard[] = [];
  for (const r of j?.results ?? []) {
    if (r.media_type === 'movie') titles.push({ kind: 'film', id: r.id, title: r.title, year: yearOf(r.release_date), poster: img(r.poster_path, 'w185'), href: filmHref(r.id, r.title), popularity: r.popularity });
    else if (r.media_type === 'tv') titles.push({ kind: 'tv', id: r.id, title: r.name, year: yearOf(r.first_air_date), poster: img(r.poster_path, 'w185'), href: showHref(r.id, r.name), popularity: r.popularity });
    else if (r.media_type === 'person') people.push({ id: r.id, name: r.name, photo: img(r.profile_path, 'w185'), known: GROUP_LABEL[r.known_for_department] ?? r.known_for_department, href: personHref(r.id, r.name) });
  }
  return { titles: titles.slice(0, 8), people: people.slice(0, 5) };
}
