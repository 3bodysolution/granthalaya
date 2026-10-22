// Book descriptions on the site. The page never waits for anything new: it shows the saved description (titles.description),
// else the live Open Library or Google Books text run through cleanBlurb. Finding a better one (Wikipedia's intro, or a short
// AI version of a long text) runs in the background after the page is sent, once per book, and only for books already in our
// catalogue, so crawlers on unsaved books can't spend the AI allowance. The rules are in describe-core.mjs.
import type { SupabaseClient } from '@supabase/supabase-js';
import { adminClient, env } from '../supabase';
import { olBook } from './books';
import { later } from '../cards/tagline';
import { cleanBlurb as clean, describeBook, MAX } from './describe-core.mjs';

export const cleanBlurb: (text: string | null | undefined) => string = clean;

export type DescriptionSource = 'wikipedia' | 'openlibrary' | 'ai-wikipedia' | 'ai-openlibrary';
export interface SavedDescription { text?: string; source?: DescriptionSource; url?: string; checked: boolean; column: boolean }

const RECHECK_DAYS = 90;
const fresh = (at?: string | null) => !!at && Date.now() - Date.parse(at) < RECHECK_DAYS * 86400000;

/** what is saved on the title; `column` is false before supabase/changes/007 is run */
export async function savedDescription(sb: SupabaseClient, titleId: string): Promise<SavedDescription> {
  try {
    const { data, error } = await sb.from('titles').select('description, description_source, description_url, description_checked_at').eq('id', titleId).maybeSingle();
    if (error) return { checked: true, column: false };
    const r = data as { description?: string | null; description_source?: DescriptionSource | null; description_url?: string | null; description_checked_at?: string | null } | null;
    return { text: r?.description || undefined, source: r?.description_source ?? undefined, url: r?.description_url ?? undefined, checked: !!r?.description || fresh(r?.description_checked_at), column: true };
  } catch { return { checked: true, column: false }; }
}

const inflight = new Set<string>();

/** look for a better description in the background and save it if the title still has none. Never throws. */
export function describeLater(titleId: string) {
  if (inflight.has(titleId)) return;
  inflight.add(titleId);
  later((async () => {
    try {
      const admin = adminClient();
      const { data: r } = await admin.from('titles').select('id, kind, title, creator, year, ol_key, description, description_checked_at').eq('id', titleId).maybeSingle();
      if (!r || r.kind !== 'book' || r.description || fresh(r.description_checked_at)) return;
      const olText = r.ol_key ? (await olBook(r.ol_key).catch(() => null))?.description : null;   // Google Books text is never saved
      const keys = { gemini: env('GEMINI_API_KEY'), geminiModel: env('GEMINI_MODEL'), groq: env('GROQ_API_KEY'), groqModel: env('GROQ_MODEL') };
      const d = await describeBook({ title: r.title, creator: r.creator, year: r.year, olText }, keys);
      const checkedAt = new Date().toISOString();
      if (d.text) {
        await admin.from('titles').update({ description: d.text.slice(0, MAX), description_source: d.source, description_url: d.url, description_checked_at: checkedAt })
          .eq('id', titleId).is('description', null);
      } else {
        await admin.from('titles').update({ description_checked_at: checkedAt }).eq('id', titleId).is('description', null);
      }
    } catch (err) {
      console.error('Could not find a book description', err);
    } finally { inflight.delete(titleId); }
  })());
}
