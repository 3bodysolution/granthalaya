-- Security fixes from the test report of 2026-10-23.
-- C1  a collection item can no longer be moved into someone else's collection
-- C4  profile photos: only Google's photo host; people can't write the column themselves
-- M3  the hourly limit on new entries can't be skipped by setting an old created_at
-- L27 route-like usernames are reserved
-- L31 a private account can't be featured (the database refuses it)
-- L36 profiles.is_admin, featured and username_changed_at are no longer readable by visitors
-- (supabase/schema.sql already includes all of this for new databases.)
begin;

-- C1 ─────────────────────────────────────────────────────────────────────────
drop policy if exists "thread items: edit your own" on public.thread_items;
create policy "thread items: edit your own" on public.thread_items for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and exists (select 1 from public.threads t where t.id = thread_id and t.user_id = auth.uid()));
revoke update on public.thread_items from authenticated;
grant update (position, why) on public.thread_items to authenticated;

-- C4 ─────────────────────────────────────────────────────────────────────────
-- Photos that aren't from Google's photo host are cleared first (the person can pick "Use my Google photo" again in Settings).
update public.profiles set avatar_url = null
  where avatar_url is not null
    and not (avatar_url ~ '^https://lh3\.googleusercontent\.com/[A-Za-z0-9_./=+%-]+$' and char_length(avatar_url) <= 600);
alter table public.profiles drop constraint avatar_url_ok;
alter table public.profiles add constraint avatar_url_ok
  check (avatar_url is null or (avatar_url ~ '^https://lh3\.googleusercontent\.com/[A-Za-z0-9_./=+%-]+$' and char_length(avatar_url) <= 600));
revoke insert (avatar_url), update (avatar_url) on public.profiles from authenticated;

-- M3 ─────────────────────────────────────────────────────────────────────────
create or replace function public.touch_log()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.logged_on := coalesce(new.finished_on, new.started_on, new.logged_on, (now() at time zone 'utc')::date);
  new.updated_at := now();
  -- people can't backdate created_at (check_log counts rows made in the last hour); the website and direct database work can
  if auth.role() in ('anon', 'authenticated') then
    if tg_op = 'INSERT' then new.created_at := now(); else new.created_at := old.created_at; end if;
  end if;
  return new;
end $$;

-- L31 ────────────────────────────────────────────────────────────────────────
update public.profiles set featured = false where is_private and featured;
alter table public.profiles add constraint featured_needs_public check (not (is_private and featured));

-- L27 ────────────────────────────────────────────────────────────────────────
-- Names that look like addresses on the site can't be taken (people who already have one keep it).
create or replace function public.username_reserved(u text)
returns boolean language sql immutable set search_path = '' as $$
  select u = any (array[
    'about','account','accounts','add','admin','administrator','api','app','auth','blog','callback','contact',
    'delete','diary','edit','everyone','explore','feed','films','granthalaya','help','home','index','info',
    'library','login','logout','mail','me','mod','moderator','new','news','notes','null','official','owner',
    'privacy','profile','report','reports','root','rss','search','security','settings','signin','signout',
    'signup','staff','stats','support','system','team','terms','threads','undefined','user','users','welcome',
    'www','you','fuck','fucker','shit','bitch','cunt','nigger','nigga','faggot','whore','slut','rape','porn',
    'chutiya','madarchod','bhenchod','behenchod','randi','gandu','bhosdike','lund',
    'film','book','books','tv','story','reviews','lines','writer','person','author','essays','lists','collections',
    'og','cards','cover','covers','img','art','static','assets','public','favicon','robots','sitemap'
  ]) or u like 'admin%' or u like 'granthalaya%' or u like '%official%';
$$;

-- L36 ────────────────────────────────────────────────────────────────────────
-- is_admin, featured and username_changed_at can't be read by visitors any more. The site reads your own full row with
-- my_profile() and the featured shelves with featured_profiles(); the admin page uses the secret key.
revoke select on public.profiles from anon, authenticated;
grant select (id, username, display_name, avatar_url, is_private, created_at) on public.profiles to anon, authenticated;

create or replace function public.my_profile()
returns setof public.profiles language sql stable security definer set search_path = '' as $$
  select * from public.profiles where id = auth.uid();
$$;
create or replace function public.featured_profiles(founder text, lim int)
returns table (id uuid, username text, display_name text, avatar_url text, is_private boolean, created_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select p.id, p.username, p.display_name, p.avatar_url, p.is_private, p.created_at
    from public.profiles p
   where not p.is_private and not public.blocked_with(p.id) and (p.featured or p.username = founder)
   order by (p.username = founder) desc, p.created_at
   limit greatest(lim, 0);
$$;
revoke all on function public.my_profile(), public.featured_profiles(text, int) from public;
grant execute on function public.my_profile() to authenticated, service_role;
grant execute on function public.featured_profiles(text, int) to anon, authenticated, service_role;

commit;
