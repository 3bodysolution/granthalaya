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

commit;
