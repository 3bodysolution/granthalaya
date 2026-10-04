import type { APIRoute } from 'astro';
import { isOwner, currentUser, config, json, endSession } from '../../lib/server';
export const prerender = false;
export const GET: APIRoute = async ({ cookies }) => {
  const c = config();
  const owner = isOwner(cookies);
  if (!owner && cookies.get('g_owner')) endSession(cookies);
  return json({ owner, user: currentUser(cookies), facts: !!(c.gemini || c.groq), ready: !!(c.password && c.token && c.repo), missing: [!c.password && 'ADMIN_PASSWORD', !c.token && 'GITHUB_TOKEN', !c.repo && 'GITHUB_REPO'].filter(Boolean) });
};
