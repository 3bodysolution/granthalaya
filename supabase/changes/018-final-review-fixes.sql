-- Fixes from the final review (2026-11-05).
--  · Photo bucket: members can no longer upload to the avatars bucket themselves. Only the website writes there (with its
--    secret key, after the size check, the re-drawing, the metadata stripping and the 10 an hour limit). The bucket stays
--    public to read by exact address, and nobody can list it.
--  · Admin hide: "Hide the entry" on the admin page sets logs.admin_hidden. Members can't change it, so they can't undo it.
--    Other people don't see a hidden entry; its owner still does, as with "Only me" before.
-- (supabase/schema.sql already includes all of this for new databases.)
begin;

-- photo bucket ───────────────────────────────────────────────────────────────
drop policy if exists "avatars: write your own folder" on storage.objects;
drop policy if exists "avatars: replace your own files" on storage.objects;

-- admin hide ─────────────────────────────────────────────────────────────────
alter table public.logs add column if not exists admin_hidden boolean not null default false;

create or replace function public.touch_log()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.logged_on := coalesce(new.finished_on, new.started_on, new.logged_on, (now() at time zone 'utc')::date);
  new.updated_at := now();
  -- people can't backdate created_at (check_log counts rows made in the last hour), and can't set or clear admin_hidden;
  -- the website and direct database work can
  if auth.role() in ('anon', 'authenticated') then
    if tg_op = 'INSERT' then
      new.created_at := now();
      new.admin_hidden := false;
    else
      new.created_at := old.created_at;
      new.admin_hidden := old.admin_hidden;
    end if;
  end if;
  return new;
end $$;

drop policy if exists "logs: yours, or a visible shelf" on public.logs;
create policy "logs: yours, or a visible shelf" on public.logs for select to anon, authenticated
  using (user_id = auth.uid() or (not only_me and not admin_hidden and public.can_see_shelf(user_id)));

commit;
