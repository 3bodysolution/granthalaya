// Short share address: /c/<collection id> → a permanent redirect to the collection's page. Asked as the visitor, so a private
// account's collection is a 404, the same as on the page itself.
import type { APIRoute } from 'astro';
export const prerender = false;

export const GET: APIRoute = async ({ params, locals, redirect }) => {
  const id = String(params.id ?? '');
  const notFound = new Response('Not found', { status: 404, headers: { 'Cache-Control': 'no-store' } });
  if (!locals.supabase || !/^[0-9a-f-]{36}$/i.test(id)) return notFound;
  const { data } = await locals.supabase.from('threads').select('slug, profiles(username)').eq('id', id).maybeSingle();
  const owner = (data as { slug?: string; profiles?: { username?: string } } | null);
  return owner?.slug && owner.profiles?.username ? redirect(`/@${owner.profiles.username}/collections/${owner.slug}/`, 301) : notFound;
};
