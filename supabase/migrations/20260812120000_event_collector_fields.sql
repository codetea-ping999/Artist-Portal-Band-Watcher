-- Keep event collector metadata available on projects that already applied the initial schema.
alter table public.events
  add column if not exists source_id uuid references public.sources(id) on delete set null;

alter table public.events
  add column if not exists raw_hash text;

create index if not exists events_source_id_idx on public.events(source_id);
