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

/* ——— photos people upload themselves (Supabase Storage, bucket "avatars") ———
 * One file per person at avatars/<user id>/<random name>.webp, public to read, written only by the website after it has
 * checked and re-drawn the picture. The database accepts such an address only for the person's own folder (014 / avatar_url_ok). */
import { env } from './supabase';

export const AVATAR_BUCKET = 'avatars';
export const AVATAR_MAX_BYTES = 5 * 1024 * 1024;
export const AVATARS_PER_HOUR = 10;

const publicBase = () => `${env('PUBLIC_SUPABASE_URL').replace(/\/+$/, '')}/storage/v1/object/public/${AVATAR_BUCKET}/`;

/** the public address of an uploaded photo */
export const avatarAddress = (path: string) => publicBase() + path;

/** the file path (<user id>/<name>.webp) if this address is one of our uploaded photos for this person, else null */
export function ownAvatarPath(url: unknown, userId: string): string | null {
  if (typeof url !== 'string' || !url.startsWith(publicBase())) return null;
  const path = url.slice(publicBase().length);
  return new RegExp(`^${userId}/[A-Za-z0-9_-]{8,64}[.]webp$`).test(path) ? path : null;
}

/** what the first bytes of a file say it is; the label the browser gave is not trusted. Only still pictures are named. */
export function sniffImage(b: Buffer): 'jpeg' | 'png' | 'webp' | 'heic' | 'animated' | null {
  if (b.length < 16) return null;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
  if (b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    // an animated PNG has an "acTL" chunk before its picture data
    const idat = b.indexOf('IDAT'), actl = b.indexOf('acTL');
    return actl > 0 && (idat < 0 || actl < idat) ? 'animated' : 'png';
  }
  if (b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') {
    // an animated WebP says so in its header (the animation flag of the VP8X chunk), and carries an ANIM chunk
    if (b.toString('latin1', 12, 16) === 'VP8X' && (b[20] & 0x02)) return 'animated';
    return b.includes('ANIM') && b.includes('ANMF') ? 'animated' : 'webp';
  }
  if (b.toString('latin1', 4, 8) === 'ftyp' && /^(heic|heix|hevc|hevx|heim|heis|hevm|hevs|mif1|msf1)/.test(b.toString('latin1', 8, 12))) return 'heic';
  return null;
}

let ready: { at: number; ok: boolean } | null = null;
/** is the avatars bucket there yet (014 applied)? Asked at most once a minute; until then uploading says "coming soon" */
export async function avatarsReady(db: SupabaseClient): Promise<boolean> {
  if (ready && Date.now() - ready.at < 60_000) return ready.ok;
  const { data, error } = await db.storage.getBucket(AVATAR_BUCKET);
  const { error: e2 } = await db.from('avatar_uploads').select('at', { head: true, count: 'exact' }).limit(1);
  ready = { at: Date.now(), ok: !error && !!data && !e2 };
  return ready.ok;
}

/** delete one uploaded photo (given its public address); anything that is not ours is left alone */
export async function removeUploaded(db: SupabaseClient, url: string | null | undefined, userId: string) {
  const path = ownAvatarPath(url, userId);
  if (path) await db.storage.from(AVATAR_BUCKET).remove([path]).catch(() => null);
}

/** delete every uploaded photo of a person (account deletion, an admin removing a photo): the folder is listed 100 at a time
 *  and emptied until nothing is left (a file that can't be removed ends the loop, so it can't go on for ever) */
export async function removeAllUploaded(db: SupabaseClient, userId: string) {
  for (let round = 0; round < 500; round++) {
    const { data } = await db.storage.from(AVATAR_BUCKET).list(userId, { limit: 100 }).catch(() => ({ data: null }));
    const files = (data ?? []).filter((f) => f.name && f.id !== null);
    if (!files.length) return;
    const { data: gone, error } = await db.storage.from(AVATAR_BUCKET).remove(files.map((f) => `${userId}/${f.name}`));
    if (error || !gone?.length) return;
  }
}
