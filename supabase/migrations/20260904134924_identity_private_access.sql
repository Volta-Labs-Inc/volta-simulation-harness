create schema if not exists private;
create extension if not exists pgcrypto with schema extensions;

revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated, service_role;

create type public.assignment_status as enum (
  'active',
  'submitted',
  'reopened',
  'closed'
);

create type public.blind_policy_mode as enum (
  'none',
  'attempt-one'
);

create type public.staff_case_permission as enum (
  'timeline',
  'protected-case',
  'evaluate',
  'author'
);

create table public.github_identities (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null unique references auth.users(id) on delete restrict,
  auth_identity_id uuid not null unique references auth.identities(id) on delete restrict,
  github_user_id bigint not null unique check (github_user_id > 0),
  current_login text check (current_login is null or current_login ~ '^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$'),
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp()
);

comment on column public.github_identities.github_user_id is
  'Immutable numeric GitHub provider_id from auth.identities. Never populated from user metadata.';
comment on column public.github_identities.current_login is
  'Display and invitation lookup only. This mutable value is never an authorization input.';

create table public.case_versions (
  id uuid primary key default gen_random_uuid(),
  case_id text not null check (case_id ~ '^[a-z0-9]+(?:[._-][a-z0-9]+)*$'),
  case_version_digest text not null check (case_version_digest ~ '^sha256:[a-f0-9]{64}$'),
  student_bundle_digest text not null check (student_bundle_digest ~ '^sha256:[a-f0-9]{64}$'),
  protected_package_digest text not null check (protected_package_digest ~ '^sha256:[a-f0-9]{64}$'),
  created_at timestamptz not null default statement_timestamp(),
  unique (case_id, case_version_digest)
);

create table public.assignments (
  id uuid primary key default gen_random_uuid(),
  case_version_id uuid not null references public.case_versions(id) on delete restrict,
  student_identity_id uuid not null references public.github_identities(id) on delete restrict,
  status public.assignment_status not null default 'active',
  current_attempt_number integer not null default 1 check (current_attempt_number > 0),
  attempt_one_submitted_at timestamptz,
  required_blind_policy_version integer not null check (required_blind_policy_version > 0),
  state_version bigint not null default 1 check (state_version > 0),
  revoked_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  unique (id, case_version_id),
  check (attempt_one_submitted_at is null or current_attempt_number >= 1)
);

create table public.blind_policies (
  assignment_id uuid not null,
  case_version_id uuid not null references public.case_versions(id) on delete restrict,
  policy_version integer not null check (policy_version > 0),
  mode public.blind_policy_mode not null,
  blind_student_identity_id uuid references public.github_identities(id) on delete restrict,
  created_at timestamptz not null default statement_timestamp(),
  primary key (assignment_id, policy_version),
  foreign key (assignment_id, case_version_id)
    references public.assignments(id, case_version_id)
    on delete restrict
    deferrable initially deferred,
  check (
    (mode = 'none' and blind_student_identity_id is null)
    or (mode = 'attempt-one' and blind_student_identity_id is not null)
  )
);

alter table public.assignments
  add constraint assignments_required_blind_policy_fkey
  foreign key (id, required_blind_policy_version)
  references public.blind_policies(assignment_id, policy_version)
  on delete restrict
  deferrable initially deferred;

create table public.staff_case_grants (
  id uuid primary key default gen_random_uuid(),
  staff_identity_id uuid not null references public.github_identities(id) on delete restrict,
  case_version_id uuid not null references public.case_versions(id) on delete restrict,
  permission public.staff_case_permission not null,
  granted_at timestamptz not null default statement_timestamp(),
  revoked_at timestamptz,
  unique nulls not distinct (staff_identity_id, case_version_id, permission, revoked_at)
);

create table public.cli_pairing_codes (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.assignments(id) on delete restrict,
  student_identity_id uuid not null references public.github_identities(id) on delete restrict,
  blind_policy_version integer not null check (blind_policy_version > 0),
  code_digest bytea not null unique check (octet_length(code_digest) = 32),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  check (expires_at > created_at),
  check (consumed_at is null or consumed_at >= created_at)
);

create table public.cli_tokens (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.assignments(id) on delete restrict,
  student_identity_id uuid not null references public.github_identities(id) on delete restrict,
  blind_policy_version integer not null check (blind_policy_version > 0),
  token_digest bytea not null unique check (octet_length(token_digest) = 32),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  last_used_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  check (expires_at > created_at),
  check (revoked_at is null or revoked_at >= created_at),
  check (last_used_at is null or last_used_at >= created_at)
);

create table public.official_events (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.assignments(id) on delete restrict,
  attempt_number integer not null check (attempt_number > 0),
  sequence bigint not null check (sequence > 0),
  client_operation_id text not null check (length(client_operation_id) between 1 and 160),
  actor_identity_id uuid not null references public.github_identities(id) on delete restrict,
  event_type text not null check (event_type ~ '^[a-z0-9]+(?:[._-][a-z0-9]+)*$'),
  payload jsonb not null,
  created_at timestamptz not null default statement_timestamp(),
  unique (assignment_id, attempt_number, sequence),
  unique (assignment_id, client_operation_id)
);

