-- Collector configuration and enriched post metadata.
alter table public.sources
  add column if not exists config jsonb not null default '{}'::jsonb;

alter table public.posts
  add column if not exists metadata jsonb not null default '{}'::jsonb;

do $$ begin
  create type public.app_role as enum ('admin', 'curator');
exception
  when duplicate_object then null;
end $$;

create table if not exists public.user_roles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role public.app_role not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists user_roles_role_idx on public.user_roles(role);

alter table public.user_roles enable row level security;
grant select on public.user_roles to authenticated;

drop policy if exists "Users can read their own role" on public.user_roles;
create policy "Users can read their own role"
on public.user_roles for select
to authenticated
using ((select auth.uid()) = user_id);

-- Public catalog data remains readable; only assigned curators can mutate it.
drop policy if exists "Curators manage artists" on public.artists;
create policy "Curators manage artists"
on public.artists for all
to authenticated
using (
  exists (
    select 1 from public.user_roles
    where user_id = (select auth.uid()) and role in ('admin', 'curator')
  )
)
with check (
  exists (
    select 1 from public.user_roles
    where user_id = (select auth.uid()) and role in ('admin', 'curator')
  )
);

drop policy if exists "Curators manage sources" on public.sources;
create policy "Curators manage sources"
on public.sources for all
to authenticated
using (
  exists (
    select 1 from public.user_roles
    where user_id = (select auth.uid()) and role in ('admin', 'curator')
  )
)
with check (
  exists (
    select 1 from public.user_roles
    where user_id = (select auth.uid()) and role in ('admin', 'curator')
  )
);

drop policy if exists "Curators manage events" on public.events;
create policy "Curators manage events"
on public.events for all
to authenticated
using (
  exists (
    select 1 from public.user_roles
    where user_id = (select auth.uid()) and role in ('admin', 'curator')
  )
)
with check (
  exists (
    select 1 from public.user_roles
    where user_id = (select auth.uid()) and role in ('admin', 'curator')
  )
);

grant insert, update, delete on public.artists, public.sources, public.events to authenticated;

-- Notification destinations are stored as named server-side secrets, never as
-- browser-visible webhook URLs. A user may manage only their own rules.
create table if not exists public.notification_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  artist_id uuid references public.artists(id) on delete cascade,
  event_type text not null check (event_type in ('post_created', 'event_created', 'event_changed')),
  destination_key text not null default 'default',
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint notification_rules_destination_not_blank check (length(trim(destination_key)) > 0)
);

create index if not exists notification_rules_user_enabled_idx
  on public.notification_rules(user_id, enabled);
create index if not exists notification_rules_artist_event_idx
  on public.notification_rules(artist_id, event_type)
  where enabled;

create unique index if not exists notification_rules_user_scope_unique
  on public.notification_rules(user_id, coalesce(artist_id, '00000000-0000-0000-0000-000000000000'::uuid), event_type, destination_key);

create table if not exists public.notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  rule_id uuid not null references public.notification_rules(id) on delete cascade,
  entity_type text not null check (entity_type in ('post', 'event')),
  entity_id uuid not null,
  change_hash text not null,
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed')),
  attempts integer not null default 0 check (attempts >= 0),
  last_error text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint notification_deliveries_change_not_blank check (length(trim(change_hash)) > 0),
  constraint notification_deliveries_deduplicated unique (rule_id, entity_type, entity_id, change_hash)
);

create index if not exists notification_deliveries_status_idx
  on public.notification_deliveries(status, created_at);

alter table public.notification_rules enable row level security;
alter table public.notification_deliveries enable row level security;
grant select, insert, update, delete on public.notification_rules to authenticated;
grant select on public.notification_deliveries to authenticated;

drop policy if exists "Users manage their notification rules" on public.notification_rules;
create policy "Users manage their notification rules"
on public.notification_rules for all
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "Users read their notification deliveries" on public.notification_deliveries;
create policy "Users read their notification deliveries"
on public.notification_deliveries for select
to authenticated
using (
  exists (
    select 1 from public.notification_rules
    where notification_rules.id = notification_deliveries.rule_id
      and notification_rules.user_id = (select auth.uid())
  )
);

-- Private music archive. Every table carries an owner ID so policies do not
-- rely on client-provided joins or public catalog data.
create table if not exists public.personal_tracks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  artist_id uuid references public.artists(id) on delete set null,
  title text not null,
  tags text[] not null default '{}',
  practice_status text not null default 'not_started'
    check (practice_status in ('not_started', 'learning', 'rehearsing', 'ready', 'paused')),
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint personal_tracks_title_not_blank check (length(trim(title)) > 0)
);

