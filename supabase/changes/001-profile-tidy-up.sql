-- Phase 2, step 1: the profile no longer has a season line, a reading goal or a typed "line of the week".
-- Instead you pin one of the lines you saved on a book. Run once in Supabase → SQL Editor.
-- (supabase/schema.sql already includes this for new databases.)
begin;
alter table public.profile_details
  drop column if exists season_line,
  drop column if exists lotw_text,
  drop column if exists lotw_by,
  drop column if exists lotw_source,
  drop column if exists goal_books,
  add column if not exists pinned_line uuid;
alter table public.profile_details drop constraint if exists profile_details_pinned_line_fkey;
alter table public.profile_details add constraint profile_details_pinned_line_fkey
  foreign key (pinned_line) references public.highlights (id) on delete set null;
commit;
