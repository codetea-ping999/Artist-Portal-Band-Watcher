-- The preceding migration was already applied to the hosted project with an
-- artist-wide index. GUIDs and Atom IDs are only guaranteed unique per feed,
-- so replace that index without weakening URL-level deduplication.
drop index if exists public.posts_artist_external_id_unique;

create unique index if not exists posts_source_external_id_unique
  on public.posts (source_id, external_id)
  where external_id is not null and btrim(external_id) <> '';
