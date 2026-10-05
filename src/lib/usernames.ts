// Is a username free? Server only (it looks past blocks and privacy to be sure).
import { adminClient } from './supabase';
import { usernameProblem } from './kinds';

export async function usernameStatus(u: string, me?: string): Promise<{ ok: boolean; message: string }> {
  const problem = usernameProblem(u);
  if (problem) return { ok: false, message: problem };
  const db = adminClient();
  const [{ data: reserved }, { data: p }, { data: h }] = await Promise.all([
    db.rpc('username_reserved', { u }),
    db.from('profiles').select('id').eq('username', u).maybeSingle(),
    db.from('username_history').select('user_id').eq('old_username', u).maybeSingle(),
  ]);
  if (reserved) return { ok: false, message: 'That one isn’t available.' };
  if (p && p.id !== me) return { ok: false, message: 'Someone already has that one.' };
  if (h && h.user_id !== me) return { ok: false, message: 'That one isn’t available.' };
  return { ok: true, message: p?.id === me ? 'That’s yours.' : 'Available' };
}

/** a few free usernames based on someone's name or email */
export async function suggestUsernames(seed: string, me?: string): Promise<string[]> {
  const base = seed.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 14) || 'reader';
  const first = base.split('_')[0];
  const tries = [...new Set([base.replace(/_/g, ''), base, `${first}_reads`, `${first}_watches`, `${base.replace(/_/g, '')}${new Date().getFullYear() % 100}`, `${first}${Math.floor(10 + Math.random() * 89)}`])]
    .filter((u) => !usernameProblem(u));
  const out: string[] = [];
  for (const u of tries) {
    if (out.length >= 3) break;
    if ((await usernameStatus(u, me)).ok) out.push(u);
  }
  return out;
}
