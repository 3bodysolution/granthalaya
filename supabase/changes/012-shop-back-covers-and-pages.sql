-- Back covers and page counts from the shops (Akshardhara and BookGanga, with their permission).
-- shop_books gains pages (the shop's edition: Akshardhara's product text, BookGanga's book page) and back_src (Akshardhara's second
-- product image when it is the back cover; its names end in -b). Like cover_src, back_src is only an address at the shop: pages show it
-- through /api/cover, never from the shop, and a hidden cover (cover_hidden) hides it too.
-- (supabase/schema.sql already includes this for new databases.)
begin;

alter table public.shop_books
  add column if not exists pages int check (pages is null or pages between 1 and 100000),
  add column if not exists back_src text check (back_src is null or (back_src ~ '^https://cdn\.shopify\.com/s/files/1/0800/1214/9058/' and char_length(back_src) <= 600));

commit;
