-- Profile photos people upload themselves (Settings > Profile > Photo > Upload a photo).
--  · Storage bucket "avatars": public to read (a photo is shown to anyone who sees the profile), WebP only, 1 MB at most.
--    Files live at <user id>/<random name>.webp. Only the website (after checking and re-drawing the picture) writes them, but the
--    policies below also say that a signed-in member could only ever touch their own folder. Nobody can list the folders: there is
--    no select policy for the public (a public bucket serves a file by its exact address without one).
--  · avatar_url_ok: a photo address may now also be a file in the avatars bucket, but only in the member's OWN folder
--    (the check uses the row's own id), as well as Google's photo host as before.
--  · avatar_uploads: one row per upload, so "10 uploads an hour" holds across every running copy of the site. Nobody can read or
--    write it from the browser (row level security on, no policies, no grants except the website's own key).
-- (supabase/schema.sql already includes all of this for new databases.)
begin;

alter table public.profiles drop constraint if exists avatar_url_ok;
alter table public.profiles add constraint avatar_url_ok check (avatar_url is null or (char_length(avatar_url) <= 600 and (
  avatar_url ~ '^https://lh3\.googleusercontent\.com/[A-Za-z0-9_./=+%-]+$'
  or avatar_url ~ ('^https://[a-z0-9]{15,30}\.supabase\.co/storage/v1/object/public/avatars/' || id::text || '/[A-Za-z0-9_-]{8,64}\.webp$')
)));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 1048576, array['image/webp'])
on conflict (id) do update set public = true, file_size_limit = 1048576, allowed_mime_types = array['image/webp'];

drop policy if exists "avatars: write your own folder" on storage.objects;
drop policy if exists "avatars: replace your own files" on storage.objects;
drop policy if exists "avatars: delete your own files" on storage.objects;
drop policy if exists "avatars: see your own files" on storage.objects;
create policy "avatars: write your own folder" on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "avatars: replace your own files" on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "avatars: delete your own files" on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "avatars: see your own files" on storage.objects for select to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create table if not exists public.avatar_uploads (
  user_id uuid not null references public.profiles (id) on delete cascade,
  at timestamptz not null default now()
);
create index if not exists avatar_uploads_user on public.avatar_uploads (user_id, at desc);
alter table public.avatar_uploads enable row level security;   -- no policies: members cannot touch it
revoke all on public.avatar_uploads from anon, authenticated;
grant select, insert, delete on public.avatar_uploads to service_role;

commit;
