// What a film, show or book page needs for sharing: names, the short line, the default painting and the short address.
// Used by the link-preview picture, the page's og tags and /api/share. Everything here is public catalogue data.
import type { SupabaseClient } from '@supabase/supabase-js';
import { film, show, idFrom } from '../catalog/tmdb';
import { olBook, gbBook, bookKey } from '../catalog/books';
import { rowBySlug } from '../catalog/onsite';
import { credit } from './credits';
import { backgroundFor } from './backgrounds';
import { isBackground, type Background } from './backgrounds';
import type { Kind } from '../kinds';

export interface PageBits {
  kind: 'film' | 'tv' | 'book'; title: string; year?: number; creator: string; line?: string; bg: Background;
  cover?: string; short: string | null; color?: string;
}

/** a title's saved line and painting (TMDB's tagline and the genre rules come first / after); only reads, never writes.
 *  Before supabase/changes/005 and 006 there is nothing saved. */
async function saved(sb: SupabaseClient, col: 'tmdb_id' | 'ol_key' | 'slug', value: string | number, kind: Kind): Promise<{ line?: string; bg?: Background }> {
  try {
    const pick = async (cols: string) => sb.from('titles').select(cols).eq('kind', kind).eq(col, value).not('tagline', 'is', null).limit(1);
    let { data, error } = await pick('tagline, card_bg');
    if (error) ({ data, error } = await pick('tagline'));
    const r = (error ? undefined : data?.[0]) as { tagline?: string; card_bg?: string } | undefined;
    return { line: r?.tagline || undefined, bg: isBackground(r?.card_bg) ? (r!.card_bg as Background) : undefined };
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
      bg: sv.bg ?? backgroundFor(p.genres.map((g) => g.name), 'cinema'),
    };
  }
  if (type === 'book') {
    const k = bookKey(seg);
    if (!k) return null;
    if ('slug' in k) {
      const row = sb ? await rowBySlug(sb, 'book', k.slug) : null;
      if (!row) return null;
      const sv = sb ? await saved(sb, 'slug', row.slug, 'book') : {};
      return { kind: 'book', title: row.title, year: row.year ?? undefined, creator: row.creator, cover: row.cover_url ?? undefined, bg: sv.bg ?? 'reading', short: `/b/${row.slug}`, line: sv.line };
    }
    const b = 'ol' in k ? await olBook(k.ol) : await gbBook(k.gb);
    if (!b) return null;
    const sv = sb && 'ol' in k ? await saved(sb, 'ol_key', k.ol, 'book') : {};
    return {
      kind: 'book', title: b.title, year: b.year, cover: b.cover, creator: credit(b.authors.map((a) => a.name)),
      bg: sv.bg ?? backgroundFor(b.subjects.map((s) => s.name), 'reading'),
      short: 'ol' in k ? `/b/${k.ol.toLowerCase()}` : `/b/gb-${k.gb}`,
      line: sv.line,
    };
  }
  return null;
}