create table public.submissions (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.assignments(id) on delete restrict,
  attempt_number integer not null check (attempt_number > 0),
  client_operation_id text not null check (length(client_operation_id) between 1 and 160),
  actor_identity_id uuid not null references public.github_identities(id) on delete restrict,
  case_version_digest text not null check (case_version_digest ~ '^sha256:[a-f0-9]{64}$'),
  event_cutoff bigint not null check (event_cutoff >= 0),
  packet jsonb not null,
  packet_receipt_text text not null check (
    octet_length(packet_receipt_text) between 2 and 60000000
  ),
  packet_digest text not null check (packet_digest ~ '^sha256:[a-f0-9]{64}$'),
  submitted_at timestamptz not null default statement_timestamp(),
  unique (assignment_id, attempt_number),
  unique (assignment_id, client_operation_id)
);

create table public.evaluations (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.submissions(id) on delete restrict,
  evaluator_identity_id uuid not null references public.github_identities(id) on delete restrict,
  prior_evaluation_id uuid references public.evaluations(id) on delete restrict,
  evaluation jsonb not null,
  evaluation_digest text not null check (evaluation_digest ~ '^sha256:[a-f0-9]{64}$'),
  released_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  unique (submission_id, evaluation_digest)
);

create index assignments_student_identity_idx
  on public.assignments(student_identity_id);
create index assignments_case_version_idx
  on public.assignments(case_version_id);
create index active_staff_case_grants_idx
  on public.staff_case_grants(staff_identity_id, case_version_id, permission)
  where revoked_at is null;
create index official_events_assignment_attempt_idx
  on public.official_events(assignment_id, attempt_number, sequence);
create index submissions_assignment_attempt_idx
  on public.submissions(assignment_id, attempt_number);
create index evaluations_submission_idx
  on public.evaluations(submission_id);
create index active_cli_tokens_digest_idx
  on public.cli_tokens(token_digest)
  where revoked_at is null;

create or replace function private.block_update_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '% records are append-only', tg_table_name using errcode = '55000';
end;
$$;

create trigger case_versions_are_append_only
before update or delete on public.case_versions
for each row execute function private.block_update_delete();

create trigger blind_policies_are_append_only
before update or delete on public.blind_policies
for each row execute function private.block_update_delete();

create trigger official_events_are_append_only
before update or delete on public.official_events
for each row execute function private.block_update_delete();

create trigger submissions_are_append_only
before update or delete on public.submissions
for each row execute function private.block_update_delete();

create trigger evaluations_are_append_only
before update or delete on public.evaluations
for each row execute function private.block_update_delete();

create or replace function private.protect_identity_binding()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.auth_user_id <> old.auth_user_id
    or new.auth_identity_id <> old.auth_identity_id
    or new.github_user_id <> old.github_user_id then
    raise exception 'GitHub identity binding is immutable' using errcode = '55000';
  end if;
  new.updated_at := statement_timestamp();
  return new;
end;
$$;

create trigger github_identity_binding_is_immutable
before update on public.github_identities
for each row execute function private.protect_identity_binding();

create or replace function private.protect_assignment_binding()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.case_version_id <> old.case_version_id
    or new.student_identity_id <> old.student_identity_id then
    raise exception 'Assignment case version and student binding are immutable' using errcode = '55000';
  end if;
  if new.attempt_one_submitted_at is distinct from old.attempt_one_submitted_at
    and old.attempt_one_submitted_at is not null then
    raise exception 'Attempt 1 submission time is immutable once recorded' using errcode = '55000';
  end if;
  new.updated_at := statement_timestamp();
  return new;
end;
$$;

create trigger assignment_binding_is_immutable
before update on public.assignments
for each row execute function private.protect_assignment_binding();

create or replace function private.require_new_active_assignment()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status <> 'active'
    or new.current_attempt_number <> 1
    or new.attempt_one_submitted_at is not null
    or new.state_version <> 1
    or new.revoked_at is not null then
    raise exception 'A new assignment must begin as active Attempt 1' using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger new_assignment_starts_active
before insert on public.assignments
for each row execute function private.require_new_active_assignment();

create or replace function private.protect_staff_grant_binding()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.staff_identity_id <> old.staff_identity_id
    or new.case_version_id <> old.case_version_id
    or new.permission <> old.permission
    or new.granted_at <> old.granted_at then
    raise exception 'Staff authorization binding is immutable' using errcode = '55000';
  end if;
  if old.revoked_at is not null and new.revoked_at is distinct from old.revoked_at then
    raise exception 'A revoked staff authorization cannot be restored or rewritten'
      using errcode = '55000';
  end if;
  return new;
