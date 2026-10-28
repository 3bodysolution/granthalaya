// Cloudflare Turnstile: a quiet "are you a person?" check when a new shelf is created.
import { env } from './supabase';

// Cloudflare's own test keys (public, from their documentation): the widget always passes. They are used only when the site runs
// on this computer (`npm run dev`, address localhost): `import.meta.env.DEV` is false in every build, so Vercel never uses them.
const TEST_SITE_KEY = '1x00000000000000000000AA';
const TEST_SECRET = '1x0000000000000000000000000000000AA';
const onThisComputer = (host?: string | null) => import.meta.env.DEV && /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host ?? '');

export const turnstileSiteKey = (host?: string | null) => (onThisComputer(host) ? TEST_SITE_KEY : env('PUBLIC_TURNSTILE_SITE_KEY'));

export async function isHuman(token: unknown, ip?: string | null, host?: string | null): Promise<boolean> {
  const secret = onThisComputer(host) ? TEST_SECRET : env('TURNSTILE_SECRET_KEY');
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
