-- Run after migrations as the local Supabase postgres role:
-- psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/rls.sql
-- All test records are rolled back.
begin;

insert into auth.users (id, instance_id, aud, role, email, encrypted_password) values
  ('11111111-1111-4111-8111-111111111111', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rls-a@example.invalid', ''),
  ('22222222-2222-4222-8222-222222222222', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rls-b@example.invalid', ''),
  ('66666666-6666-4666-8666-666666666666', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rls-c@example.invalid', '');

set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
select set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111","app_metadata":{"marker_username":"owner"}}', true);

insert into public.survey_sessions (id, document) values
  ('33333333-3333-4333-8333-333333333333', '{"id":"33333333-3333-4333-8333-333333333333"}');
insert into public.survey_casts (id, session_id, document) values
  ('44444444-4444-4444-8444-444444444444', '33333333-3333-4333-8333-333333333333', '{"id":"44444444-4444-4444-8444-444444444444"}');

do $$
begin
  if (select count(*) from public.survey_sessions) <> 1 or
     (select count(*) from public.survey_casts) <> 1 then
    raise exception 'Owner cannot read their records';
  end if;
end;
$$;

select set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111","app_metadata":{},"user_metadata":{"marker_username":"forged"}}', true);
do $$
declare affected integer;
begin
  if exists (select 1 from public.survey_sessions) or exists (select 1 from public.survey_casts) then
    raise exception 'A regular account can read even its own marker records';
  end if;
  update public.survey_sessions set revision = 2
    where id = '33333333-3333-4333-8333-333333333333';
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'A regular account changed a marker record'; end if;
end;
$$;

select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);
select set_config('request.jwt.claims', '{"sub":"22222222-2222-4222-8222-222222222222","app_metadata":{"marker_username":"other"}}', true);

do $$
declare affected integer;
begin
  if exists (select 1 from public.survey_sessions) or exists (select 1 from public.survey_casts) then
    raise exception 'Another user can read private records';
  end if;

  update public.survey_sessions set revision = 2
    where id = '33333333-3333-4333-8333-333333333333';
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'Another user changed a private record'; end if;

  begin
    insert into public.survey_casts (id, session_id, document) values
      ('55555555-5555-4555-8555-555555555555', '33333333-3333-4333-8333-333333333333', '{"id":"55555555-5555-4555-8555-555555555555"}');
    raise exception 'Cross-owner cast was accepted';
  exception when foreign_key_violation then null;
  end;
end;
$$;

-- A normal Supabase account cannot use these tables by adding a marker-like
-- value to mutable user_metadata. The Edge function alone writes app_metadata.
select set_config('request.jwt.claim.sub', '66666666-6666-4666-8666-666666666666', true);
select set_config('request.jwt.claims', '{"sub":"66666666-6666-4666-8666-666666666666","app_metadata":{},"user_metadata":{"marker_username":"forged"}}', true);

do $$
begin
  if exists (select 1 from public.survey_sessions) or exists (select 1 from public.survey_casts) then
    raise exception 'Ordinary account can read marker records';
  end if;
  begin
    insert into public.survey_sessions (id, document) values
      ('77777777-7777-4777-8777-777777777777', '{"id":"77777777-7777-4777-8777-777777777777"}');
    raise exception 'Ordinary account was allowed to create marker records';
  exception when insufficient_privilege then
    if sqlerrm not like '%row-level security%' then raise; end if;
  end;
end;
$$;

select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
select set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111","app_metadata":{"marker_username":"owner"}}', true);

do $$
begin
  begin
    update public.survey_sessions set revision = 3
      where id = '33333333-3333-4333-8333-333333333333';
    raise exception 'Skipped revision was accepted';
  exception when raise_exception then
    if sqlerrm <> 'Survey revision conflict' then raise; end if;
  end;
end;
$$;

update public.survey_sessions set revision = 2
  where id = '33333333-3333-4333-8333-333333333333' and revision = 1;

set local role anon;
do $$
begin
  begin
    perform 1 from public.survey_sessions limit 1;
    raise exception 'Anonymous access was accepted';
  exception when insufficient_privilege then null;
  end;
end;
$$;

rollback;
