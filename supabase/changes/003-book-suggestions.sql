-- Phase 2, step 3, part 4: Marathi and Hindi books suggested each week by a free AI model. Every book was
-- checked against Open Library, Google Books or Wikipedia before it got here. The admin can hide one.
-- Only the website's server writes here (with the secret key); everyone can read the ones that aren't hidden.
-- (supabase/schema.sql already includes this for new databases.)
begin;
create table if not exists public.book_suggestions (
  id uuid primary key default gen_random_uuid(),
  language text not null check (language in ('mr', 'hi')),
  title_id uuid not null references public.titles (id) on delete cascade,
  checked_with text not null check (checked_with in ('Open Library', 'Google Books', 'Wikipedia')),
  hidden boolean not null default false,
  created_at timestamptz not null default now(),
  unique (language, title_id)
);
create index if not exists book_suggestions_shown on public.book_suggestions (language, created_at desc) where not hidden;
alter table public.book_suggestions enable row level security;
drop policy if exists "book suggestions: readable unless hidden" on public.book_suggestions;
create policy "book suggestions: readable unless hidden" on public.book_suggestions for select to anon, authenticated using (not hidden);
grant select on public.book_suggestions to anon, authenticated;
grant all on public.book_suggestions to service_role;
commit;
