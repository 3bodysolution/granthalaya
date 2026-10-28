// The shared catalogue: one row per book, film, TV season or essay, used by everyone who adds it.
// Only the server writes here (with the secret key), after checking what it's given.
import { waitUntil } from '@vercel/functions';
import { ensureFactsLater } from './cards/tagline';
import { adminClient, env } from './supabase';
import { filmDetails, seasonDetails, showSeasons, type Hit } from './lookup';
import { KINDS, type Kind } from './kinds';
import { getTrivia } from './trivia.mjs';

export const slugify = (s: string) =>
  s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/['’]/g, '').replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 70).replace(/-+$/, '') || 'untitled';

// Covers are only taken from places we trust to serve real covers.
// (the two bookshops' cover folders too, with their permission; pages show those through /api/cover)
const COVER_HOSTS = /^https:\/\/(image\.tmdb\.org\/|covers\.openlibrary\.org\/|books\.google\.com\/books\/content\?|cdn\.shopify\.com\/s\/files\/1\/0800\/1214\/9058\/|www\.bookganga\.com\/eBooks\/Content\/images\/books\/)/;
const clip = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.normalize('NFC').trim().slice(0, max) : undefined);
const num = (v: unknown, min: number, max: number) => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) && n >= min && n <= max ? Math.round(n) : undefined;
};
const httpUrl = (v: unknown) => {
  const s = clip(v, 1000);
  try { return s && /^https?:$/.test(new URL(s).protocol) ? s : undefined; } catch { return undefined; }
};

/** tidy whatever the browser sent about a title */
export function cleanHit(raw: unknown): Hit | null {
  if (!raw || typeof raw !== 'object') return null;
  const h = raw as Record<string, unknown>;
  const kind = KINDS.includes(h.kind as Kind) ? (h.kind as Kind) : null;
  const title = clip(h.title, 300);
  if (!kind || !title) return null;
  const cover = clip(h.cover, 600);
  return {
    kind, title, creator: clip(h.creator, 200), year: num(h.year, 1, 2100),
    pages: num(h.pages, 1, 100000), runtime: num(h.runtime, 1, 100000), words: num(h.words, 1, 10000000),
    episodes: num(h.episodes, 1, 5000), season: num(h.season, 0, 300),
    link: httpUrl(h.link), source: clip(h.source, 120), cover: cover && COVER_HOSTS.test(cover) ? cover : undefined,
    tmdbId: num(h.tmdbId, 1, 1e9), olKey: typeof h.olKey === 'string' && /^OL\d+W$/.test(h.olKey) ? h.olKey : undefined, from: 'you',
  };
}

async function freeSlug(base: string, year?: number) {
  const db = adminClient();
  const tries = [base, year ? `${base}-${year}` : null, ...Array.from({ length: 20 }, (_, i) => `${base}-${i + 2}`)].filter(Boolean) as string[];
  const { data } = await db.from('titles').select('slug').in('slug', tries);
  const taken = new Set((data ?? []).map((r) => r.slug));
  return tries.find((s) => !taken.has(s)) ?? `${base}-${Date.now().toString(36)}`;
}

/** facts are picked in the background after saving, so nobody waits for them */
export function factsLater(title: { id: string; kind: Kind; title: string; year?: number | null; creator?: string | null }) {
  if (title.kind === 'essay') return;
  const keys = { gemini: env('GEMINI_API_KEY'), geminiModel: env('GEMINI_MODEL'), groq: env('GROQ_API_KEY'), groqModel: env('GROQ_MODEL') };
  if (!keys.gemini && !keys.groq) return;
  const job = (async () => {
    const t = await getTrivia({ title: title.title, year: title.year ?? undefined, creator: title.creator ?? undefined, type: title.kind }, keys);
    if (t?.trivia?.length) await adminClient().from('titles').update({ trivia: t.trivia, trivia_source: t.source }).eq('id', title.id).eq('trivia', '[]');
  })().catch((e) => console.error('Facts for a new title could not be picked', e));
  try { waitUntil(job); } catch { /* not on Vercel: the promise just finishes on its own */ }
}

