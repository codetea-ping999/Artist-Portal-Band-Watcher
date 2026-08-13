-- `update_logs` is intentionally unavailable to browser roles. This policy is
-- scoped to the service role and documents that posture without exposing rows.
drop policy if exists "Service role manages update logs" on public.update_logs;
create policy "Service role manages update logs"
on public.update_logs for all
to service_role
using (true)
with check (true);

-- Some hosted projects install this database event-trigger helper outside the
-- repository migrations. Harden it when present without breaking a fresh DB.
do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    execute 'revoke all on function public.rls_auto_enable() from public, anon, authenticated';
  end if;
end
$$;

-- Public SELECT policies already expose catalog data to authenticated users.
-- Scope curator policies to write operations to avoid redundant SELECT policy
-- evaluation while preserving the same authorization guarantee.
drop policy if exists "Curators manage artists" on public.artists;
create policy "Curators insert artists"
on public.artists for insert
to authenticated
with check (
  exists (select 1 from public.user_roles where user_id = (select auth.uid()) and role in ('admin', 'curator'))
);
create policy "Curators update artists"
on public.artists for update
to authenticated
using (exists (select 1 from public.user_roles where user_id = (select auth.uid()) and role in ('admin', 'curator')))
with check (exists (select 1 from public.user_roles where user_id = (select auth.uid()) and role in ('admin', 'curator')));
create policy "Curators delete artists"
on public.artists for delete
to authenticated
using (exists (select 1 from public.user_roles where user_id = (select auth.uid()) and role in ('admin', 'curator')));

drop policy if exists "Curators manage sources" on public.sources;
create policy "Curators insert sources"
on public.sources for insert
to authenticated
with check (
  exists (select 1 from public.user_roles where user_id = (select auth.uid()) and role in ('admin', 'curator'))
);
create policy "Curators update sources"
on public.sources for update
to authenticated
using (exists (select 1 from public.user_roles where user_id = (select auth.uid()) and role in ('admin', 'curator')))
with check (exists (select 1 from public.user_roles where user_id = (select auth.uid()) and role in ('admin', 'curator')));
create policy "Curators delete sources"
on public.sources for delete
to authenticated
using (exists (select 1 from public.user_roles where user_id = (select auth.uid()) and role in ('admin', 'curator')));

drop policy if exists "Curators manage events" on public.events;
create policy "Curators insert events"
on public.events for insert
to authenticated
with check (
  exists (select 1 from public.user_roles where user_id = (select auth.uid()) and role in ('admin', 'curator'))
);
create policy "Curators update events"
on public.events for update
to authenticated
using (exists (select 1 from public.user_roles where user_id = (select auth.uid()) and role in ('admin', 'curator')))
with check (exists (select 1 from public.user_roles where user_id = (select auth.uid()) and role in ('admin', 'curator')));
create policy "Curators delete events"
on public.events for delete
to authenticated
using (exists (select 1 from public.user_roles where user_id = (select auth.uid()) and role in ('admin', 'curator')));

create index if not exists posts_source_id_idx on public.posts(source_id);
create index if not exists personal_tracks_artist_id_idx on public.personal_tracks(artist_id);
create index if not exists personal_setlists_event_id_idx on public.personal_setlists(event_id);
create index if not exists personal_setlist_items_track_id_idx on public.personal_setlist_items(track_id);
create index if not exists practice_entries_track_id_idx on public.practice_entries(track_id);
