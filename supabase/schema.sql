-- Granthalaya, Phase 1: the database.
--
-- Run this once in Supabase → SQL Editor → New query → paste → Run.
-- It is safe to read: it only creates tables, privacy rules and a few helpers.
--
-- The privacy rules (row level security) live here, in the database, so they hold
-- no matter which page or tool asks for the data:
--   · everyone can see public shelves; a private account shows only name and photo
--   · "Only me" entries are seen by their owner alone
--   · blocked people can't see each other at all
--   · each person can change only their own rows
--   · the shared catalogue of titles is written only by the website's server

begin;

-- ───────────────────────── helpers ─────────────────────────

-- Usernames people can't take.
create or replace function public.username_reserved(u text)
returns boolean language sql immutable set search_path = '' as $$
  select u = any (array[
    'about','account','accounts','add','admin','administrator','api','app','auth','blog','callback','contact',
    'delete','diary','edit','everyone','explore','feed','films','granthalaya','help','home','index','info',
    'library','login','logout','mail','me','mod','moderator','new','news','notes','null','official','owner',
    'privacy','profile','report','reports','root','rss','search','security','settings','signin','signout',
    'signup','staff','stats','support','system','team','terms','threads','undefined','user','users','welcome',
    'www','you','fuck','fucker','shit','bitch','cunt','nigger','nigga','faggot','whore','slut','rape','porn',
    'chutiya','madarchod','bhenchod','behenchod','randi','gandu','bhosdike','lund'
  ]) or u like 'admin%' or u like 'granthalaya%' or u like '%official%';
$$;

-- When was something logged: the finish date, else the start date, else today.
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

create or replace function public.touch_updated()
returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end $$;

-- ───────────────────────── people ─────────────────────────

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null,
  display_name text not null default '',
  avatar_url text,
  is_private boolean not null default false,
  featured boolean not null default false,           -- "Feature my shelf" on the signed-out home page
  is_admin boolean not null default false,           -- can open the reports page; set by hand
  username_changed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint username_format check (username ~ '^[a-z0-9_]{3,20}$'),
  constraint display_name_length check (char_length(display_name) <= 60),
  constraint avatar_url_ok check (avatar_url is null or (avatar_url ~ '^https://lh3\.googleusercontent\.com/[A-Za-z0-9_./=+%-]+$' and char_length(avatar_url) <= 600))   -- Google's photo host only
);
create unique index profiles_username_key on public.profiles (username);
create index profiles_featured on public.profiles (featured) where featured;

-- Old usernames keep pointing at their person, so old links redirect and nobody else can take them.
create table public.username_history (
  old_username text primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  changed_at timestamptz not null default now()
);

create table public.profile_details (
  id uuid primary key references public.profiles (id) on delete cascade,
  bio text not null default '' check (char_length(bio) <= 160),
  links jsonb not null default '{}'::jsonb check (jsonb_typeof(links) = 'object' and pg_column_size(links) < 2000),
  favourites uuid[] not null default '{}' check (cardinality(favourites) <= 4),  -- title ids
  pinned_line uuid,                                  -- one of your own lines, shown on your profile (see below)
  updated_at timestamptz not null default now()
);
create trigger profile_details_touch before update on public.profile_details
  for each row execute function public.touch_updated();

-- Username rules: not reserved, not someone's old name, and changed at most once every 30 days.
create or replace function public.check_username()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and new.username = old.username then return new; end if;
  if public.username_reserved(new.username) then
    raise exception 'That username isn''t available.' using errcode = 'P0001', hint = 'reserved';
  end if;
  if exists (select 1 from public.username_history h where h.old_username = new.username and h.user_id <> new.id) then
    raise exception 'That username isn''t available.' using errcode = 'P0001', hint = 'taken';
  end if;
  if tg_op = 'UPDATE' then
    if old.username_changed_at is not null and old.username_changed_at > now() - interval '30 days'
       and coalesce(auth.role(), '') <> 'service_role' then
      raise exception 'You can change your username once every 30 days.' using errcode = 'P0001', hint = 'too_soon';
    end if;
    new.username_changed_at := now();
    insert into public.username_history (old_username, user_id) values (old.username, old.id)
      on conflict (old_username) do update set user_id = excluded.user_id, changed_at = now();
    delete from public.username_history where old_username = new.username;
  end if;
  return new;
end $$;
create trigger profiles_username before insert or update of username on public.profiles
  for each row execute function public.check_username();

