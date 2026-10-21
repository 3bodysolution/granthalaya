// What a film, show or book page needs for sharing: names, the short line, the default painting and the short address.
// Used by the link-preview picture, the page's og tags and /api/share. Everything here is public catalogue data.
import type { SupabaseClient } from '@supabase/supabase-js';
import { film, show, idFrom } from '../catalog/tmdb';
import { olBook, gbBook, bookKey } from '../catalog/books';
import { rowBySlug } from '../catalog/onsite';
import { credit } from './credits';
import { backgroundFor } from './backgrounds';
import type { Background } from './backgrounds';
import type { Kind } from '../kinds';

export interface PageBits {
  kind: 'film' | 'tv' | 'book'; title: string; year?: number; creator: string; line?: string; bg: Background;
  cover?: string; short: string | null; color?: string;
}

/** a title's saved line (TMDB's tagline is used first by the caller); only reads, never writes. Before supabase/changes/005 there is none. */
async function savedLine(sb: SupabaseClient, col: 'tmdb_id' | 'ol_key' | 'slug', value: string | number, kind: Kind): Promise<string | undefined> {
  try {
    const { data, error } = await sb.from('titles').select('tagline').eq('kind', kind).eq(col, value).not('tagline', 'is', null).limit(1);
    return error ? undefined : (data?.[0] as { tagline?: string } | undefined)?.tagline || undefined;
  } catch { return undefined; }
}

/** `type` is film, tv or book; `seg` is the page's address part ("1234-hope", "ol123w-orbital", "gb-abc") */
export async function pageBits(sb: SupabaseClient | undefined, type: string, seg: string): Promise<PageBits | null> {
  if (type === 'film' || type === 'tv') {
    const id = idFrom(seg);
    const p = id ? await (type === 'film' ? film(id) : show(id)) : null;
    if (!p) return null;
    const line = (p.tagline && p.tagline.length <= 90 ? p.tagline : undefined) ?? (sb ? await savedLine(sb, 'tmdb_id', p.id, type) : undefined);
    return {
      kind: type, title: p.title, year: p.year, line, cover: p.poster, short: `/${type === 'film' ? 'f' : 't'}/${p.id}`,
      creator: credit((p.kind === 'film' ? p.directors : p.creators).map((x) => x.name)),
      bg: backgroundFor(p.genres.map((g) => g.name), 'cinema'),
    };
  }
  if (type === 'book') {
    const k = bookKey(seg);
    if (!k) return null;
    if ('slug' in k) {
      const row = sb ? await rowBySlug(sb, 'book', k.slug) : null;
      if (!row) return null;
      return { kind: 'book', title: row.title, year: row.year ?? undefined, creator: row.creator, cover: row.cover_url ?? undefined, bg: 'reading', short: `/b/${row.slug}`, line: sb ? await savedLine(sb, 'slug', row.slug, 'book') : undefined };
    }
    const b = 'ol' in k ? await olBook(k.ol) : await gbBook(k.gb);
    if (!b) return null;
    return {
      kind: 'book', title: b.title, year: b.year, cover: b.cover, creator: credit(b.authors.map((a) => a.name)),
      bg: backgroundFor(b.subjects.map((s) => s.name), 'reading'),
      short: 'ol' in k ? `/b/${k.ol.toLowerCase()}` : `/b/gb-${k.gb}`,
      line: sb && 'ol' in k ? await savedLine(sb, 'ol_key', k.ol, 'book') : undefined,
    };
  }
  return null;
}
