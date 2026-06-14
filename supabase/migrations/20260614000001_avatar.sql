-- Profile pictures.
--
-- Photos live in Supabase Storage (separate 1 GB free-tier quota), NOT in the
-- 500 MB Postgres DB — the column below only holds the public URL (a few bytes).
-- The frontend crops + resizes to a small webp (~256px) before upload, so even
-- the whole squad costs a couple of MB of storage.

alter table public.users add column if not exists avatar_url text;

-- Public bucket: read is unauthenticated (so <img src> works without a token);
-- writes go through the backend on the service_role key, which bypasses RLS, so
-- no storage.objects policies are required. Size/MIME limits are a backstop —
-- the client already shrinks the image well under these.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'avatars',
  'avatars',
  true,
  2097152, -- 2 MiB
  array['image/webp', 'image/jpeg', 'image/png']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