-- ───────────────────────── the shared catalogue ─────────────────────────

create table public.titles (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('book', 'film', 'tv', 'essay')),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 90),
  title text not null check (char_length(title) between 1 and 300),
  creator text not null default '' check (char_length(creator) <= 200),
  year int check (year between 0 and 2100),
  season int check (season between 0 and 300),       -- TV only
  episodes int check (episodes between 0 and 5000),
  runtime int check (runtime between 0 and 100000),  -- minutes: a film, or a whole TV season
  pages int check (pages between 0 and 100000),
  words int check (words between 0 and 10000000),    -- essays
  cover_url text check (cover_url is null or char_length(cover_url) <= 600),
  link text check (link is null or char_length(link) <= 1000),
  source text check (source is null or char_length(source) <= 120),  -- 'Granthalaya lists' = made from a prize or classics list, never looked up on Open Library
  original_title text check (original_title is null or char_length(original_title) <= 300),  -- in its own script
  language text check (language is null or language ~ '^[a-z]{2,3}$'),  -- ISO 639-1, else 639-3
  note text check (note is null or char_length(note) <= 300),
  tagline text check (tagline is null or char_length(tagline) <= 140),  -- the short line on share cards: TMDB's tagline, else one written once from the summary
  card_bg text check (card_bg is null or card_bg in ('cinema', 'fair', 'fields', 'forest', 'fort', 'noir', 'rain', 'reading', 'sea', 'stars', 'wada')),  -- the painting behind its share card, picked once by the AI
  description text check (description is null or char_length(description) <= 2000),  -- books: Wikipedia's intro, else Open Library's text (AI-shortened when long); never Google Books
  description_source text check (description_source is null or description_source in ('wikipedia', 'openlibrary', 'ai-wikipedia', 'ai-openlibrary')),
  description_url text check (description_url is null or char_length(description_url) <= 600),  -- the Wikipedia article, for the credit
  description_checked_at timestamptz,                -- looked for one; look again after 90 days
  publisher text check (publisher is null or char_length(publisher) <= 200),
  cover_from text check (cover_from is null or cover_from in ('akshardhara', 'bookganga')),  -- the cover is a shop's (see shop_books)
  show_id uuid references public.titles (id) on delete set null,  -- a TV season: its show's row (kind 'tv', no season)
  seasons int check (seasons is null or seasons between 0 and 300),  -- a TV show's row: how many seasons TMDB lists
  tmdb_id int,
  ol_key text,                                       -- Open Library work, like OL45883W
  trivia jsonb not null default '[]'::jsonb check (jsonb_typeof(trivia) = 'array'),
  trivia_source text,
  color text check (color is null or color ~ '^#[0-9a-fA-F]{6}$'),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
create unique index titles_tmdb_key on public.titles (kind, tmdb_id, coalesce(season, -1)) where tmdb_id is not null;
create unique index titles_ol_key on public.titles (ol_key) where ol_key is not null;
create unique index titles_link_key on public.titles (link) where kind = 'essay' and link is not null;
create index titles_created_by on public.titles (created_by, created_at);
create index titles_show on public.titles (show_id) where show_id is not null;

-- Marathi and Hindi books suggested each week by a free AI model, each checked against a real source first.
create table public.book_suggestions (
  id uuid primary key default gen_random_uuid(),
  language text not null check (language in ('mr', 'hi')),
  title_id uuid not null references public.titles (id) on delete cascade,
  checked_with text not null check (checked_with in ('Open Library', 'Google Books', 'Wikipedia')),
  hidden boolean not null default false,
  created_at timestamptz not null default now(),
  unique (language, title_id)
);
create index book_suggestions_shown on public.book_suggestions (language, created_at desc) where not hidden;

