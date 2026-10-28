-- Low issues from the test report of 2026-10-23.
-- L35  the comment limit (10 in 10 minutes, 100 a day) counted only comments that still exist, so deleting them freed the slots.
--      Every comment sent is now recorded in comment_events (the person, when: nothing else, nobody can read it) and the limit counts those.
-- (supabase/schema.sql already includes all of this for new databases.)
begin;

create table if not exists public.comment_events (
  user_id uuid not null references public.profiles (id) on delete cascade,
  at timestamptz not null default now()
);
create index if not exists comment_events_user on public.comment_events (user_id, at desc);
alter table public.comment_events enable row level security;   -- no policies and no grants: only the trigger below touches it

create or replace function public.check_review_comment()
returns trigger language plpgsql security definer set search_path = '' as $$
declare n int; d int;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    select count(*) filter (where at > now() - interval '10 minutes'), count(*) into n, d
      from public.comment_events where user_id = new.user_id and at > now() - interval '1 day';
    if n >= 10 or d >= 100 then raise exception 'That''s a lot of comments at once. Try again in a little while.' using errcode = 'P0001', hint = 'rate'; end if;
    delete from public.comment_events where user_id = new.user_id and at < now() - interval '2 days';   -- the table stays small
    insert into public.comment_events (user_id) values (new.user_id);
  end if;
  return new;
end $$;

commit;
