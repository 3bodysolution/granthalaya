-- Books from two Indian bookshops, with their permission: Akshardhara and BookGanga.
-- Each shop book we use is one row in shop_books: its address at the shop (for the "Buy at" links), what the shop says about it,
-- its cover's address at the shop, and which of our catalogue titles it is. Covers are never copied here: pages show them
-- through /api/cover, which Vercel's CDN keeps. A cover or a whole book can be hidden at once if a shop asks
-- (hidden, cover_hidden); hidden rows stay, so a re-run of scripts/shops never brings them back.
-- titles gains publisher, and cover_from (which shop a cover came from, so hiding it knows what to clear).
-- New books from a shop are our own records: titles.source 'Akshardhara' or 'BookGanga', never looked up on Open Library.
-- (supabase/schema.sql already includes this for new databases.)
begin;

alter table public.titles
  add column if not exists publisher text check (publisher is null or char_length(publisher) <= 200),
  add column if not exists cover_from text check (cover_from is null or cover_from in ('akshardhara', 'bookganga'));

create table if not exists public.shop_books (
  id uuid primary key default gen_random_uuid(),
  shop text not null check (shop in ('akshardhara', 'bookganga')),
  shop_key text not null check (char_length(shop_key) between 1 and 200),       -- Akshardhara's product handle, BookGanga's book id
  url text not null check (url ~ '^https://(akshardhara\.com|www\.bookganga\.com)/' and char_length(url) <= 600),
  title text not null default '' check (char_length(title) <= 300),
  original_title text not null default '' check (char_length(original_title) <= 300),
  author text not null default '' check (char_length(author) <= 300),
  publisher text not null default '' check (char_length(publisher) <= 200),
  language text check (language is null or language in ('mr', 'hi')),
  isbn text check (isbn is null or isbn ~ '^97[89][0-9]{10}$'),
  cover_src text check (cover_src is null or (cover_src ~ '^https://(cdn\.shopify\.com/s/files/1/0800/1214/9058/|www\.bookganga\.com/eBooks/Content/images/books/)' and char_length(cover_src) <= 600)),
  lists text[] not null default '{}',                                             -- the shop lists it was found in
  title_id uuid references public.titles (id) on delete set null,                 -- which of our titles it is
  match text not null default 'new' check (match in ('sure', 'checked', 'new', 'openlibrary', 'unsure', 'rejected')),
  hidden boolean not null default false,        -- a shop asked: no link, no cover, never brought back by a re-run
  cover_hidden boolean not null default false,  -- a shop asked about the cover only
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  unique (shop, shop_key)
);
create index if not exists shop_books_title on public.shop_books (title_id) where title_id is not null and not hidden;

alter table public.shop_books enable row level security;
-- anyone may read a shop book that is matched to one of our titles and not hidden (the Buy links on its page);
-- unsure, rejected and hidden rows stay private to the server
drop policy if exists "shop books: matched and shown" on public.shop_books;
create policy "shop books: matched and shown" on public.shop_books for select to anon, authenticated
  using (not hidden and title_id is not null and match in ('sure', 'checked', 'new', 'openlibrary'));
-- no insert, update or delete for anyone signed in: only the server's script (scripts/shops) and the admin page (after its check) write
grant select on public.shop_books to anon, authenticated;
grant all on public.shop_books to service_role;

commit;
