-- No double saves (2026-11-09). The website now refuses a second identical comment, or a second save of the same title in the same
-- status, from the same member within 30 seconds. These two triggers do the same inside the database, so even two requests
-- arriving at the same moment can't both get in (they take turns on a lock, and the second sees the first).
--  · comments: same member, same review, same words, within 30 seconds.
--  · entries:  same member, same title, same status, within 30 seconds ("watch it again" entries are exempt).
-- Safe to run twice. (supabase/schema.sql already includes it for new databases.)
begin;

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
  -- the same title in the same status from the same member within 30 seconds is a double save: refuse it ("watch it again" is exempt).
  -- The lock makes two saves that arrive at the same moment take turns, so the second one sees the first.
  if tg_op = 'INSERT' and new.again is not true then
    perform pg_advisory_xact_lock(hashtextextended('log' || new.user_id::text || new.title_id::text, 0));
    if exists (select 1 from public.logs where user_id = new.user_id and title_id = new.title_id and status = new.status and again is not true and created_at > now() - interval '30 seconds') then
      raise exception 'That was just saved.' using errcode = 'P0001';
    end if;
  end if;
  -- a gentle limit on how fast one account can add things (the website's own server is exempt)
  if tg_op = 'INSERT' and coalesce(auth.role(), '') <> 'service_role' then
    select count(*) into n from public.logs where user_id = new.user_id and created_at > now() - interval '1 hour';
    if n >= 120 then raise exception 'That''s a lot at once. Try again in a little while.' using errcode = 'P0001', hint = 'rate'; end if;
  end if;
  return new;
end $$;

create or replace function public.check_review_comment()
returns trigger language plpgsql security definer set search_path = '' as $$
declare n int; d int;
begin
  -- the same words from the same member on the same review within 30 seconds is a double send: refuse it (two arriving at the same moment take turns)
  perform pg_advisory_xact_lock(hashtextextended('comment' || new.user_id::text || new.log_id::text, 0));
  if exists (select 1 from public.review_comments where user_id = new.user_id and log_id = new.log_id and body = new.body and created_at > now() - interval '30 seconds') then
    raise exception 'You just posted that.' using errcode = 'P0001';
  end if;
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
