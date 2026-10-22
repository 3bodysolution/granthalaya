-- TV by show: a show row sits above its season rows. It has kind 'tv', no season, the same tmdb_id and a plain slug
-- ("dark"); the unique index on (kind, tmdb_id, coalesce(season, -1)) already allows it. Season rows point at it with
-- show_id; the show row says how many seasons TMDB lists. Every season log stays where it is: nothing moves.
-- A log on the show row itself means "want to watch the whole show", so it accepts only 'want'.
-- The rows are made by scripts/tv-shows.mjs after this runs.
-- (supabase/schema.sql already includes this for new databases.)
begin;
alter table public.titles
  add column if not exists show_id uuid references public.titles (id) on delete set null,
  add column if not exists seasons int check (seasons is null or seasons between 0 and 300);
create index if not exists titles_show on public.titles (show_id) where show_id is not null;

create or replace function public.check_log()
returns trigger language plpgsql security definer set search_path = '' as $$
declare k text; s int; n int;
begin
  select kind, season into k, s from public.titles where id = new.title_id;
  if k is null then raise exception 'Unknown title.' using errcode = 'P0001'; end if;
  if not (
       (k = 'book'  and new.status in ('want', 'reading', 'done', 'paused', 'dnf'))
    or (k = 'film'  and new.status in ('want', 'done', 'dnf'))
    or (k = 'tv'    and s is null and new.status = 'want')   -- a whole show: only "want to watch"
    or (k = 'tv'    and s is not null and new.status in ('want', 'watching', 'done', 'paused', 'dropped'))
    or (k = 'essay' and new.status in ('want', 'done'))
  ) then
    raise exception 'That status doesn''t fit a %.', case when k = 'tv' and s is null then 'whole show' else k end using errcode = 'P0001';
  end if;
  -- a gentle limit on how fast one account can add things (the website's own server is exempt)
  if tg_op = 'INSERT' and coalesce(auth.role(), '') <> 'service_role' then
    select count(*) into n from public.logs where user_id = new.user_id and created_at > now() - interval '1 hour';
    if n >= 120 then raise exception 'That''s a lot at once. Try again in a little while.' using errcode = 'P0001', hint = 'rate'; end if;
  end if;
  return new;
end $$;
commit;
