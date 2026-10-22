// "Just saved": a title the person has only saved for later. A bookmark can be tapped to take it back only then.
// Anything more (another status, a rating, a heart, a review or its tagline, a place, or a second visit) stays put.
import type { SupabaseClient } from '@supabase/supabase-js';

export interface LogRow { id: string; title_id: string; status: string; rating: number | string | null; loved: boolean; notes: string; where_seen: string; tagline?: string }
export const LOG_COLS = 'id, title_id, status, rating, loved, notes, where_seen, tagline';

const empty = (l: LogRow) => l.rating == null && !l.loved && !l.notes && !l.where_seen && !l.tagline;

/** which of these logs (all of one person's logs for the titles in question) are only a save */
export async function plainOf(sb: SupabaseClient, logs: LogRow[]): Promise<Set<string>> {
  const visits = new Map<string, number>();
  for (const l of logs) visits.set(l.title_id, (visits.get(l.title_id) ?? 0) + 1);
  return new Set(logs.filter((l) => l.status === 'want' && empty(l) && visits.get(l.title_id) === 1).map((l) => l.id));
}

export async function isPlainSave(sb: SupabaseClient, userId: string, logId: string): Promise<boolean> {
  const { data: one } = await sb.from('logs').select('title_id').eq('id', logId).eq('user_id', userId).maybeSingle();
  if (!one) return false;
  const { data } = await sb.from('logs').select(LOG_COLS).eq('user_id', userId).eq('title_id', one.title_id);
  return (await plainOf(sb, (data ?? []) as LogRow[])).has(logId);
}

/** the log to take back when its bookmark is tapped: only for a title that is just saved */
export const savedId = (m?: { plain: boolean; id: string }) => (m?.plain ? m.id : undefined);

/** which of these logs have nothing on them but a status (any status): no rating, heart, review, tagline or place, and no other visit */
export async function bareOf(sb: SupabaseClient, logs: LogRow[]): Promise<Set<string>> {
  const visits = new Map<string, number>();
  for (const l of logs) visits.set(l.title_id, (visits.get(l.title_id) ?? 0) + 1);
  return new Set(logs.filter((l) => empty(l) && visits.get(l.title_id) === 1).map((l) => l.id));
}

export async function isBareEntry(sb: SupabaseClient, userId: string, logId: string): Promise<boolean> {
  const { data: one } = await sb.from('logs').select('title_id').eq('id', logId).eq('user_id', userId).maybeSingle();
  if (!one) return false;
  const { data } = await sb.from('logs').select(LOG_COLS).eq('user_id', userId).eq('title_id', one.title_id);
  return (await bareOf(sb, (data ?? []) as LogRow[])).has(logId);
}
