import type { APIRoute } from 'astro';
import { endSession, json } from '../../lib/server';
export const prerender = false;
export const POST: APIRoute = async ({ cookies }) => { endSession(cookies); return json({ ok: true }); };