-- Books from two Indian bookshops, with their permission (scripts/shops): the "Buy at" links and covers. Covers are never copied:
-- pages show them through /api/cover. hidden / cover_hidden: a shop asked; the row stays so a re-run never brings it back.
create table public.shop_books (
  id uuid primary key default gen_random_uuid(),
  shop text not null check (shop in ('akshardhara', 'bookganga')),
  shop_key text not null check (char_length(shop_key) between 1 and 200),
  url text not null check (url ~ '^https://(akshardhara\.com|www\.bookganga\.com)/' and char_length(url) <= 600),
  title text not null default '' check (char_length(title) <= 300),
  original_title text not null default '' check (char_length(original_title) <= 300),
  author text not null default '' check (char_length(author) <= 300),
  publisher text not null default '' check (char_length(publisher) <= 200),
  language text check (language is null or language in ('mr', 'hi')),
  isbn text check (isbn is null or isbn ~ '^97[89][0-9]{10}$'),
  cover_src text check (cover_src is null or (cover_src ~ '^https://(cdn\.shopify\.com/s/files/1/0800/1214/9058/|www\.bookganga\.com/eBooks/Content/images/books/)' and char_length(cover_src) <= 600)),
  lists text[] not null default '{}',
  title_id uuid references public.titles (id) on delete set null,
  match text not null default 'new' check (match in ('sure', 'checked', 'new', 'openlibrary', 'unsure', 'rejected')),
  hidden boolean not null default false,
  cover_hidden boolean not null default false,
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  unique (shop, shop_key)
);
create index shop_books_title on public.shop_books (title_id) where title_id is not null and not hidden;

-- ───────────────────────── shelves ─────────────────────────

-- One row per visit: a re-read or re-watch is a new row with again = true.
create table public.logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  title_id uuid not null references public.titles (id) on delete restrict,
  status text not null check (status in ('want', 'reading', 'watching', 'paused', 'done', 'dnf', 'dropped')),
  rating numeric(2, 1) check (rating between 0.5 and 5 and rating * 2 = floor(rating * 2)),
  loved boolean not null default false,              -- essays: a heart instead of stars
  started_on date,
  finished_on date,
  logged_on date not null default ((now() at time zone 'utc')::date),
  again boolean not null default false,
  notes text not null default '' check (char_length(notes) <= 10000),   -- the review
  tagline text not null default '' check (char_length(tagline) <= 140), -- the review's one line
  spoiler boolean not null default false,
  where_seen text not null default '' check (char_length(where_seen) <= 80),
  only_me boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index logs_user_day on public.logs (user_id, logged_on desc);
create index logs_title on public.logs (title_id);
create trigger logs_touch before insert or update on public.logs
  for each row execute function public.touch_log();

-- Each kind has its own status tags.
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
create trigger logs_check before insert or update of status, title_id on public.logs
  for each row execute function public.check_log();

create table public.highlights (
  id uuid primary key default gen_random_uuid(),
  log_id uuid not null references public.logs (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  body text not null check (char_length(body) between 1 and 2000),
  where_at text not null default '' check (char_length(where_at) <= 80),
  note text not null default '' check (char_length(note) <= 1000),
  mine boolean not null default false,               -- your own line, not a quote
  position int not null default 0,
  created_at timestamptz not null default now()
);
create index highlights_log on public.highlights (log_id, position);
create index highlights_user on public.highlights (user_id, created_at desc);

-- Likes and comments on a review (a log with notes or a tagline). Comments can't be edited, only deleted.
create table public.review_likes (
  log_id uuid not null references public.logs (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (log_id, user_id)
);
create index review_likes_user on public.review_likes (user_id, created_at desc);
create table public.review_comments (
  id uuid primary key default gen_random_uuid(),
  log_id uuid not null references public.logs (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  body text not null check (char_length(body) between 1 and 1000),
  created_at timestamptz not null default now()
);
create index review_comments_log on public.review_comments (log_id, created_at);
create index review_comments_user on public.review_comments (user_id, created_at desc);

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
create trigger review_likes_check before insert on public.review_likes
  for each row execute function public.check_review_like();

-- The line pinned to a profile. If the line is deleted, the profile simply shows your latest line instead.
alter table public.profile_details add constraint profile_details_pinned_line_fkey
  foreign key (pinned_line) references public.highlights (id) on delete set null;

create table public.threads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  slug text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 70),
  name text not null check (char_length(name) between 1 and 120),
  intro text not null default '' check (char_length(intro) <= 1000),
  position int not null default 99,
  created_at timestamptz not null default now(),
  unique (user_id, slug)
);
create table public.thread_items (
  thread_id uuid not null references public.threads (id) on delete cascade,
  title_id uuid not null references public.titles (id) on delete restrict,
  user_id uuid not null references public.profiles (id) on delete cascade,
  position int not null default 0,
  why text not null default '' check (char_length(why) <= 300),
  primary key (thread_id, title_id)
);
create index thread_items_title on public.thread_items (title_id);

-- ───────────────────────── safety ─────────────────────────

create table public.blocks (
  blocker uuid not null references public.profiles (id) on delete cascade,
  blocked uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker, blocked),
  check (blocker <> blocked)
);
create index blocks_blocked on public.blocks (blocked);

