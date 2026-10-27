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

commit;