end;
$$;

create trigger staff_grant_binding_is_immutable
before update on public.staff_case_grants
for each row execute function private.protect_staff_grant_binding();

create or replace function private.sync_github_identity(p_auth_user_id uuid)
returns public.github_identities
language plpgsql
security definer
set search_path = ''
as $$
declare
  source_identity auth.identities%rowtype;
  existing_identity public.github_identities%rowtype;
  result_identity public.github_identities%rowtype;
  identity_count integer;
  provider_numeric_id bigint;
  provider_login text;
begin
  select count(*)::integer
  into identity_count
  from auth.identities ai
  where ai.user_id = p_auth_user_id
    and ai.provider = 'github';

  if identity_count <> 1 then
    raise exception 'Exactly one GitHub auth identity is required' using errcode = '28000';
  end if;

  select ai.*
  into source_identity
  from auth.identities ai
  where ai.user_id = p_auth_user_id
    and ai.provider = 'github'
  order by ai.created_at, ai.id
  limit 1;

  if not found then
    raise exception 'A GitHub auth identity is required' using errcode = '28000';
  end if;

  if source_identity.provider_id !~ '^[0-9]+$' then
    raise exception 'GitHub provider identity must be numeric' using errcode = '22023';
  end if;

  provider_numeric_id := source_identity.provider_id::bigint;
  provider_login := coalesce(
    source_identity.identity_data ->> 'user_name',
    source_identity.identity_data ->> 'preferred_username'
  );

  select gi.*
  into existing_identity
  from public.github_identities gi
  where gi.auth_user_id = p_auth_user_id;

  if found and (
    existing_identity.auth_identity_id <> source_identity.id
    or existing_identity.github_user_id <> provider_numeric_id
  ) then
    raise exception 'Authenticated GitHub identity changed for an existing account' using errcode = '55000';
  end if;

  insert into public.github_identities (
    auth_user_id,
    auth_identity_id,
    github_user_id,
    current_login
  ) values (
    p_auth_user_id,
    source_identity.id,
    provider_numeric_id,
    provider_login
  )
  on conflict (auth_user_id) do update
    set current_login = excluded.current_login
  returning * into result_identity;

  return result_identity;
end;
$$;

create or replace function private.current_github_identity_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select gi.id
  from public.github_identities gi
  join auth.identities ai
    on ai.id = gi.auth_identity_id
   and ai.user_id = gi.auth_user_id
   and ai.provider = 'github'
   and ai.provider_id = gi.github_user_id::text
  where gi.auth_user_id = (select auth.uid())
  limit 1
$$;

create or replace function private.has_live_staff_permission(
  p_identity_id uuid,
  p_case_version_id uuid,
  p_permission public.staff_case_permission
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.staff_case_grants grant_record
    where grant_record.staff_identity_id = p_identity_id
      and grant_record.case_version_id = p_case_version_id
      and grant_record.permission = p_permission
      and grant_record.revoked_at is null
  )
$$;

create or replace function private.assignment_policy_is_current(p_assignment_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.assignments assignment_record
    join public.blind_policies policy_record
      on policy_record.assignment_id = assignment_record.id
     and policy_record.policy_version = assignment_record.required_blind_policy_version
     and policy_record.case_version_id = assignment_record.case_version_id
    where assignment_record.id = p_assignment_id
      and (
        (policy_record.mode = 'none' and policy_record.blind_student_identity_id is null)
        or (
          policy_record.mode = 'attempt-one'
          and policy_record.blind_student_identity_id = assignment_record.student_identity_id
        )
      )
  )
$$;

create or replace function private.is_blind_staff_assignee(
  p_identity_id uuid,
  p_assignment_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.assignments assignment_record
    join public.blind_policies policy_record
      on policy_record.assignment_id = assignment_record.id
     and policy_record.policy_version = assignment_record.required_blind_policy_version
     and policy_record.case_version_id = assignment_record.case_version_id
    where assignment_record.id = p_assignment_id
      and assignment_record.attempt_one_submitted_at is null
      and policy_record.mode = 'attempt-one'
      and policy_record.blind_student_identity_id = p_identity_id
  )
$$;