/** find this title in the catalogue, or add it. Returns its id. */
export async function titleFor(raw: Hit, userId: string): Promise<{ id: string; slug: string } | { error: string }> {
  let h = raw;
  // trust TMDB's own details over what the browser sent
  if (h.tmdbId && h.kind === 'film') h = (await filmDetails(h.tmdbId).catch(() => null)) ?? h;
  // a TV show with no season is the whole show (saved as "want to watch")
  if (h.tmdbId && h.kind === 'tv' && !h.season) return showFor(h.tmdbId, userId);
  let show: { id: string } | { error: string } | null = null;
  if (h.tmdbId && h.kind === 'tv') {
    [h, show] = await Promise.all([seasonDetails(h.tmdbId, h.season!).catch(() => null).then((x) => x ?? h), showFor(h.tmdbId, userId)]);
  }
  const showId = show && 'id' in show ? show.id : null;
  const db = adminClient();

  // already in the catalogue?
  let q = db.from('titles').select('id, slug').eq('kind', h.kind).limit(1);
  if (h.tmdbId) q = q.eq('tmdb_id', h.tmdbId).eq(h.kind === 'tv' ? 'season' : 'kind', h.kind === 'tv' ? h.season! : h.kind);
  else if (h.olKey) q = q.eq('ol_key', h.olKey);
  else if (h.kind === 'essay' && h.link) q = q.eq('link', h.link);
  else {
    q = q.ilike('title', h.title.replace(/[%_\\]/g, (c) => `\\${c}`));
    q = h.year ? q.eq('year', h.year) : q.is('year', null);
    if (h.creator) q = q.ilike('creator', h.creator.replace(/[%_\\]/g, (c) => `\\${c}`));
  }
  let { data: found } = await q.maybeSingle();
  // an older row with no TMDB or Open Library id is the same work: give it the id and use it, instead of making a second row
  if (!found && (h.tmdbId || h.olKey) && (h.kind === 'film' || h.kind === 'book')) found = await adoptOlder(h);
  if (found) {
    // a season added before shows had their own rows learns its show here
    if (showId) await db.from('titles').update({ show_id: showId }).eq('id', found.id).is('show_id', null);
    return found;
  }

  // a gentle limit on new catalogue entries per person
  const { count } = await db.from('titles').select('id', { count: 'exact', head: true }).eq('created_by', userId).gt('created_at', new Date(Date.now() - 3600_000).toISOString());
  if ((count ?? 0) >= 40) return { error: 'That’s a lot of new titles at once. Try again in a little while.' };

  const base = slugify(h.kind === 'tv' && h.season ? `${h.title} season ${h.season}` : h.title);
  const row = {
    kind: h.kind, slug: await freeSlug(base, h.year), title: h.title, creator: h.creator ?? '', year: h.year ?? null,
    season: h.kind === 'tv' ? h.season ?? null : null, episodes: h.episodes ?? null, runtime: h.runtime ?? null,
    pages: h.pages ?? null, words: h.words ?? null, cover_url: h.kind === 'essay' ? null : h.cover ?? null,
    link: h.link ?? null, source: h.source ?? null, tmdb_id: h.tmdbId ?? null, ol_key: h.olKey ?? null, created_by: userId,
    ...(showId ? { show_id: showId } : {}),
  };
  let { data, error } = await db.from('titles').insert(row).select('id, slug, kind, title, year, creator').single();
  if (error?.code === '23505') {
    // someone added the same thing a moment ago, or the address was taken: try once more with a fresh one
    ({ data, error } = await db.from('titles').insert({ ...row, slug: `${base}-${Date.now().toString(36)}` }).select('id, slug, kind, title, year, creator').single());
  }
  if (error || !data) return { error: 'Couldn’t add that title. Please try again.' };
  factsLater(data as any);
  ensureFactsLater(data.id);   // the card line and painting too
  return { id: data.id, slug: data.slug };
}

/** the same film or book already in the catalogue without an id (copied from the old library): same kind, same title,
 *  year within one, same creator when both have one. It learns the id, so nothing is split. */
async function adoptOlder(h: Hit): Promise<{ id: string; slug: string } | null> {
  const db = adminClient();
  const idCol = h.kind === 'film' ? 'tmdb_id' : 'ol_key';
  const idVal = h.kind === 'film' ? h.tmdbId : h.olKey;
  if (!idVal) return null;
  let q = db.from('titles').select('id, slug, year, creator').eq('kind', h.kind).is(idCol, null).ilike('title', h.title.replace(/[%_\\]/g, (c) => `\\${c}`));
  if (h.year) q = q.gte('year', h.year - 1).lte('year', h.year + 1);
  const { data } = await q.limit(10);
  const key = (s?: string | null) => slugify(s ?? '');
  const fits = (data ?? []).filter((r) => !h.creator || !r.creator || key(r.creator).includes(key(h.creator)) || key(h.creator).includes(key(r.creator)));
  if (!fits.length) return null;
  const best = fits.find((r) => r.year === h.year) ?? fits[0];
  const { error } = await db.from('titles').update({ [idCol]: idVal }).eq('id', best.id).is(idCol, null);
  if (error) return null;   // that id went to another row a moment ago: the caller makes (or finds) it the usual way
  return { id: best.id, slug: best.slug };
}

/** a TV show's own row (kind 'tv', no season), above its season rows: found, or made from TMDB. Its slug is the plain name ("dark"). */
export async function showFor(tmdbId: number, userId: string | null): Promise<{ id: string; slug: string } | { error: string }> {
  const db = adminClient();
  const find = () => db.from('titles').select('id, slug').eq('kind', 'tv').eq('tmdb_id', tmdbId).is('season', null).limit(1).maybeSingle();
  const { data: found } = await find();
  if (found) return found;
  const s = await showSeasons(tmdbId).catch(() => null);
  if (!s) return { error: 'Couldn’t find that show. Please try again.' };
  const row = {
    kind: 'tv', slug: await freeSlug(slugify(s.title), s.year), title: s.title, creator: s.creator ?? '', year: s.year ?? null, season: null,
    episodes: s.seasons?.reduce((n, x) => n + (x.episodes ?? 0), 0) || null, seasons: s.seasons?.filter((x) => x.aired).length || null,   // released seasons only
    cover_url: s.cover && COVER_HOSTS.test(s.cover) ? s.cover : null, link: `https://www.themoviedb.org/tv/${tmdbId}`,
    tmdb_id: tmdbId, created_by: userId,
  };
  const { data, error } = await db.from('titles').insert(row).select('id, slug, kind, title, year, creator').single();
  if (error?.code === '23505') { const { data: again } = await find(); if (again) return again; }   // added a moment ago by someone else
  if (error || !data) return { error: 'Couldn’t add that show. Please try again.' };
  // the seasons already in the catalogue point at it
  await db.from('titles').update({ show_id: data.id }).eq('kind', 'tv').eq('tmdb_id', tmdbId).not('season', 'is', null).is('show_id', null);
  factsLater(data as any);
  ensureFactsLater(data.id);
  return { id: data.id, slug: data.slug };
}
