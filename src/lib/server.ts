// Server-only helpers for the Add screen. Nothing here is sent to the browser.
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { AstroCookies } from 'astro';
import { site } from '../data/site';

const env = (k: string) => (process.env[k] ?? (import.meta.env as any)[k] ?? '') as string;

export const config = () => ({
  password: env('ADMIN_PASSWORD'),
  token: env('GITHUB_TOKEN'),
  repo: env('GITHUB_REPO'), // "your-username/granthalaya"
  branch: env('GITHUB_BRANCH') || 'main',
  secret: env('SESSION_SECRET') || env('ADMIN_PASSWORD'),
  tmdb: env('TMDB_API_KEY'),
  gemini: env('GEMINI_API_KEY'),
  geminiModel: env('GEMINI_MODEL'),
  groq: env('GROQ_API_KEY'),
  groqModel: env('GROQ_MODEL'),
});

export const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

/* ——— signing in ——— */
const COOKIE = 'g_session';
const sign = (v: string) => createHmac('sha256', config().secret).update(v).digest('base64url');
const same = (a: string, b: string) => {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};
export function checkPassword(p: string) {
  const want = config().password;
  return !!want && same(sign('pw:' + p), sign('pw:' + want));
}
// The session remembers WHO signed in ("sarthak"), not just "the owner".
// Today there's one person and one password; when friends join, sign-in finds their id
// and everything else (saving, editing) already works per person.
export function startSession(cookies: AstroCookies, user = site.owner.id) {
  const exp = String(Date.now() + 1000 * 60 * 60 * 24 * 90); // 90 days
  const opts = { path: '/', sameSite: 'lax' as const, secure: true, maxAge: 60 * 60 * 24 * 90 };
  const body = `${user}.${exp}`;
  cookies.set(COOKIE, `${body}.${sign(body)}`, { ...opts, httpOnly: true });
  cookies.set('g_owner', '1', opts); // only a hint for showing the Add button
}
export function endSession(cookies: AstroCookies) {
  cookies.delete(COOKIE, { path: '/' });
  cookies.delete('g_owner', { path: '/' });
}
/** who is signed in, or null */
export function currentUser(cookies: AstroCookies): string | null {
  const v = cookies.get(COOKIE)?.value;
  if (!v || !config().secret) return null;
  const parts = v.split('.');
  if (parts.length === 2) { // sessions from before people had ids: they belong to the owner
    const [exp, sig] = parts;
    return same(sig, sign(exp)) && +exp > Date.now() ? site.owner.id : null;
  }
  const [user, exp, sig] = parts;
  return user && exp && sig && same(sig, sign(`${user}.${exp}`)) && +exp > Date.now() ? user : null;
}
/** can this person change this shelf? (today: only the owner, on the owner's shelf) */
export const canEdit = (cookies: AstroCookies, shelf = site.owner.id) => currentUser(cookies) === shelf;
export const isOwner = (cookies: AstroCookies) => canEdit(cookies);

/* ——— GitHub ——— */
async function gh(path: string, init: RequestInit = {}) {
  const { token, repo } = config();
  const res = await fetch(`${env('GITHUB_API') || 'https://api.github.com'}/repos/${repo}/${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'granthalaya',
      ...(init.headers ?? {}),
    },
  });
  return res;
}
export async function readFile(path: string): Promise<{ text: string; sha: string } | null> {
  const res = await gh(`contents/${encodeURI(path)}?ref=${config().branch}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub said ${res.status} reading ${path}`);
  const j = await res.json();
  return { text: Buffer.from(j.content, 'base64').toString('utf8'), sha: j.sha };
}
export async function writeFile(path: string, text: string, message: string, sha?: string) {
  const res = await gh(`contents/${encodeURI(path)}`, {
    method: 'PUT',
    body: JSON.stringify({ message, content: Buffer.from(text, 'utf8').toString('base64'), branch: config().branch, ...(sha ? { sha } : {}) }),
  });
  if (!res.ok) throw new Error(`GitHub said ${res.status} saving ${path}: ${(await res.text()).slice(0, 200)}`);
}
export async function listDir(path: string): Promise<string[]> {
  const res = await gh(`contents/${encodeURI(path)}?ref=${config().branch}`);
  if (!res.ok) return [];
  const j = await res.json();
  return Array.isArray(j) ? j.map((f: any) => f.name) : [];
}

/* ——— Markdown helpers ——— */
export const slugify = (s: string) =>
  s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 70) || 'untitled';

// Set (or add) simple `key: value` lines in a file's front matter.
export function setFrontmatter(text: string, values: Record<string, unknown>) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return text;
  let fm = m[1];
  for (const [k, v] of Object.entries(values)) {
    const re = new RegExp(`^${k}:.*$`, 'm');
    if (v === undefined || v === null) { fm = fm.replace(new RegExp(`^${k}:.*\\r?\\n?`, 'm'), ''); continue; }
    const line = `${k}: ${JSON.stringify(v)}`;
    fm = re.test(fm) ? fm.replace(re, line) : fm + '\n' + line;
  }
  return text.replace(m[0], `---\n${fm}\n---`);
}
