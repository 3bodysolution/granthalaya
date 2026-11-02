-- Faster forgiving search, for later. NOT needed yet: search matches spellings in code (src/lib/fuzzy.ts) over a copy of our
-- titles and members kept in memory for ten minutes, and that is quick while the catalogue is a few thousand rows.
-- When the catalogue is much bigger (tens of thousands of titles), move the matching into the database with these indexes and
-- a query such as:  select slug, title, similarity(title, 'batatyachi chal') s from titles where title % 'batatyachi chal' order by s desc limit 8;
-- (supabase/schema.sql includes this for new databases.)
begin;

create extension if not exists pg_trgm with schema extensions;

create index if not exists titles_title_trgm on public.titles using gin (title extensions.gin_trgm_ops);
create index if not exists titles_original_title_trgm on public.titles using gin (original_title extensions.gin_trgm_ops) where original_title is not null;
create index if not exists titles_creator_trgm on public.titles using gin (creator extensions.gin_trgm_ops) where creator <> '';
create index if not exists profiles_username_trgm on public.profiles using gin (username extensions.gin_trgm_ops);

commit;
