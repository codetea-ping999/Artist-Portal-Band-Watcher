-- Claim delivery rows atomically before making a provider call. This prevents
-- overlapping collector invocations from posting the same notification.
create unique index if not exists notification_rules_user_scope_unique
  on public.notification_rules(user_id, coalesce(artist_id, '00000000-0000-0000-0000-000000000000'::uuid), event_type, destination_key);

alter table public.notification_deliveries
  add column if not exists claimed_at timestamptz;

alter table public.notification_deliveries
  drop constraint if exists notification_deliveries_status_check;
alter table public.notification_deliveries
  add constraint notification_deliveries_status_check
  check (status in ('pending', 'processing', 'sent', 'failed'));

create or replace function public.claim_notification_delivery(target_delivery_id uuid)
returns setof public.notification_deliveries
language sql
security invoker
set search_path = ''
as $$
  update public.notification_deliveries as delivery
  set status = 'processing',
      attempts = delivery.attempts + 1,
      claimed_at = now(),
      last_error = null
  where delivery.id = target_delivery_id
    and delivery.status in ('pending', 'failed')
    and delivery.attempts < 3
  returning delivery.*;
$$;

revoke all on function public.claim_notification_delivery(uuid) from public, anon, authenticated;
grant execute on function public.claim_notification_delivery(uuid) to service_role;
