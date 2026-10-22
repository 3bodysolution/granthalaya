-- Book descriptions: a clean "what is this book" text, saved once on the title. From Wikipedia's intro (credited and linked,
-- CC BY-SA), else Open Library's text; when that is long or messy, 2 or 3 plain sentences written from it by the free AI model.
-- `description_checked_at` is set after a look, so a book with no Wikipedia page isn't searched again for 90 days.
-- Google Books text is never saved here (its terms limit storing); the page cleans it on the fly.
-- (supabase/schema.sql already includes this for new databases.)
begin;
alter table public.titles
  add column if not exists description text check (description is null or char_length(description) <= 2000),
  add column if not exists description_source text check (description_source is null or description_source in
    ('wikipedia', 'openlibrary', 'ai-wikipedia', 'ai-openlibrary')),
  add column if not exists description_url text check (description_url is null or char_length(description_url) <= 600),
  add column if not exists description_checked_at timestamptz;
commit;
