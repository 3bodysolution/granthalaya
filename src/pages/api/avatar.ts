// Upload a profile photo: POST a picture (already cropped square in the browser), get back the new photo's address.
// The browser's crop is only a convenience. Here the file is checked again from its contents (JPEG, PNG, WebP or HEIC; never SVG,
// GIF or anything animated), drawn again as a 512x512 WebP (which drops every hidden detail: GPS, camera, dates), and stored at
// avatars/<user id>/<random name>.webp. The old file is deleted. At most 10 uploads an hour.
import type { APIRoute } from 'astro';
import { randomBytes } from 'node:crypto';
import { json, oops, needMe, sameOrigin } from '../../lib/http';
import { adminClient, dbMessage } from '../../lib/supabase';
import { AVATAR_BUCKET, AVATAR_MAX_BYTES, AVATARS_PER_HOUR, avatarAddress, avatarsReady, removeUploaded, sniffImage } from '../../lib/avatar';
export const prerender = false;

export const POST: APIRoute = async (ctx) => {
  if (!sameOrigin(ctx)) return oops('Please try again from the site.', 403);
  const { me, res } = needMe(ctx);
  if (res) return res;
  const db = adminClient();
  if (!(await avatarsReady(db))) return oops('Photo upload isn’t working right now. Please try again later.', 503);

  // size first, from the header, so a huge file is never read
  const announced = Number(ctx.request.headers.get('content-length') ?? 0);
  if (announced > AVATAR_MAX_BYTES + 64 * 1024) return oops('That photo is too big. Please choose one under 5 MB.', 413);
  let file: File | null = null;
  try { const f = (await ctx.request.formData()).get('photo'); file = f instanceof File ? f : null; } catch { /* not a form */ }
  if (!file || !file.size) return oops('Please choose a photo.');
  if (file.size > AVATAR_MAX_BYTES) return oops('That photo is too big. Please choose one under 5 MB.', 413);

  const input = Buffer.from(await file.arrayBuffer());
  const type = sniffImage(input);
  if (type === 'animated') return oops('Please choose a still photo, not an animation.');
  if (!type) return oops('That doesn’t look like a photo. Please choose a JPEG, PNG or WebP picture.');

  // at most 10 uploads an hour per person (counted in avatar_uploads, so it holds across all running copies of the site)
  const since = new Date(Date.now() - 3600_000).toISOString();
  const { count } = await db.from('avatar_uploads').select('at', { count: 'exact', head: true }).eq('user_id', me.id).gte('at', since);
  if ((count ?? 0) >= AVATARS_PER_HOUR) return oops('That’s a lot of photos in an hour. Please try again a little later.', 429);

  let webp: Buffer;
  try {
    const { default: sharp } = await import('sharp');
    // limitInputPixels guards against a small file that unpacks to a giant picture; no .withMetadata(), so nothing is carried over
    webp = await sharp(input, { limitInputPixels: 60_000_000, animated: false, failOn: 'error' })
      .rotate()                                              // upright, as the camera said, before the camera's note is dropped
      .resize(512, 512, { fit: 'cover', position: 'centre' })
      .webp({ quality: 84 })
      .toBuffer();
  } catch {
    return oops(type === 'heic' ? 'We can’t read that kind of photo here. Please choose a JPEG or PNG.' : 'We couldn’t read that photo. Please try another one.');
  }

  const name = randomBytes(12).toString('base64url');
  const path = `${me.id}/${name}.webp`;
  const up = await db.storage.from(AVATAR_BUCKET).upload(path, webp, { contentType: 'image/webp', cacheControl: '31536000', upsert: false });
  if (up.error) return oops('The upload didn’t work. Please try again.', 502);

  const url = avatarAddress(path);
  const { error } = await db.from('profiles').update({ avatar_url: url }).eq('id', me.id);
  if (error) {
    await db.storage.from(AVATAR_BUCKET).remove([path]).catch(() => null);
    return oops(dbMessage(error, 'The upload didn’t work. Please try again.'), 500);
  }
  await db.from('avatar_uploads').insert({ user_id: me.id });
  await removeUploaded(db, me.avatar_url, me.id);            // the old file, if it was one we stored
  return json({ ok: true, url });
};
