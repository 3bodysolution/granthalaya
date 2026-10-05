/// <reference path="../.astro/types.d.ts" />

declare namespace App {
  interface Locals {
    /** the database, as the person visiting */
    supabase: import('@supabase/supabase-js').SupabaseClient;
    /** who is signed in (from Google), or null */
    user: { id: string; email?: string; name?: string; avatar?: string } | null;
    /** their profile, once they've picked a username */
    me: import('./lib/data').Profile | null;
  }
}