create index if not exists personal_tracks_user_updated_idx
  on public.personal_tracks(user_id, updated_at desc);

create table if not exists public.personal_setlists (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  event_id uuid references public.events(id) on delete set null,
  title text not null,
  performed_on date,
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint personal_setlists_title_not_blank check (length(trim(title)) > 0)
);

create index if not exists personal_setlists_user_date_idx
  on public.personal_setlists(user_id, performed_on desc nulls last);

create table if not exists public.personal_setlist_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  setlist_id uuid not null references public.personal_setlists(id) on delete cascade,
  track_id uuid references public.personal_tracks(id) on delete set null,
  position integer not null check (position > 0),
  title text not null,
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint personal_setlist_items_title_not_blank check (length(trim(title)) > 0),
  constraint personal_setlist_items_position_unique unique (setlist_id, position)
);

create index if not exists personal_setlist_items_user_setlist_idx
  on public.personal_setlist_items(user_id, setlist_id, position);

create table if not exists public.practice_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  track_id uuid references public.personal_tracks(id) on delete set null,
  practiced_on date not null default current_date,
  duration_minutes integer check (duration_minutes is null or duration_minutes >= 0),
  status text not null default 'completed' check (status in ('planned', 'completed', 'skipped')),
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists practice_entries_user_date_idx
  on public.practice_entries(user_id, practiced_on desc);

alter table public.personal_tracks enable row level security;
alter table public.personal_setlists enable row level security;
alter table public.personal_setlist_items enable row level security;
alter table public.practice_entries enable row level security;

grant select, insert, update, delete on public.personal_tracks,
  public.personal_setlists, public.personal_setlist_items, public.practice_entries to authenticated;

drop policy if exists "Users manage their personal tracks" on public.personal_tracks;
create policy "Users manage their personal tracks"
on public.personal_tracks for all
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "Users manage their personal setlists" on public.personal_setlists;
create policy "Users manage their personal setlists"
on public.personal_setlists for all
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "Users manage their personal setlist items" on public.personal_setlist_items;
create policy "Users manage their personal setlist items"
on public.personal_setlist_items for all
to authenticated
using ((select auth.uid()) = user_id)
with check (
  (select auth.uid()) = user_id
  and exists (
    select 1 from public.personal_setlists
    where personal_setlists.id = personal_setlist_items.setlist_id
      and personal_setlists.user_id = (select auth.uid())
  )
  and (
    track_id is null or exists (
      select 1 from public.personal_tracks
      where personal_tracks.id = personal_setlist_items.track_id
        and personal_tracks.user_id = (select auth.uid())
    )
  )
);

drop policy if exists "Users manage their practice entries" on public.practice_entries;
create policy "Users manage their practice entries"
on public.practice_entries for all
to authenticated
using ((select auth.uid()) = user_id)
with check (
  (select auth.uid()) = user_id
  and (
    track_id is null or exists (
      select 1 from public.personal_tracks
      where personal_tracks.id = practice_entries.track_id
        and personal_tracks.user_id = (select auth.uid())
    )
  )
);

drop trigger if exists set_user_roles_updated_at on public.user_roles;
create trigger set_user_roles_updated_at before update on public.user_roles
for each row execute function public.set_updated_at();

drop trigger if exists set_notification_rules_updated_at on public.notification_rules;
create trigger set_notification_rules_updated_at before update on public.notification_rules
for each row execute function public.set_updated_at();

drop trigger if exists set_notification_deliveries_updated_at on public.notification_deliveries;
create trigger set_notification_deliveries_updated_at before update on public.notification_deliveries
for each row execute function public.set_updated_at();

drop trigger if exists set_personal_tracks_updated_at on public.personal_tracks;
create trigger set_personal_tracks_updated_at before update on public.personal_tracks
for each row execute function public.set_updated_at();

drop trigger if exists set_personal_setlists_updated_at on public.personal_setlists;
create trigger set_personal_setlists_updated_at before update on public.personal_setlists
for each row execute function public.set_updated_at();

drop trigger if exists set_personal_setlist_items_updated_at on public.personal_setlist_items;
create trigger set_personal_setlist_items_updated_at before update on public.personal_setlist_items
for each row execute function public.set_updated_at();

drop trigger if exists set_practice_entries_updated_at on public.practice_entries;
create trigger set_practice_entries_updated_at before update on public.practice_entries
for each row execute function public.set_updated_at();
