-- The cover's main colour, worked out once by the site and kept on the title (used by the shelf on the Stats page).
alter table public.titles add column if not exists cover_color text
  check (cover_color is null or cover_color ~ '^#[0-9a-fA-F]{6}$');
