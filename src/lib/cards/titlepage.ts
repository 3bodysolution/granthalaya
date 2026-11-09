// What a film, show or book page needs for sharing: names, the short line and the short address.
// Used by the link-preview picture, the page's og tags and /api/share. Everything here is public catalogue data.
import type { SupabaseClient } from '@supabase/supabase-js';
import { film, show, idFrom } from '../catalog/tmdb';
import { olBook, gbBook, bookKey } from '../catalog/books';
import { rowBySlug } from '../catalog/onsite';
import { credit } from './credits';
import type { Kind } from '../kinds';

export interface PageBits {
  kind: 'film' | 'tv' | 'book'; title: string; year?: number; creator: string; line?: string;
  cover?: string; short: string | null; color?: string;
}

/** a title's saved line (TMDB's tagline comes first); only reads, never writes. */
async function saved(sb: SupabaseClient, col: 'tmdb_id' | 'ol_key' | 'slug', value: string | number, kind: Kind): Promise<{ line?: string }> {
  try {
    const { data, error } = await sb.from('titles').select('tagline').eq('kind', kind).eq(col, value).not('tagline', 'is', null).limit(1);
    const r = (error ? undefined : data?.[0]) as { tagline?: string } | undefined;
    return { line: r?.tagline || undefined };
  } catch { return {}; }
}

/** `type` is film, tv or book; `seg` is the page's address part ("1234-hope", "ol123w-orbital", "gb-abc") */
export async function pageBits(sb: SupabaseClient | undefined, type: string, seg: string): Promise<PageBits | null> {
  if (type === 'film' || type === 'tv') {
    const id = idFrom(seg);
    const p = id ? await (type === 'film' ? film(id) : show(id)) : null;
    if (!p) return null;
    const sv = sb ? await saved(sb, 'tmdb_id', p.id, type) : {};
    const line = (p.tagline && p.tagline.length <= 90 ? p.tagline : undefined) ?? sv.line;
    return {
      kind: type, title: p.title, year: p.year, line, cover: p.poster, short: `/${type === 'film' ? 'f' : 't'}/${p.id}`,
      creator: credit((p.kind === 'film' ? p.directors : p.creators).map((x) => x.name)),
    };
  }
  if (type === 'book') {
    const k = bookKey(seg);
    if (!k) return null;
    if ('slug' in k) {
      const row = sb ? await rowBySlug(sb, 'book', k.slug) : null;
      if (!row) return null;
      const sv = sb ? await saved(sb, 'slug', row.slug, 'book') : {};
      return { kind: 'book', title: row.title, year: row.year ?? undefined, creator: row.creator, cover: row.cover_url ?? undefined, short: `/b/${row.slug}`, line: sv.line };
    }
    const b = 'ol' in k ? await olBook(k.ol) : await gbBook(k.gb);
    if (!b) return null;
    const sv = sb && 'ol' in k ? await saved(sb, 'ol_key', k.ol, 'book') : {};
    return {
      kind: 'book', title: b.title, year: b.year, cover: b.cover, creator: credit(b.authors.map((a) => a.name)),
      short: 'ol' in k ? `/b/${k.ol.toLowerCase()}` : `/b/gb-${k.gb}`,
      line: sv.line,
    };
  }
  return null;
}