create table public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter uuid references public.profiles (id) on delete set null,
  target_user uuid references public.profiles (id) on delete cascade,
  target_log uuid references public.logs (id) on delete cascade,
  target_comment uuid references public.review_comments (id) on delete cascade,
  reason text not null check (reason in ('spam', 'abuse', 'sexual', 'hate', 'illegal', 'other')),
  details text not null default '' check (char_length(details) <= 1000),
  status text not null default 'open' check (status in ('open', 'dismissed', 'actioned')),
  created_at timestamptz not null default now(),
  constraint reports_target check (target_user is not null or target_log is not null or target_comment is not null)
);
create index reports_open on public.reports (status, created_at desc);

create or replace function public.check_report()
returns trigger language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  select count(*) into n from public.reports where reporter = new.reporter and created_at > now() - interval '1 day';
  if n >= 20 then raise exception 'You''ve sent a lot of reports today. Thank you; try again tomorrow.' using errcode = 'P0001', hint = 'rate'; end if;
  return new;
end $$;
create trigger reports_check before insert on public.reports
  for each row execute function public.check_report();

-- ───────────────────────── who can see what ─────────────────────────

-- These two run with the owner's rights so they can look across tables without loops in the rules.
-- blocked_with only ever answers about the person asking, so it can't be used to snoop on others' blocks.
create or replace function public.blocked_with(other uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and other is not null and exists (
    select 1 from public.blocks
    where (blocker = auth.uid() and blocked = other) or (blocker = other and blocked = auth.uid())
  );
$$;

create or replace function public.can_see_shelf(owner uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select owner = auth.uid()
      or exists (
        select 1 from public.profiles p
        where p.id = owner and not p.is_private and not public.blocked_with(owner)
      );
$$;

alter table public.profiles enable row level security;
alter table public.username_history enable row level security;
alter table public.profile_details enable row level security;
alter table public.titles enable row level security;
alter table public.book_suggestions enable row level security;
alter table public.shop_books enable row level security;
alter table public.logs enable row level security;
alter table public.highlights enable row level security;
alter table public.review_likes enable row level security;
alter table public.review_comments enable row level security;
alter table public.threads enable row level security;
alter table public.thread_items enable row level security;
alter table public.blocks enable row level security;
alter table public.reports enable row level security;

-- profiles: name, username and photo are visible to everyone (even for private accounts), except across a block
create policy "profiles: visible unless blocked" on public.profiles for select to anon, authenticated
  using (not public.blocked_with(id));
create policy "profiles: create your own" on public.profiles for insert to authenticated
  with check (id = auth.uid());
create policy "profiles: edit your own" on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

create policy "username history: readable" on public.username_history for select to anon, authenticated using (true);

create policy "details: visible with the shelf" on public.profile_details for select to anon, authenticated
  using (public.can_see_shelf(id));
create policy "details: create your own" on public.profile_details for insert to authenticated
  with check (id = auth.uid());
create policy "details: edit your own" on public.profile_details for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

create policy "book suggestions: readable unless hidden" on public.book_suggestions for select to anon, authenticated using (not hidden);
-- shop books: only matched, shown rows (the Buy links); written only by the server
create policy "shop books: matched and shown" on public.shop_books for select to anon, authenticated
  using (not hidden and title_id is not null and match in ('sure', 'checked', 'new', 'openlibrary'));
create policy "titles: readable by everyone" on public.titles for select to anon, authenticated using (true);

create policy "logs: yours, or a visible shelf" on public.logs for select to anon, authenticated
  using (user_id = auth.uid() or (not only_me and public.can_see_shelf(user_id)));
create policy "logs: add your own" on public.logs for insert to authenticated with check (user_id = auth.uid());
create policy "logs: edit your own" on public.logs for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "logs: delete your own" on public.logs for delete to authenticated using (user_id = auth.uid());

create policy "highlights: visible with their entry" on public.highlights for select to anon, authenticated
  using (exists (select 1 from public.logs l where l.id = log_id));
create policy "highlights: add to your own entries" on public.highlights for insert to authenticated
  with check (user_id = auth.uid() and exists (select 1 from public.logs l where l.id = log_id and l.user_id = auth.uid()));
create policy "highlights: edit your own" on public.highlights for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and exists (select 1 from public.logs l where l.id = log_id and l.user_id = auth.uid()));
create policy "highlights: delete your own" on public.highlights for delete to authenticated using (user_id = auth.uid());

-- likes and comments: seen only when their review is (the subquery runs under the visitor's own rules), never across a block
create policy "review likes: seen with their review" on public.review_likes for select to anon, authenticated
  using (exists (select 1 from public.logs l where l.id = log_id) and not public.blocked_with(user_id));
create policy "review likes: like a review you can see" on public.review_likes for insert to authenticated
  with check (user_id = auth.uid() and exists (select 1 from public.logs l where l.id = log_id and (l.notes <> '' or l.tagline <> '')));
create policy "review likes: take back your own" on public.review_likes for delete to authenticated using (user_id = auth.uid());
create policy "review comments: seen with their review" on public.review_comments for select to anon, authenticated
  using (exists (select 1 from public.logs l where l.id = log_id) and not public.blocked_with(user_id));
create policy "review comments: comment on a review you can see" on public.review_comments for insert to authenticated
  with check (user_id = auth.uid() and exists (select 1 from public.logs l where l.id = log_id and (l.notes <> '' or l.tagline <> '')));
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

create policy "threads: visible with the shelf" on public.threads for select to anon, authenticated
  using (public.can_see_shelf(user_id));
create policy "threads: add your own" on public.threads for insert to authenticated with check (user_id = auth.uid());
create policy "threads: edit your own" on public.threads for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "threads: delete your own" on public.threads for delete to authenticated using (user_id = auth.uid());

create policy "thread items: visible with the shelf" on public.thread_items for select to anon, authenticated
  using (public.can_see_shelf(user_id));
create policy "thread items: add to your own threads" on public.thread_items for insert to authenticated
  with check (user_id = auth.uid() and exists (select 1 from public.threads t where t.id = thread_id and t.user_id = auth.uid()));
create policy "thread items: edit your own" on public.thread_items for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and exists (select 1 from public.threads t where t.id = thread_id and t.user_id = auth.uid()));
create policy "thread items: delete your own" on public.thread_items for delete to authenticated using (user_id = auth.uid());

create policy "blocks: see your own" on public.blocks for select to authenticated using (blocker = auth.uid());
create policy "blocks: block someone" on public.blocks for insert to authenticated with check (blocker = auth.uid());
create policy "blocks: unblock" on public.blocks for delete to authenticated using (blocker = auth.uid());

create policy "reports: see the ones you sent" on public.reports for select to authenticated using (reporter = auth.uid());
create policy "reports: send one" on public.reports for insert to authenticated
  with check (reporter = auth.uid() and status = 'open');

-- ───────────────────────── what each kind of visitor may do at all ─────────────────────────
-- (new tables aren't exposed automatically in this project, so every permission is listed here)

grant select on public.profiles, public.username_history, public.profile_details, public.titles,
  public.logs, public.highlights, public.threads, public.thread_items, public.book_suggestions, public.shop_books to anon, authenticated;
-- avatar_url isn't here: the website sets it (from the person's Google sign-in) with the secret key
grant insert (id, username, display_name, is_private, featured) on public.profiles to authenticated;
grant update (username, display_name, is_private, featured) on public.profiles to authenticated;
grant insert, update on public.profile_details to authenticated;
grant insert, update, delete on public.logs, public.highlights, public.threads to authenticated;
grant insert, delete on public.thread_items to authenticated;
grant update (position, why) on public.thread_items to authenticated;   -- an item can't be moved to another collection
grant select, insert, delete on public.blocks to authenticated;
grant select on public.reports to authenticated;
grant insert (reporter, target_user, target_log, target_comment, reason, details) on public.reports to authenticated;
grant select on public.review_likes, public.review_comments to anon, authenticated;
grant insert (log_id, user_id), delete on public.review_likes to authenticated;
grant insert (log_id, user_id, body), delete on public.review_comments to authenticated;
grant all on all tables in schema public to service_role;

revoke all on function public.blocked_with(uuid), public.can_see_shelf(uuid) from public;
grant execute on function public.blocked_with(uuid), public.can_see_shelf(uuid), public.username_reserved(text)
  to anon, authenticated, service_role;
revoke all on function public.title_reviews(uuid[], text, int, int) from public;
grant execute on function public.title_reviews(uuid[], text, int, int) to anon, authenticated, service_role;

commit;