create or replace function private.can_access_assignment(
  p_assignment_id uuid,
  p_action text
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_identity_id uuid;
  assignment_record public.assignments%rowtype;
  required_permission public.staff_case_permission;
begin
  actor_identity_id := private.current_github_identity_id();
  if actor_identity_id is null then
    return false;
  end if;

  select assignment_row.*
  into assignment_record
  from public.assignments assignment_row
  where assignment_row.id = p_assignment_id
    and assignment_row.revoked_at is null;

  if not found or not private.assignment_policy_is_current(p_assignment_id) then
    return false;
  end if;

  if p_action in ('student-read', 'student-write') then
    return assignment_record.student_identity_id = actor_identity_id;
  end if;

  if private.is_blind_staff_assignee(actor_identity_id, p_assignment_id) then
    return false;
  end if;

  required_permission := case p_action
    when 'staff-read-timeline' then 'timeline'::public.staff_case_permission
    when 'staff-read-protected-case' then 'protected-case'::public.staff_case_permission
    when 'staff-evaluate' then 'evaluate'::public.staff_case_permission
    when 'staff-author-case' then 'author'::public.staff_case_permission
    else null
  end;

  if required_permission is null then
    return false;
  end if;

  return private.has_live_staff_permission(
    actor_identity_id,
    assignment_record.case_version_id,
    required_permission
  );
end;
$$;

create or replace function private.can_access_case_version(
  p_case_version_id uuid,
  p_permission public.staff_case_permission
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_identity_id uuid;
begin
  actor_identity_id := private.current_github_identity_id();
  if actor_identity_id is null then
    return false;
  end if;

  if exists (
    select 1
    from public.assignments assignment_record
    where assignment_record.case_version_id = p_case_version_id
      and assignment_record.student_identity_id = actor_identity_id
      and assignment_record.attempt_one_submitted_at is null
      and assignment_record.revoked_at is null
      and private.is_blind_staff_assignee(actor_identity_id, assignment_record.id)
  ) then
    return false;
  end if;

  return private.has_live_staff_permission(actor_identity_id, p_case_version_id, p_permission);
end;
$$;

create or replace function private.check_assignment_access(
  p_actor_auth_user_id uuid,
  p_assignment_id uuid,
  p_action text,
  p_expected_blind_policy_version integer
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_identity_id uuid;
  assignment_record public.assignments%rowtype;
  required_permission public.staff_case_permission;
begin
  if p_expected_blind_policy_version is null then
    return false;
  end if;

  select gi.id
  into actor_identity_id
  from public.github_identities gi
  join auth.identities ai
    on ai.id = gi.auth_identity_id
   and ai.user_id = gi.auth_user_id
   and ai.provider = 'github'
   and ai.provider_id = gi.github_user_id::text
  where gi.auth_user_id = p_actor_auth_user_id
  limit 1;

  if actor_identity_id is null then
    return false;
  end if;

  select assignment_row.*
  into assignment_record
  from public.assignments assignment_row
  where assignment_row.id = p_assignment_id
    and assignment_row.revoked_at is null;

  if not found
    or assignment_record.required_blind_policy_version <> p_expected_blind_policy_version
    or not private.assignment_policy_is_current(p_assignment_id) then
    return false;
  end if;

  if p_action in ('student-read', 'student-write') then
    return assignment_record.student_identity_id = actor_identity_id;
  end if;

  if private.is_blind_staff_assignee(actor_identity_id, p_assignment_id) then
    return false;
  end if;

  required_permission := case p_action
    when 'staff-read-timeline' then 'timeline'::public.staff_case_permission
    when 'staff-read-protected-case' then 'protected-case'::public.staff_case_permission
    when 'staff-evaluate' then 'evaluate'::public.staff_case_permission
    when 'staff-author-case' then 'author'::public.staff_case_permission
    else null
  end;

  if required_permission is null then
    return false;
  end if;

  return private.has_live_staff_permission(
    actor_identity_id,
    assignment_record.case_version_id,
    required_permission
  );
end;
$$;

create or replace function private.consume_pairing_code(
  p_assignment_id uuid,
  p_student_auth_user_id uuid,
  p_code_digest bytea,
  p_token_digest bytea,
  p_expected_blind_policy_version integer,
  p_token_expires_at timestamptz,
  p_now timestamptz default statement_timestamp()
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_identity_id uuid;
  consumed_code public.cli_pairing_codes%rowtype;
  token_id uuid;
begin
  if octet_length(p_code_digest) <> 32
    or octet_length(p_token_digest) <> 32
    or p_token_expires_at <= p_now
    or p_expected_blind_policy_version is null then
    return null;
  end if;

  select gi.id
  into actor_identity_id
  from public.github_identities gi
  join auth.identities ai
    on ai.id = gi.auth_identity_id
   and ai.user_id = gi.auth_user_id
   and ai.provider = 'github'
   and ai.provider_id = gi.github_user_id::text
  where gi.auth_user_id = p_student_auth_user_id
  limit 1;

  if actor_identity_id is null
    or not private.check_assignment_access(
      p_student_auth_user_id,
      p_assignment_id,
      'student-read',
      p_expected_blind_policy_version
    ) then
    return null;
  end if;

  perform 1
  from public.assignments assignment_record
  where assignment_record.id = p_assignment_id
    and assignment_record.student_identity_id = actor_identity_id
    and assignment_record.required_blind_policy_version = p_expected_blind_policy_version
    and assignment_record.revoked_at is null
  for update;

  if not found or not private.assignment_policy_is_current(p_assignment_id) then
    return null;
  end if;

  update public.cli_pairing_codes code_record
  set consumed_at = p_now
  where code_record.assignment_id = p_assignment_id
    and code_record.student_identity_id = actor_identity_id
    and code_record.blind_policy_version = p_expected_blind_policy_version
    and code_record.code_digest = p_code_digest
    and code_record.consumed_at is null
    and code_record.expires_at > p_now
  returning code_record.* into consumed_code;

  if consumed_code.id is null then
    return null;
  end if;

  insert into public.cli_tokens (
    assignment_id,
    student_identity_id,
    blind_policy_version,
    token_digest,
    expires_at,
    created_at
  ) values (
    p_assignment_id,
    actor_identity_id,
    p_expected_blind_policy_version,
    p_token_digest,
    p_token_expires_at,
    p_now
  ) returning id into token_id;

  return token_id;
end;
$$;

create or replace function private.resolve_cli_token(
  p_assignment_id uuid,
  p_token_digest bytea,
  p_expected_blind_policy_version integer,
  p_now timestamptz default statement_timestamp()
)
returns table (
  auth_user_id uuid,
  github_user_id bigint,
  blind_policy_version integer
)
language sql
volatile
security definer
set search_path = ''
as $$
  with active_token as (
    update public.cli_tokens token_record
    set last_used_at = p_now
    from public.assignments assignment_record,
         public.github_identities identity_record,
         auth.identities auth_identity
    where token_record.assignment_id = p_assignment_id
      and token_record.token_digest = p_token_digest
      and token_record.blind_policy_version = p_expected_blind_policy_version
      and token_record.expires_at > p_now
      and token_record.revoked_at is null
      and assignment_record.id = token_record.assignment_id
      and assignment_record.student_identity_id = token_record.student_identity_id
      and assignment_record.required_blind_policy_version = p_expected_blind_policy_version
      and assignment_record.revoked_at is null
      and private.assignment_policy_is_current(assignment_record.id)
      and identity_record.id = token_record.student_identity_id
      and auth_identity.id = identity_record.auth_identity_id
      and auth_identity.user_id = identity_record.auth_user_id
      and auth_identity.provider = 'github'
      and auth_identity.provider_id = identity_record.github_user_id::text
    returning
      identity_record.auth_user_id,
      identity_record.github_user_id,
      token_record.blind_policy_version
  )
  select * from active_token
$$;

create or replace function private.revoke_cli_token(
  p_assignment_id uuid,
  p_token_digest bytea,
  p_now timestamptz default statement_timestamp()
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.cli_tokens token_record
  set revoked_at = p_now
  where token_record.assignment_id = p_assignment_id
    and token_record.token_digest = p_token_digest
    and token_record.revoked_at is null;
  return found;
end;
$$;

create or replace function private.submission_packet_shape_is_valid(
  p_packet jsonb,
  p_assignment_id uuid,
  p_student_github_user_id bigint,
  p_attempt_number integer,
  p_case_version_digest text
)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  packet_attempt_number integer;
begin
  if jsonb_typeof(p_packet) <> 'object'
    or not (p_packet ?& array[
      'submissionId',
      'assignmentId',
      'studentGithubUserId',
      'attemptNumber',
      'caseVersionDigest',
      'gitCommitSha',
      'ledger',
      'evidence',
      'decision',
      'estimates',
      'missingDataPlan',
      'requirementAssessments',
      'competencyClaims',
      'successCriteria',
      'calculations',
      'economicRationale',
      'responsePlan',
      'submissionDigest'
    ]) then
    return false;
  end if;

  begin
    packet_attempt_number := (p_packet ->> 'attemptNumber')::integer;
  exception when others then
    return false;
  end;

  return
    length(btrim(p_packet ->> 'submissionId')) > 0
    and p_packet ->> 'assignmentId' = p_assignment_id::text
    and p_packet ->> 'studentGithubUserId' = p_student_github_user_id::text
    and packet_attempt_number = p_attempt_number
    and p_packet ->> 'caseVersionDigest' = p_case_version_digest
    and p_packet ->> 'gitCommitSha' ~ '^[a-f0-9]{40}$'
    and jsonb_typeof(p_packet -> 'ledger') = 'array'
    and jsonb_array_length(p_packet -> 'ledger') > 0
    and jsonb_typeof(p_packet -> 'evidence') = 'array'
    and jsonb_typeof(p_packet -> 'decision') = 'object'
    and jsonb_typeof(p_packet -> 'estimates') = 'array'
    and jsonb_array_length(p_packet -> 'estimates') > 0
    and length(btrim(p_packet ->> 'missingDataPlan')) > 0
    and jsonb_typeof(p_packet -> 'requirementAssessments') = 'array'
    and jsonb_array_length(p_packet -> 'requirementAssessments') > 0
    and jsonb_typeof(p_packet -> 'competencyClaims') = 'array'
    and jsonb_array_length(p_packet -> 'competencyClaims') = 4
    and jsonb_typeof(p_packet -> 'successCriteria') = 'array'
    and jsonb_array_length(p_packet -> 'successCriteria') > 0
    and jsonb_typeof(p_packet -> 'calculations') = 'array'
    and jsonb_array_length(p_packet -> 'calculations') > 0
    and length(btrim(p_packet ->> 'economicRationale')) > 0
    and jsonb_typeof(p_packet -> 'responsePlan') = 'object'
    and p_packet ->> 'submissionDigest' ~ '^sha256:[a-f0-9]{64}$';
exception when others then
  return false;
end;
$$;

create or replace function private.submission_packet_receipt_digest(p_packet jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  select 'sha256:' || encode(
    extensions.digest(convert_to(p_packet::text, 'UTF8'), 'sha256'),
    'hex'
  )
$$;

create or replace function private.accept_submission(
  p_actor_auth_user_id uuid,
  p_assignment_id uuid,
  p_expected_blind_policy_version integer,
  p_attempt_number integer,
  p_client_operation_id text,
  p_case_version_digest text,
  p_packet jsonb,
  p_submitted_at timestamptz default statement_timestamp()
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  assignment_record public.assignments%rowtype;
  actor_identity_id uuid;
  actor_github_user_id bigint;
  existing_submission public.submissions%rowtype;
  new_submission_id uuid;
  cutoff bigint;
  packet_receipt_text text;
  packet_receipt_digest text;
begin
  select assignment_row.*
  into assignment_record
  from public.assignments assignment_row
  where assignment_row.id = p_assignment_id
  for update;

  if not found then
    return null;
  end if;

  select gi.id, gi.github_user_id
  into actor_identity_id, actor_github_user_id
  from public.github_identities gi
  join auth.identities ai
    on ai.id = gi.auth_identity_id
   and ai.user_id = gi.auth_user_id
   and ai.provider = 'github'
   and ai.provider_id = gi.github_user_id::text
  where gi.auth_user_id = p_actor_auth_user_id
  for key share of gi, ai;

  if not found
    or assignment_record.student_identity_id <> actor_identity_id
    or assignment_record.required_blind_policy_version <> p_expected_blind_policy_version
    or assignment_record.revoked_at is not null
    or not private.assignment_policy_is_current(p_assignment_id)
    or not private.check_assignment_access(
      p_actor_auth_user_id,
      p_assignment_id,
      'student-write',
      p_expected_blind_policy_version
    ) then
    return null;
  end if;

  select submission_record.*
  into existing_submission
  from public.submissions submission_record
  where submission_record.assignment_id = p_assignment_id
    and submission_record.client_operation_id = p_client_operation_id;

  if found then
    if existing_submission.attempt_number <> p_attempt_number
      or existing_submission.case_version_digest <> p_case_version_digest
      or existing_submission.packet_digest <> private.submission_packet_receipt_digest(p_packet)
      or existing_submission.packet_receipt_text <> p_packet::text
      or existing_submission.packet <> p_packet then
      raise exception 'Client operation ID is already bound to a different submission'
        using errcode = '23505';
    end if;
    return existing_submission.id;
  end if;

  if assignment_record.status not in ('active', 'reopened')
    or assignment_record.current_attempt_number <> p_attempt_number then
    return null;
  end if;

  if not exists (
    select 1
    from public.case_versions case_version
    where case_version.id = assignment_record.case_version_id
      and case_version.case_version_digest = p_case_version_digest
  ) then
    raise exception 'Submission case digest does not match the assignment'
      using errcode = '22023';
  end if;

  if not private.submission_packet_shape_is_valid(
    p_packet,
    p_assignment_id,
    actor_github_user_id,
    p_attempt_number,
    p_case_version_digest
  ) then
    return null;
  end if;

  packet_receipt_text := p_packet::text;
  packet_receipt_digest := private.submission_packet_receipt_digest(p_packet);

  select coalesce(max(event_record.sequence), 0)
  into cutoff
  from public.official_events event_record
  where event_record.assignment_id = p_assignment_id
    and event_record.attempt_number = p_attempt_number;

  insert into public.submissions (
    assignment_id,
    attempt_number,
    client_operation_id,
    actor_identity_id,
    case_version_digest,
    event_cutoff,
    packet,
    packet_receipt_text,
    packet_digest,
    submitted_at
  ) values (
    p_assignment_id,
    p_attempt_number,
    p_client_operation_id,
    actor_identity_id,
    p_case_version_digest,
    cutoff,
    p_packet,
    packet_receipt_text,
    packet_receipt_digest,
    p_submitted_at
  ) returning id into new_submission_id;

  update public.assignments
  set status = 'submitted',
      attempt_one_submitted_at = case
        when p_attempt_number = 1 then p_submitted_at
        else attempt_one_submitted_at
      end,
      state_version = state_version + 1
  where id = p_assignment_id;

  return new_submission_id;
end;
$$;

create or replace function private.advance_blind_policy(
  p_actor_auth_user_id uuid,
  p_assignment_id uuid,
  p_expected_policy_version integer,
  p_new_policy_version integer,
  p_new_mode public.blind_policy_mode,
  p_new_blind_student_github_user_id bigint default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  assignment_record public.assignments%rowtype;
  current_policy public.blind_policies%rowtype;
  actor_identity_id uuid;
  new_blind_identity_id uuid;
begin
  select assignment_row.*
  into assignment_record
  from public.assignments assignment_row
  where assignment_row.id = p_assignment_id
  for update;

  if not found
    or assignment_record.required_blind_policy_version <> p_expected_policy_version
    or p_new_policy_version <> p_expected_policy_version + 1
    or assignment_record.revoked_at is not null then
    return false;
  end if;

  select gi.id
  into actor_identity_id
  from public.github_identities gi
  join auth.identities ai
    on ai.id = gi.auth_identity_id
   and ai.user_id = gi.auth_user_id
   and ai.provider = 'github'
   and ai.provider_id = gi.github_user_id::text
  where gi.auth_user_id = p_actor_auth_user_id
  for key share of gi, ai;

  if actor_identity_id is null or not private.check_assignment_access(
    p_actor_auth_user_id,
    p_assignment_id,
    'staff-author-case',
    p_expected_policy_version
  ) then
    return false;
  end if;

  select policy_row.*
  into current_policy
  from public.blind_policies policy_row
  where policy_row.assignment_id = p_assignment_id
    and policy_row.policy_version = p_expected_policy_version;

  if not found then
    return false;
  end if;

  if p_new_mode = 'attempt-one' then
    select identity_record.id
    into new_blind_identity_id
    from public.github_identities identity_record
    where identity_record.github_user_id = p_new_blind_student_github_user_id;

    if not found or new_blind_identity_id <> assignment_record.student_identity_id then
      return false;
    end if;
  elsif p_new_blind_student_github_user_id is not null then
    return false;
  end if;

  if assignment_record.attempt_one_submitted_at is null
    and current_policy.mode = 'attempt-one'
    and (
      p_new_mode <> 'attempt-one'
      or new_blind_identity_id is distinct from current_policy.blind_student_identity_id
    ) then
    return false;
  end if;

  insert into public.blind_policies (
    assignment_id,
    case_version_id,
    policy_version,
    mode,
    blind_student_identity_id
  ) values (
    assignment_record.id,
    assignment_record.case_version_id,
    p_new_policy_version,
    p_new_mode,
    new_blind_identity_id
  );

  update public.assignments
  set required_blind_policy_version = p_new_policy_version,
      state_version = state_version + 1
  where id = assignment_record.id;

  return true;
end;
$$;

alter table public.github_identities enable row level security;
alter table public.github_identities force row level security;
alter table public.case_versions enable row level security;
alter table public.case_versions force row level security;
alter table public.assignments enable row level security;
alter table public.assignments force row level security;
alter table public.blind_policies enable row level security;
alter table public.blind_policies force row level security;
alter table public.staff_case_grants enable row level security;
alter table public.staff_case_grants force row level security;
alter table public.cli_pairing_codes enable row level security;
alter table public.cli_pairing_codes force row level security;
alter table public.cli_tokens enable row level security;
alter table public.cli_tokens force row level security;
alter table public.official_events enable row level security;
alter table public.official_events force row level security;
alter table public.submissions enable row level security;
alter table public.submissions force row level security;
alter table public.evaluations enable row level security;
alter table public.evaluations force row level security;

create policy github_identity_owner_read
on public.github_identities
for select
to authenticated
using (
  auth_user_id = (select auth.uid())
  and id = private.current_github_identity_id()
);

create policy case_version_authorized_staff_read
on public.case_versions
for select
to authenticated
using (private.can_access_case_version(id, 'protected-case'));

create policy assignment_student_or_staff_read
on public.assignments
for select
to authenticated
using (
  private.can_access_assignment(id, 'student-read')
  or private.can_access_assignment(id, 'staff-read-timeline')
);

create policy official_event_student_or_staff_read
on public.official_events
for select
to authenticated
using (
  private.can_access_assignment(assignment_id, 'student-read')
  or private.can_access_assignment(assignment_id, 'staff-read-timeline')
);

create policy submission_student_or_staff_read
on public.submissions
for select
to authenticated
using (
  private.can_access_assignment(assignment_id, 'student-read')
  or private.can_access_assignment(assignment_id, 'staff-read-timeline')
);

create policy evaluation_staff_read
on public.evaluations
for select
to authenticated
using (
  exists (
    select 1
    from public.submissions submission_record
    where submission_record.id = submission_id
      and private.can_access_assignment(submission_record.assignment_id, 'staff-read-timeline')
  )
);

create policy released_evaluation_student_read
on public.evaluations
for select
to authenticated
using (
  released_at is not null
  and exists (
    select 1
    from public.submissions submission_record
    where submission_record.id = submission_id
      and private.can_access_assignment(submission_record.assignment_id, 'student-read')
  )
);

revoke all on all tables in schema public from anon, authenticated, service_role;
revoke all on all sequences in schema public from anon, authenticated, service_role;

grant select on public.github_identities to authenticated;
grant select on public.case_versions to authenticated;
grant select on public.assignments to authenticated;
grant select on public.official_events to authenticated;
grant select on public.submissions to authenticated;
grant select on public.evaluations to authenticated;

grant select on all tables in schema public to service_role;
grant insert on public.case_versions to service_role;
grant insert (id, case_version_id, student_identity_id, required_blind_policy_version)
  on public.assignments to service_role;
grant update (status, current_attempt_number, state_version, revoked_at)
  on public.assignments to service_role;
grant insert on public.staff_case_grants to service_role;
grant update (revoked_at) on public.staff_case_grants to service_role;
grant insert on public.cli_pairing_codes to service_role;
grant insert on public.official_events to service_role;
grant insert on public.evaluations to service_role;

revoke all on function private.block_update_delete() from public, anon, authenticated, service_role;
revoke all on function private.protect_identity_binding() from public, anon, authenticated, service_role;
revoke all on function private.protect_assignment_binding() from public, anon, authenticated, service_role;
revoke all on function private.require_new_active_assignment() from public, anon, authenticated, service_role;
revoke all on function private.protect_staff_grant_binding() from public, anon, authenticated, service_role;
revoke all on function private.sync_github_identity(uuid) from public, anon, authenticated;
revoke all on function private.current_github_identity_id() from public, anon;
revoke all on function private.has_live_staff_permission(uuid, uuid, public.staff_case_permission) from public, anon;
revoke all on function private.assignment_policy_is_current(uuid) from public, anon;
revoke all on function private.is_blind_staff_assignee(uuid, uuid) from public, anon;
revoke all on function private.can_access_assignment(uuid, text) from public, anon;
revoke all on function private.can_access_case_version(uuid, public.staff_case_permission) from public, anon;
revoke all on function private.check_assignment_access(uuid, uuid, text, integer) from public, anon, authenticated;
revoke all on function private.consume_pairing_code(uuid, uuid, bytea, bytea, integer, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function private.resolve_cli_token(uuid, bytea, integer, timestamptz) from public, anon, authenticated;
revoke all on function private.revoke_cli_token(uuid, bytea, timestamptz) from public, anon, authenticated;
revoke all on function private.submission_packet_shape_is_valid(jsonb, uuid, bigint, integer, text) from public, anon, authenticated, service_role;
revoke all on function private.submission_packet_receipt_digest(jsonb) from public, anon, authenticated;
revoke all on function private.accept_submission(uuid, uuid, integer, integer, text, text, jsonb, timestamptz) from public, anon, authenticated;
revoke all on function private.advance_blind_policy(uuid, uuid, integer, integer, public.blind_policy_mode, bigint) from public, anon, authenticated;

grant execute on function private.sync_github_identity(uuid) to service_role;
grant execute on function private.current_github_identity_id() to authenticated, service_role;
grant execute on function private.has_live_staff_permission(uuid, uuid, public.staff_case_permission) to authenticated, service_role;
grant execute on function private.assignment_policy_is_current(uuid) to authenticated, service_role;
grant execute on function private.is_blind_staff_assignee(uuid, uuid) to authenticated, service_role;
grant execute on function private.can_access_assignment(uuid, text) to authenticated, service_role;
grant execute on function private.can_access_case_version(uuid, public.staff_case_permission) to authenticated, service_role;
grant execute on function private.check_assignment_access(uuid, uuid, text, integer) to service_role;
grant execute on function private.consume_pairing_code(uuid, uuid, bytea, bytea, integer, timestamptz, timestamptz) to service_role;
grant execute on function private.resolve_cli_token(uuid, bytea, integer, timestamptz) to service_role;
grant execute on function private.revoke_cli_token(uuid, bytea, timestamptz) to service_role;
grant execute on function private.submission_packet_receipt_digest(jsonb) to service_role;
grant execute on function private.accept_submission(uuid, uuid, integer, integer, text, text, jsonb, timestamptz) to service_role;
grant execute on function private.advance_blind_policy(uuid, uuid, integer, integer, public.blind_policy_mode, bigint) to service_role;

alter default privileges in schema public revoke all on tables from anon, authenticated, service_role;
alter default privileges in schema public revoke all on sequences from anon, authenticated, service_role;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated, service_role;
alter default privileges in schema private revoke all on tables from public, anon, authenticated, service_role;
alter default privileges in schema private revoke all on sequences from public, anon, authenticated, service_role;
alter default privileges in schema private revoke execute on functions from public, anon, authenticated, service_role;
