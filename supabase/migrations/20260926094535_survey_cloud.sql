-- Cloud copies of saved v3 records. Active drafts stay in IndexedDB.
create table public.survey_sessions (
  id uuid primary key,
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  document jsonb not null,
  revision integer not null default 1 check (revision > 0),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (id, owner_id),
  constraint survey_session_document check (
    jsonb_typeof(document) = 'object'
    and document ? 'id'
    and jsonb_typeof(document->'id') = 'string'
    and document->>'id' = id::text
  )
);

create table public.survey_casts (
  id uuid primary key,
  session_id uuid not null,
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  document jsonb not null,
  revision integer not null default 1 check (revision > 0),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint survey_cast_session foreign key (session_id, owner_id)
    references public.survey_sessions(id, owner_id) on delete cascade,
  constraint survey_cast_document check (
    jsonb_typeof(document) = 'object'
    and document ? 'id'
    and jsonb_typeof(document->'id') = 'string'
    and document->>'id' = id::text
  )
);

create index survey_sessions_owner_updated on public.survey_sessions(owner_id, updated_at, id);
create index survey_casts_owner_updated on public.survey_casts(owner_id, updated_at, id);
create index survey_casts_session on public.survey_casts(session_id);

-- Direct Data API callers must also advance exactly one revision. The server
-- additionally compares the expected revision so stale writes become conflicts.
create function public.enforce_survey_revision() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.updated_at := now();
    return new;
  end if;
  if new.id is distinct from old.id or new.owner_id is distinct from old.owner_id then
    raise exception 'Survey record identity cannot change';
  end if;
  if tg_table_name = 'survey_casts' then
    if new.session_id is distinct from old.session_id then
      raise exception 'A cast cannot move to another session';
    end if;
  end if;
  if new.revision <> old.revision + 1 then
    raise exception 'Survey revision conflict';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger survey_sessions_revision before insert or update on public.survey_sessions
for each row execute function public.enforce_survey_revision();
create trigger survey_casts_revision before insert or update on public.survey_casts
for each row execute function public.enforce_survey_revision();

alter table public.survey_sessions enable row level security;
alter table public.survey_casts enable row level security;

create policy "Read own survey sessions" on public.survey_sessions
for select to authenticated using (owner_id = (select auth.uid()) and (select auth.jwt()->'app_metadata'->>'marker_username') is not null);
create policy "Create own survey sessions" on public.survey_sessions
for insert to authenticated with check (owner_id = (select auth.uid()) and revision = 1 and (select auth.jwt()->'app_metadata'->>'marker_username') is not null);
create policy "Update own survey sessions" on public.survey_sessions
for update to authenticated using (owner_id = (select auth.uid()) and (select auth.jwt()->'app_metadata'->>'marker_username') is not null)
with check (owner_id = (select auth.uid()) and (select auth.jwt()->'app_metadata'->>'marker_username') is not null);

create policy "Read own survey casts" on public.survey_casts
for select to authenticated using (owner_id = (select auth.uid()) and (select auth.jwt()->'app_metadata'->>'marker_username') is not null);
create policy "Create own survey casts" on public.survey_casts
for insert to authenticated with check (owner_id = (select auth.uid()) and revision = 1 and (select auth.jwt()->'app_metadata'->>'marker_username') is not null);
create policy "Update own survey casts" on public.survey_casts
for update to authenticated using (owner_id = (select auth.uid()) and (select auth.jwt()->'app_metadata'->>'marker_username') is not null)
with check (owner_id = (select auth.uid()) and (select auth.jwt()->'app_metadata'->>'marker_username') is not null);

grant select, insert, update on public.survey_sessions, public.survey_casts to authenticated;
revoke all on public.survey_sessions, public.survey_casts from anon;
