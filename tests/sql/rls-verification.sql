-- Run as a database administrator. Every test row is rolled back.
begin;

insert into auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('10000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'rls-owner@example.invalid', '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('10000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'rls-other@example.invalid', '{}'::jsonb, '{}'::jsonb, now(), now());

insert into public.user_roles (user_id, role)
values ('10000000-0000-4000-8000-000000000001', 'curator');

-- An authenticated user without a role cannot mutate the public catalog.
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
do $$
begin
  begin
    insert into public.artists (id, name, slug)
    values ('20000000-0000-4000-8000-000000000002', 'Must be rejected', 'rls-must-be-rejected');
    raise exception 'RLS failure: an unprivileged user inserted an artist';
  exception
    when insufficient_privilege then null;
  end;
end $$;
reset role;

-- A curator can create, update, and delete catalog rows and can manage their
-- own private archive and notification rules.
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
insert into public.artists (id, name, slug)
values ('20000000-0000-4000-8000-000000000001', 'RLS curator test', 'rls-curator-test');
update public.artists set description = 'updated by curator'
where id = '20000000-0000-4000-8000-000000000001';
insert into public.personal_tracks (id, user_id, title, notes)
values ('30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'Private owner track', 'owner only');
insert into public.notification_rules (id, user_id, event_type, destination_key)
values ('40000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'post_created', 'default');
reset role;

-- A different authenticated user sees and changes none of the owner's rows,
-- cannot read the owner's role, and cannot read collector logs.
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
do $$
declare
  affected integer;
begin
  if exists (select 1 from public.personal_tracks where id = '30000000-0000-4000-8000-000000000001') then
    raise exception 'RLS failure: another user read the owner track';
  end if;
  if exists (select 1 from public.notification_rules where id = '40000000-0000-4000-8000-000000000001') then
    raise exception 'RLS failure: another user read the owner notification rule';
  end if;
  if exists (select 1 from public.user_roles where user_id = '10000000-0000-4000-8000-000000000001') then
    raise exception 'RLS failure: another user read the owner role';
  end if;
  if exists (select 1 from public.update_logs) then
    raise exception 'RLS failure: an authenticated browser user read update logs';
  end if;

  update public.personal_tracks set notes = 'cross-user overwrite'
  where id = '30000000-0000-4000-8000-000000000001';
  get diagnostics affected = row_count;
  if affected <> 0 then
    raise exception 'RLS failure: another user updated the owner track';
  end if;

  update public.artists set description = 'unauthorized overwrite'
  where id = '20000000-0000-4000-8000-000000000001';
  get diagnostics affected = row_count;
  if affected <> 0 then
    raise exception 'RLS failure: an unprivileged user updated an artist';
  end if;
end $$;

insert into public.personal_tracks (id, user_id, title)
values ('30000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', 'Other user own track');
reset role;

rollback;
