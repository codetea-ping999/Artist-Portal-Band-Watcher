-- Artist Portal Band Watcher initial schema
-- Apply this migration in a Supabase project, then run supabase/seed.sql for starter data.

create extension if not exists pgcrypto;

do $$ begin
  create type public.source_type as enum ('official', 'rss', 'youtube', 'x', 'instagram', 'blog', 'live', 'label', 'other');
exception
  when duplicate_object then null;
end $$;

do $$ begin
  create type public.event_status as enum ('announced', 'presale', 'on_sale', 'sold_out', 'ended', 'cancelled', 'unknown');
exception
  when duplicate_object then null;
end $$;

create table if not exists public.artists (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  genre text,
  official_url text,
  image_url text,
  description text,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint artists_name_not_blank check (length(trim(name)) > 0),
  constraint artists_slug_not_blank check (length(trim(slug)) > 0)
);

create table if not exists public.sources (
  id uuid primary key default gen_random_uuid(),
  artist_id uuid not null references public.artists(id) on delete cascade,
  source_type public.source_type not null default 'other',
  label text not null,
  url text not null,
  enabled boolean not null default true,
  last_checked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sources_label_not_blank check (length(trim(label)) > 0),
  constraint sources_url_not_blank check (length(trim(url)) > 0),
  constraint sources_artist_url_unique unique (artist_id, url)
);

create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(),
  artist_id uuid not null references public.artists(id) on delete cascade,
  source_id uuid references public.sources(id) on delete set null,
  source_type public.source_type not null default 'other',
  title text not null,
  url text not null,
  summary text,
  external_id text,
  published_at timestamptz,
  raw_hash text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint posts_title_not_blank check (length(trim(title)) > 0),
  constraint posts_url_not_blank check (length(trim(url)) > 0),
  constraint posts_artist_url_unique unique (artist_id, url)
);

create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  artist_id uuid not null references public.artists(id) on delete cascade,
  source_id uuid references public.sources(id) on delete set null,
  title text not null,
  venue text,
  city text,
  starts_at timestamptz,
  doors_at timestamptz,
  ends_at timestamptz,
  ticket_url text,
  source_url text,
  status public.event_status not null default 'unknown',
  notes text,
  raw_hash text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint events_title_not_blank check (length(trim(title)) > 0),
  constraint events_artist_title_start_unique unique (artist_id, title, starts_at)
);

create table if not exists public.update_logs (
  id uuid primary key default gen_random_uuid(),
  source_id uuid references public.sources(id) on delete set null,
  status text not null,
  message text,
  checked_at timestamptz not null default now()
);

create index if not exists sources_artist_id_idx on public.sources(artist_id);
create index if not exists posts_artist_published_idx on public.posts(artist_id, published_at desc);
create index if not exists events_artist_starts_idx on public.events(artist_id, starts_at asc);
create index if not exists update_logs_source_checked_idx on public.update_logs(source_id, checked_at desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_artists_updated_at on public.artists;
create trigger set_artists_updated_at
before update on public.artists
for each row execute function public.set_updated_at();

drop trigger if exists set_sources_updated_at on public.sources;
create trigger set_sources_updated_at
before update on public.sources
for each row execute function public.set_updated_at();

drop trigger if exists set_posts_updated_at on public.posts;
create trigger set_posts_updated_at
before update on public.posts
for each row execute function public.set_updated_at();

drop trigger if exists set_events_updated_at on public.events;
create trigger set_events_updated_at
before update on public.events
for each row execute function public.set_updated_at();

alter table public.artists enable row level security;
alter table public.sources enable row level security;
alter table public.posts enable row level security;
alter table public.events enable row level security;
alter table public.update_logs enable row level security;

grant usage on schema public to anon, authenticated;
grant select on public.artists, public.sources, public.posts, public.events to anon, authenticated;

drop policy if exists "Public artists are readable" on public.artists;
create policy "Public artists are readable"
on public.artists for select
to anon, authenticated
using (true);

drop policy if exists "Public sources are readable" on public.sources;
create policy "Public sources are readable"
on public.sources for select
to anon, authenticated
using (true);

drop policy if exists "Public posts are readable" on public.posts;
create policy "Public posts are readable"
on public.posts for select
to anon, authenticated
using (true);

drop policy if exists "Public events are readable" on public.events;
create policy "Public events are readable"
on public.events for select
to anon, authenticated
using (true);

-- update_logs stays private by default. Use service_role or SQL Editor for operations.
