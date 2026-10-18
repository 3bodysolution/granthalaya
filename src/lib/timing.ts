// Where a page's time goes. Each request keeps a short list of what it waited for (catalogue calls, database
// calls), and the middleware sends it back as a Server-Timing header on dev and preview copies, so it shows up
// in the browser's Network tab under Timing. Not sent on the live site. Server only.
import { AsyncLocalStorage } from 'node:async_hooks';

interface Entry { name: string; ms: number; desc: string }
interface Run { start: number; entries: Entry[] }

const store = new AsyncLocalStorage<Run>();

/** only dev and preview copies show their timings */
export const timingOn = () => (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.VERCEL_ENV !== 'production';

/** run a request with its own list of timings */
export const withTiming = <T>(fn: () => Promise<T>): Promise<T> => store.run({ start: performance.now(), entries: [] }, fn);

/** note one thing the request waited for */
export function mark(name: string, ms: number, desc = '') {
  store.getStore()?.entries.push({ name, ms, desc });
}

/** time a promise and note it */
export async function timed<T>(name: string, desc: string, p: Promise<T>): Promise<T> {
  const t = performance.now();
  try { return await p; } finally { mark(name, performance.now() - t, desc); }
}

/** the Server-Timing header value: one item per call, then the total */
export function header(): string {
  const run = store.getStore();
  if (!run) return '';
  const clean = (s: string) => s.replace(/[^\w .:/@-]/g, '').slice(0, 60);
  const items = run.entries.map((e, i) => `${e.name}${i};dur=${e.ms.toFixed(1)}${e.desc ? `;desc="${clean(e.desc)}"` : ''}`);
  items.push(`total;dur=${(performance.now() - run.start).toFixed(1)}`);
  return items.join(', ');
}

/** a fetch that notes each database call (for the Supabase clients) */
export const timedFetch: typeof fetch = async (input, init) => {
  const t = performance.now();
  try {
    return await fetch(input, init);
  } finally {
    const u = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url);
    const m = u.pathname.match(/\/rest\/v1\/([^/]+)/);
    mark('db', performance.now() - t, m ? m[1] : u.pathname.includes('/auth/') ? 'auth' : 'other');
  }
};
