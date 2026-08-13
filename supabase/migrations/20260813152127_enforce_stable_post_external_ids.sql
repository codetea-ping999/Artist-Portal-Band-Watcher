-- A feed's canonical URL can change while its GUID/Atom ID remains stable.
-- Enforce the same feed-scoped identity rule used by the collector so
-- concurrent runs cannot create a second row for the same external item.
create unique index if not exists posts_source_external_id_unique
  on public.posts (source_id, external_id)
  where external_id is not null and btrim(external_id) <> '';
