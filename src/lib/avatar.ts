// Profile photos: only a Google profile photo is ever accepted (the database checks the same rule).
// Anything else would make every visitor's browser load a picture from somebody else's server.
import type { SupabaseClient } from '@supabase/supabase-js';

export const AVATAR_PATTERN = /^https:\/\/lh3\.googleusercontent\.com\/[A-Za-z0-9_./=+%-]+$/;

/** the address if it is a Google profile photo, else null */
export function googleAvatar(url: unknown): string | null {
  return typeof url === 'string' && url.length <= 600 && AVATAR_PATTERN.test(url) ? url : null;
}

/** The photo Google itself gave for this account. `user_metadata` can be edited by the person, so it is
 *  not trusted; the sign-in identity can't be. */
export async function trustedGooglePhoto(sb: SupabaseClient): Promise<string | null> {
  const { data } = await sb.auth.getUserIdentities().catch(() => ({ data: null }));
  const g = data?.identities?.find((i) => i.provider === 'google');
  const d = (g?.identity_data ?? {}) as Record<string, unknown>;
  return googleAvatar(d.avatar_url) ?? googleAvatar(d.picture);
}
