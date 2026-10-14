-- Phase 2, step 3, part 2: catalogue books that Open Library and Google Books don't have (many Marathi and
-- Hindi prize winners and classics) keep their original-script title, language and a short factual note.
-- Run once in Supabase → SQL Editor, before running scripts/lists/make-records.mjs.
-- (supabase/schema.sql already includes this for new databases.)
begin;
alter table public.titles
  add column if not exists original_title text check (original_title is null or char_length(original_title) <= 300),
  add column if not exists language text check (language is null or language ~ '^[a-z]{2,3}$'),  -- ISO 639-1, else 639-3
  add column if not exists note text check (note is null or char_length(note) <= 300);
commit;
