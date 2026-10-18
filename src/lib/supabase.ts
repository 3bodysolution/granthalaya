// Talking to the database. Server only.
//
// · serverClient: acts as the person visiting (their sign-in cookie), so the database's privacy rules apply.
// · adminClient: the website itself, with the secret key. Used only for the shared catalogue, account
//   deletion and the reports page, and always after the code has checked who is asking.
import { createServerClient, parseCookieHeader } from '@supabase/ssr';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { AstroCookies } from 'astro';
import { timedFetch } from './timing';

export const env = (k: string): string => ((globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.[k] ?? (import.meta.env as Record<string, string>)[k] ?? '') as string;

export const supabaseReady = () => !!(env('PUBLIC_SUPABASE_URL') && env('PUBLIC_SUPABASE_PUBLISHABLE_KEY'));

const NINETY_DAYS = 60 * 60 * 24 * 90;

export function serverClient(request: Request, cookies: AstroCookies): SupabaseClient {
  return createServerClient(env('PUBLIC_SUPABASE_URL'), env('PUBLIC_SUPABASE_PUBLISHABLE_KEY'), {
    cookies: {
      getAll() {
        return parseCookieHeader(request.headers.get('Cookie') ?? '').map((c) => ({ name: c.name, value: c.value ?? '' }));
      },
      setAll(list) {
        for (const { name, value, options } of list) {
          try { cookies.set(name, value, { ...options, path: '/' }); } catch { /* the page has already started sending */ }
        }
      },
    },
    // sign-in lasts 90 days on a device
    cookieOptions: { maxAge: NINETY_DAYS, sameSite: 'lax', secure: true, path: '/' },
    global: { fetch: timedFetch },
  });
}

let admin: SupabaseClient | null = null;
export function adminClient(): SupabaseClient {
  const key = env('SUPABASE_SECRET_KEY');
  if (!key) throw new Error('SUPABASE_SECRET_KEY is missing.');
  admin ??= createClient(env('PUBLIC_SUPABASE_URL'), key, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: timedFetch } });
  return admin;
}

/** a database error, in words a person can read (our own rules raise friendly messages) */
export function dbMessage(e: { message?: string; code?: string } | null | undefined, fallback = 'Something went wrong. Please try again.') {
  if (!e) return fallback;
  if (e.code === 'P0001' && e.message) return e.message;
  if (e.code === '23505') return 'That’s already taken.';
  return fallback;
}
