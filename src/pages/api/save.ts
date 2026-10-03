import type { APIRoute } from 'astro';
import { isOwner, config, json, readFile, writeFile, listDir, slugify, setFrontmatter } from '../../lib/server';
export const prerender = false;

const LIB = 'src/content/library';
const THREADS = 'src/content/threads';
const num = (v: unknown) => (v === '' || v == null || isNaN(+v!) ? undefined : +v!);
const str = (v: unknown, max = 300) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined);

// Add a slug to a thread's `items:` list, keeping the rest of the file as it is.
function addToThread(text: string, slug: string, why: string) {
  if (new RegExp(`slug:\\s*${slug}\\s*$`, 'm').test(text)) return text;
  const lines = text.split('\n');
  const start = lines.findIndex((l) => /^items:\s*(\[\s*\])?\s*$/.test(l));
  if (start < 0) return text;
  lines[start] = 'items:';
  let i = start + 1;
  while (i < lines.length && /^(\s+|$)/.test(lines[i]) && lines[i] !== '---') i++;
  while (i > start + 1 && lines[i - 1].trim() === '') i--;
  lines.splice(i, 0, `  - slug: ${slug}`, `    why: ${JSON.stringify(why)}`);
  return lines.join('\n');
}

export const POST: APIRoute = async ({ request, cookies }) => {
  if (!isOwner(cookies)) return json({ error: 'Please sign in again.' }, 401);
  const c = config();
  if (!c.token || !c.repo) return json({ error: 'Saving isn’t set up yet: add GITHUB_TOKEN and GITHUB_REPO in Vercel.' }, 500);
  const b = await request.json().catch(() => null);
  if (!b) return json({ error: 'Nothing to save.' }, 400);

  try {
    /* ——— finishing or updating something already on the shelf ——— */
    if (b.action === 'update') {
      const slug = slugify(String(b.slug ?? ''));
      const path = `${LIB}/${slug}.md`;
      const f = await readFile(path);
      if (!f) return json({ error: 'Couldn’t find that entry.' }, 404);
      const values: Record<string, unknown> = {};
      if (b.status === 'done') Object.assign(values, { status: 'done', progress: null, date: str(b.date) ?? new Date().toISOString().slice(0, 10) });
      if (num(b.progress) !== undefined && b.status !== 'done') values.progress = Math.max(0, Math.min(100, Math.round(num(b.progress)!)));
      if (num(b.rating)) values.rating = num(b.rating);
      let text = setFrontmatter(f.text, values);
      const note = str(b.note, 4000);
      if (note) text = text.replace(/\s*$/, '') + '\n\n' + note + '\n';
      await writeFile(path, text, `${b.status === 'done' ? 'Finished' : 'Updated'} ${slug}`, f.sha);
      return json({ ok: true, slug, href: `/library/${slug}/` });
    }

    /* ——— something new ——— */
    const type = ['book', 'film', 'essay'].includes(b.type) ? b.type : null;
    const title = str(b.title, 200), creator = str(b.creator, 200);
    if (!type || !title || !creator) return json({ error: 'A title and an author or director are needed.' }, 400);
    const date = /^\d{4}-\d{2}-\d{2}$/.test(b.date) ? b.date : new Date().toISOString().slice(0, 10);
    const status = type === 'book' && b.status === 'reading' ? 'reading' : type === 'film' && b.status === 'watching' ? 'watching' : 'done';

    const fm: Record<string, unknown> = {
      title, type, creator, year: num(b.year), date, status: status === 'done' ? undefined : status,
      progress: status === 'reading' ? num(b.progress) ?? 0 : undefined,
      rating: type === 'essay' ? undefined : status === 'done' ? num(b.rating) : undefined,
      loved: type === 'essay' && b.loved ? true : undefined,
      runtime: type === 'film' ? num(b.runtime) : undefined,
      pages: type === 'book' ? num(b.pages) : undefined,
      words: type === 'essay' ? num(b.words) : undefined,
      link: str(b.link, 500) && /^https?:\/\//.test(b.link) ? str(b.link, 500) : undefined,
      source: type === 'essay' ? str(b.source, 80) : undefined,
      where: type === 'film' ? str(b.where, 60) : undefined,
      times: num(b.times) && num(b.times)! > 1 ? num(b.times) : undefined,
      private: b.private ? true : undefined,
    };
    const lines = Object.entries(fm).filter(([, v]) => v !== undefined).map(([k, v]) => `${k}: ${JSON.stringify(v)}`);
    const quote = str(b.quote, 1000);
    if (quote) lines.push('highlights:', `  - text: ${JSON.stringify(quote)}`, ...(b.quoteMine ? ['    mine: true'] : []));
    const note = str(b.note, 8000) ?? '';
    const md = `---\n${lines.join('\n')}\n---\n\n${note}\n`;

    const existing = new Set(await listDir(LIB));
    let slug = slugify(title);
    if (existing.has(`${slug}.md`)) slug = `${slug}-${date.slice(0, 4)}`;
    for (let n = 2; existing.has(`${slug}.md`); n++) slug = `${slugify(title)}-${n}`;
    await writeFile(`${LIB}/${slug}.md`, md, `Add ${type}: ${title}`);

    // threads
    const added: string[] = [];
    const why = str(b.threadWhy, 200) ?? (note.split('\n')[0].slice(0, 120) || '');
    for (const t of (Array.isArray(b.threads) ? b.threads : []).slice(0, 6)) {
      const tslug = slugify(String(t));
      const f = await readFile(`${THREADS}/${tslug}.md`);
      if (!f) continue;
      const next = addToThread(f.text, slug, why);
      if (next !== f.text) { await writeFile(`${THREADS}/${tslug}.md`, next, `Add ${slug} to thread ${tslug}`, f.sha); added.push(tslug); }
    }
    const newThread = str(b.newThread, 80);
    if (newThread) {
      const tslug = slugify(newThread);
      if (!(await readFile(`${THREADS}/${tslug}.md`))) {
        await writeFile(`${THREADS}/${tslug}.md`, `---\ntitle: ${JSON.stringify(newThread)}\norder: 50\nitems:\n  - slug: ${slug}\n    why: ${JSON.stringify(why)}\n---\n\n\n`, `New thread: ${newThread}`);
        added.push(tslug);
      }
    }
    return json({ ok: true, slug, href: `/library/${slug}/`, threads: added, private: !!fm.private });
  } catch (e: any) {
    return json({ error: String(e?.message ?? e).includes('401') || String(e).includes('403') ? 'GitHub refused the save. Check the GITHUB_TOKEN in Vercel can write to this repository.' : 'Saving failed. Try again in a moment.' }, 502);
  }
};
