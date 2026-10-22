-- Reviews replace notes and lines. A review is the log itself: its text (notes), rating and date, kept by the logs'
-- own privacy rules ("Only me", private accounts, blocks). New on logs: a tagline (one line, at most 140 characters)
-- and a spoiler switch. People can like a review and comment under it; both are seen only where the review is.
-- Comments can be reported. title_reviews() lists a title's reviews with their likes and comments, as the visitor.
-- highlights and profile_details.pinned_line stay untouched for now; scripts/lines-to-taglines.mjs copies lines over.
-- (supabase/schema.sql already includes this for new databases.)
begin;

alter table public.logs
  add column if not exists tagline text not null default '' check (char_length(tagline) <= 140),
  add column if not exists spoiler boolean not null default false;

create table if not exists public.review_likes (
  log_id uuid not null references public.logs (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (log_id, user_id)
);
create index if not exists review_likes_user on public.review_likes (user_id, created_at desc);

-- comments can't be edited, only deleted (by their author or the review's owner)
create table if not exists public.review_comments (
  id uuid primary key default gen_random_uuid(),
  log_id uuid not null references public.logs (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  body text not null check (char_length(body) between 1 and 1000),
  created_at timestamptz not null default now()
);
create index if not exists review_comments_log on public.review_comments (log_id, created_at);
create index if not exists review_comments_user on public.review_comments (user_id, created_at desc);

-- gentle limits, like check_log (the website's own server is exempt)
create or replace function public.check_review_comment()
returns trigger language plpgsql security definer set search_path = '' as $$
declare n int; d int;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    select count(*) filter (where created_at > now() - interval '10 minutes'), count(*) into n, d
      from public.review_comments where user_id = new.user_id and created_at > now() - interval '1 day';
    if n >= 10 or d >= 100 then raise exception 'That''s a lot of comments at once. Try again in a little while.' using errcode = 'P0001', hint = 'rate'; end if;
  end if;
  return new;
end $$;
drop trigger if exists review_comments_check on public.review_comments;
create trigger review_comments_check before insert on public.review_comments
  for each row execute function public.check_review_comment();

create or replace function public.check_review_like()
returns trigger language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    select count(*) into n from public.review_likes where user_id = new.user_id and created_at > now() - interval '1 hour';
    if n >= 300 then raise exception 'That''s a lot of likes at once. Try again in a little while.' using errcode = 'P0001', hint = 'rate'; end if;
  end if;
  return new;
end $$;
drop trigger if exists review_likes_check on public.review_likes;
create trigger review_likes_check before insert on public.review_likes
  for each row execute function public.check_review_like();

-- a comment can be reported too
alter table public.reports add column if not exists target_comment uuid references public.review_comments (id) on delete cascade;
alter table public.reports drop constraint if exists reports_check;
alter table public.reports drop constraint if exists reports_target;
alter table public.reports add constraint reports_target check (target_user is not null or target_log is not null or target_comment is not null);

alter table public.review_likes enable row level security;
alter table public.review_comments enable row level security;

-- seen only when their review is (the subquery runs under the visitor's own rules on logs), and never across a block
drop policy if exists "review likes: seen with their review" on public.review_likes;
create policy "review likes: seen with their review" on public.review_likes for select to anon, authenticated
  using (exists (select 1 from public.logs l where l.id = log_id) and not public.blocked_with(user_id));
drop policy if exists "review likes: like a review you can see" on public.review_likes;
create policy "review likes: like a review you can see" on public.review_likes for insert to authenticated
  with check (user_id = auth.uid() and exists (select 1 from public.logs l where l.id = log_id and (l.notes <> '' or l.tagline <> '')));
drop policy if exists "review likes: take back your own" on public.review_likes;
create policy "review likes: take back your own" on public.review_likes for delete to authenticated using (user_id = auth.uid());

drop policy if exists "review comments: seen with their review" on public.review_comments;
create policy "review comments: seen with their review" on public.review_comments for select to anon, authenticated
  using (exists (select 1 from public.logs l where l.id = log_id) and not public.blocked_with(user_id));
drop policy if exists "review comments: comment on a review you can see" on public.review_comments;
create policy "review comments: comment on a review you can see" on public.review_comments for insert to authenticated
  with check (user_id = auth.uid() and exists (select 1 from public.logs l where l.id = log_id and (l.notes <> '' or l.tagline <> '')));
drop policy if exists "review comments: delete yours or on your review" on public.review_comments;
create policy "review comments: delete yours or on your review" on public.review_comments for delete to authenticated
  using (user_id = auth.uid() or exists (select 1 from public.logs l where l.id = log_id and l.user_id = auth.uid()));

-- a title's reviews (TV: all of a show's season ids), with likes, comments and whether you liked each.
-- security invoker: every rule above applies to whoever asks.
create or replace function public.title_reviews(title_ids uuid[], sort text default 'popular', lim int default 10, off int default 0)
returns table (id uuid, user_id uuid, title_id uuid, status text, rating numeric, loved boolean, notes text, tagline text,
  spoiler boolean, logged_on date, again boolean, created_at timestamptz, username text, display_name text, avatar_url text,
  likes int, comments int, liked boolean)
language sql stable security invoker set search_path = '' as $$
  select l.id, l.user_id, l.title_id, l.status, l.rating, l.loved, l.notes, l.tagline, l.spoiler, l.logged_on, l.again, l.created_at,
    p.username, p.display_name, p.avatar_url,
    (select count(*)::int from public.review_likes k where k.log_id = l.id),
    (select count(*)::int from public.review_comments c where c.log_id = l.id),
    exists (select 1 from public.review_likes k where k.log_id = l.id and k.user_id = auth.uid())
  from public.logs l join public.profiles p on p.id = l.user_id
  where l.title_id = any (title_ids) and (l.notes <> '' or l.tagline <> '')
  order by case when title_reviews.sort = 'popular' then (select count(*) from public.review_likes k where k.log_id = l.id) end desc nulls last,
    l.logged_on desc, l.created_at desc
  limit least(greatest(title_reviews.lim, 1), 50) offset greatest(title_reviews.off, 0);
$$;

grant select on public.review_likes, public.review_comments to anon, authenticated;
grant insert (log_id, user_id), delete on public.review_likes to authenticated;
grant insert (log_id, user_id, body), delete on public.review_comments to authenticated;
grant insert (target_comment) on public.reports to authenticated;
grant all on public.review_likes, public.review_comments to service_role;
revoke all on function public.title_reviews(uuid[], text, int, int) from public;
grant execute on function public.title_reviews(uuid[], text, int, int) to anon, authenticated, service_role;

commit;
