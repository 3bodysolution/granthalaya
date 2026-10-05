// Cloudflare Turnstile: a quiet "are you a person?" check when a new shelf is created.
import { env } from './supabase';

export const turnstileSiteKey = () => env('PUBLIC_TURNSTILE_SITE_KEY');

export async function isHuman(token: unknown, ip?: string | null): Promise<boolean> {
  const secret = env('TURNSTILE_SECRET_KEY');
  if (!secret) return true; // not set up on this copy of the site
  if (typeof token !== 'string' || !token) return false;
  try {
    const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body: new URLSearchParams({ secret, response: token, ...(ip ? { remoteip: ip } : {}) }),
    });
    return (await r.json())?.success === true;
  } catch {
    return false;
  }
}
