// The main colour of a cover, worked out once and kept on the title (titles.cover_color, change 017).
// Used by the shelf on the Stats page. Only our own cover sources are fetched (the same list the cards use). A few at a time, within a time limit;
// whatever is not ready falls back to the painted colour and is tried again on the next visit.
import { coverAddress, setOrigin } from '../cards/covers';
import { adminClient } from '../supabase';

const hex = (n: number) => Math.round(n).toString(16).padStart(2, '0');

/** red, green, blue (0 to 255) of the most "colourful" common colour in the picture, softened to suit cloth */
export function pickColor(px: Uint8Array | Buffer): string | null {
  const bins = new Map<number, { w: number; r: number; g: number; b: number }>();
  for (let i = 0; i + 2 < px.length; i += 3) {
    const r = px[i], g = px[i + 1], b = px[i + 2];
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 510;
    if (l < 0.07 || l > 0.93) continue;                 // near black and near white are the frame, not the cover
    const sat = mx === mn ? 0 : (mx - mn) / (255 - Math.abs(mx + mn - 255));
    const w = 1 + 3 * Math.min(1, sat);
    const k = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const e = bins.get(k) ?? { w: 0, r: 0, g: 0, b: 0 };
    e.w += w; e.r += r * w; e.g += g * w; e.b += b * w;
    bins.set(k, e);
  }
  let top: { w: number; r: number; g: number; b: number } | undefined;
  for (const e of bins.values()) if (!top || e.w > top.w) top = e;
  if (!top) return null;
  let r = top.r / top.w, g = top.g / top.w, b = top.b / top.w;
  // keep the lightness in a range where cloth looks like cloth and ink can be read on it
  const mx = Math.max(r, g, b) / 255, mn = Math.min(r, g, b) / 255, l = (mx + mn) / 2;
  const target = Math.min(0.68, Math.max(0.2, l));
  if (target !== l) {
    const f = target > l ? (target - l) / (1 - l) : -(l - target) / l;
    const mix = (c: number) => (f >= 0 ? c + (255 - c) * f : c * (1 + f));
    r = mix(r); g = mix(g); b = mix(b);
  }
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

async function colorOf(src: string, origin: string): Promise<string | null> {
  setOrigin(origin);
  const u = coverAddress(src, false);
  if (!u) return null;
  try {
    const res = await fetch(u, { signal: AbortSignal.timeout(2500), headers: { accept: 'image/*' } });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > 4_000_000) return null;
    const { default: sharp } = await import('sharp');
    const raw = await sharp(buf, { limitInputPixels: 40_000_000, failOn: 'none' }).resize(32, 32, { fit: 'cover' }).removeAlpha().raw().toBuffer();
    return pickColor(raw);
  } catch { return null; }
}

/** colours for titles that have a cover but no saved colour yet (at most `limit` per visit); saved for next time. Returns what it found. */
export async function fillCoverColors(rows: { id: string; cover: string | undefined; known: string | undefined }[], origin: string, limit = 12): Promise<Map<string, string>> {
  const found = new Map<string, string>();
  const todo = rows.filter((r) => r.cover && !r.known && !r.cover.startsWith('painted')).filter((r, i, a) => a.findIndex((x) => x.id === r.id) === i).slice(0, limit);
  if (!todo.length) return found;
  const done = await Promise.all(todo.map(async (r) => [r.id, await colorOf(r.cover!, origin)] as const));   // each one has its own time limit
  const db = adminClient();
  await Promise.all(done.map(async ([id, c]) => {
    if (!c) return;
    found.set(id, c);
    try { await db.from('titles').update({ cover_color: c }).eq('id', id); } catch { /* 017 not applied yet: it will be worked out again next time */ }
  }));
  return found;
}
