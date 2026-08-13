-- Run as a database administrator. Every test row is rolled back.
begin;

insert into auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('11000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'notification-claim@example.invalid', '{}'::jsonb, '{}'::jsonb, now(), now());

insert into public.artists (id, name, slug)
values ('21000000-0000-4000-8000-000000000001', 'Notification claim test', 'notification-claim-test');

insert into public.sources (id, artist_id, source_type, label, url)
values ('22000000-0000-4000-8000-000000000001', '21000000-0000-4000-8000-000000000001', 'rss', 'Claim test feed', 'https://example.invalid/feed');

insert into public.posts (id, artist_id, source_id, source_type, title, url, external_id, raw_hash)
values ('23000000-0000-4000-8000-000000000001', '21000000-0000-4000-8000-000000000001', '22000000-0000-4000-8000-000000000001', 'rss', 'Claim test post', 'https://example.invalid/post', 'claim-1', 'claim-hash');

insert into public.notification_rules (id, user_id, artist_id, event_type, destination_key)
values ('24000000-0000-4000-8000-000000000001', '11000000-0000-4000-8000-000000000001', '21000000-0000-4000-8000-000000000001', 'post_created', 'default');

insert into public.notification_deliveries (id, rule_id, entity_type, entity_id, change_hash)
values ('25000000-0000-4000-8000-000000000001', '24000000-0000-4000-8000-000000000001', 'post', '23000000-0000-4000-8000-000000000001', 'claim-hash');

set local role service_role;
do $$
declare
  claimed integer;
begin
  select count(*) into claimed
  from public.claim_notification_delivery('25000000-0000-4000-8000-000000000001');
  if claimed <> 1 then
    raise exception 'Claim failure: first worker did not claim the delivery';
  end if;

  select count(*) into claimed
  from public.claim_notification_delivery('25000000-0000-4000-8000-000000000001');
  if claimed <> 0 then
    raise exception 'Claim failure: a second worker claimed the same delivery';
  end if;

  if not exists (
    select 1 from public.notification_deliveries
    where id = '25000000-0000-4000-8000-000000000001'
      and status = 'processing'
      and attempts = 1
      and claimed_at is not null
  ) then
    raise exception 'Claim failure: delivery state was not updated atomically';
  end if;
end
$$;
reset role;

rollback;
