-- Share cards: the painting behind a title's card (one of our 11 names), picked once by the free AI model
-- from the title's summary, genres and setting, and saved so it is chosen only once.
-- (supabase/schema.sql already includes this for new databases.)
begin;
alter table public.titles
  add column if not exists card_bg text check (card_bg is null or card_bg in
    ('cinema', 'fair', 'fields', 'forest', 'fort', 'noir', 'rain', 'reading', 'sea', 'stars', 'wada'));
commit;
