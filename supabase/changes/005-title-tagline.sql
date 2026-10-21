-- Share cards: the short line under a title (TMDB's own tagline, or one line written once by the free AI model
-- from the title's summary) is saved on the title so it is made only once.
-- Run once in Supabase → SQL Editor. Until it is run, cards still show a line but make it again each time.
-- (supabase/schema.sql already includes this for new databases.)
begin;
alter table public.titles
  add column if not exists tagline text check (tagline is null or char_length(tagline) <= 140);
commit;
