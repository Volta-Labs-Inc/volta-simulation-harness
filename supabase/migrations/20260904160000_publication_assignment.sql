create type public.assignment_provisioning_state as enum (
  'provisioning',
  'repository_created',
  'invitation_pending',
  'ready'
);

create type public.repository_invitation_state as enum (
  'none',
  'pending',
  'accepted'
);

create table private.case_author_grants (
  id uuid primary key default gen_random_uuid(),
  staff_identity_id uuid not null references public.github_identities(id) on delete restrict,
  case_id text not null check (case_id ~ '^[a-z0-9]+(?:[._-][a-z0-9]+)*$'),
  granted_at timestamptz not null default statement_timestamp(),
  revoked_at timestamptz,
  unique nulls not distinct (staff_identity_id, case_id, revoked_at),
  check (revoked_at is null or revoked_at >= granted_at)
);

create table private.provisioning_configuration (
  singleton boolean primary key default true check (singleton),
  repository_owner text not null check (
    repository_owner ~ '^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$'
  ),
  template_commit text not null check (template_commit ~ '^[a-f0-9]{40}$'),
  configured_at timestamptz not null default statement_timestamp(),
  configured_by_identity_id uuid not null references public.github_identities(id) on delete restrict
);

create table private.case_validations (
  id uuid primary key default gen_random_uuid(),
  client_operation_id text not null unique check (length(client_operation_id) between 1 and 160),
  operation_digest text not null check (operation_digest ~ '^sha256:[a-f0-9]{64}$'),
  case_id text not null check (case_id ~ '^[a-z0-9]+(?:[._-][a-z0-9]+)*$'),
  version_label text not null check (length(version_label) between 1 and 80),
  canonical_student_text text not null check (
    octet_length(canonical_student_text) between 2 and 60000000
  ),
  student_bundle_digest text not null check (student_bundle_digest ~ '^sha256:[a-f0-9]{64}$'),
  student_materialization jsonb not null,
  student_manifest_digest text not null check (student_manifest_digest ~ '^sha256:[a-f0-9]{64}$'),
  canonical_protected_text text not null check (
    octet_length(canonical_protected_text) between 2 and 60000000
  ),
  protected_package_digest text not null check (protected_package_digest ~ '^sha256:[a-f0-9]{64}$'),
  draft_preview_digest text not null check (draft_preview_digest ~ '^sha256:[a-f0-9]{64}$'),
  methodology_snapshot jsonb not null,
  requirements_snapshot jsonb not null,
  calibration_bindings jsonb not null,
  validation_succeeded boolean not null,
  validation_errors jsonb not null,
  validated_by_identity_id uuid not null references public.github_identities(id) on delete restrict,
  validated_at timestamptz not null default statement_timestamp(),
  superseded_at timestamptz,
  consumed_at timestamptz,
  published_case_version_id uuid unique references public.case_versions(id) on delete restrict,
  check (jsonb_typeof(methodology_snapshot) = 'object'),
  check (jsonb_typeof(requirements_snapshot) = 'object'),
  check (jsonb_typeof(student_materialization) = 'object'),
  check (jsonb_typeof(validation_errors) = 'array'),
  check (superseded_at is null or superseded_at >= validated_at),
  check (consumed_at is null or consumed_at >= validated_at)
);

create table private.case_validation_calibration_artifacts (
  validation_id uuid not null references private.case_validations(id) on delete restrict,
  calibration_class text not null check (
    calibration_class in ('effective', 'partially-effective', 'not-yet-effective')
  ),
  canonical_artifact_text text not null check (
    octet_length(canonical_artifact_text) between 2 and 10000000
  ),
  artifact_digest text not null check (artifact_digest ~ '^sha256:[a-f0-9]{64}$'),
  primary key (validation_id, calibration_class),
  unique (validation_id, artifact_digest)
);

create unique index one_current_case_validation
  on private.case_validations(case_id, version_label)
  where validation_succeeded and superseded_at is null and consumed_at is null;

create table private.case_version_publications (
  case_version_id uuid primary key references public.case_versions(id) on delete restrict,
  validation_id uuid not null unique references private.case_validations(id) on delete restrict,
  approval_operation_id text not null unique check (length(approval_operation_id) between 1 and 160),
  approval_request_digest text not null check (approval_request_digest ~ '^sha256:[a-f0-9]{64}$'),
  case_id text not null check (case_id ~ '^[a-z0-9]+(?:[._-][a-z0-9]+)*$'),
  version_label text not null check (length(version_label) between 1 and 80),
  canonical_student_text text not null,
  student_bundle_digest text not null check (student_bundle_digest ~ '^sha256:[a-f0-9]{64}$'),
  student_materialization jsonb not null,
  student_manifest_digest text not null check (student_manifest_digest ~ '^sha256:[a-f0-9]{64}$'),
  canonical_protected_text text not null,
  protected_package_digest text not null check (protected_package_digest ~ '^sha256:[a-f0-9]{64}$'),
  case_version_digest text not null unique check (case_version_digest ~ '^sha256:[a-f0-9]{64}$'),
  canonical_approved_source_text text not null,
  methodology_snapshot jsonb not null,
  requirements_snapshot jsonb not null,
  approver_identity_id uuid not null references public.github_identities(id) on delete restrict,
  approved_by text not null check (length(approved_by) between 1 and 200),
  approved_at timestamptz not null default statement_timestamp(),
  unique (case_id, version_label)
);

create table private.case_calibration_bindings (
  case_version_id uuid not null references private.case_version_publications(case_version_id) on delete restrict,
  calibration_class text not null check (
    calibration_class in ('effective', 'partially-effective', 'not-yet-effective')
  ),
  artifact_digest text not null check (artifact_digest ~ '^sha256:[a-f0-9]{64}$'),
  primary key (case_version_id, calibration_class),
  unique (case_version_id, artifact_digest)
);

create table private.assignment_provisioning (
  assignment_id uuid primary key references public.assignments(id) on delete restrict,
  case_version_id uuid not null references private.case_version_publications(case_version_id) on delete restrict,
  student_identity_id uuid not null references public.github_identities(id) on delete restrict,
  repository_owner text not null check (
    repository_owner ~ '^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$'
  ),
  repository_name text not null check (repository_name ~ '^[A-Za-z0-9._-]{1,100}$'),
  template_commit text not null check (template_commit ~ '^[a-f0-9]{40}$'),
  materialized_commit text check (
    materialized_commit is null or materialized_commit ~ '^[a-f0-9]{40}$'
  ),
  student_bundle_digest text not null check (student_bundle_digest ~ '^sha256:[a-f0-9]{64}$'),
  student_materialization jsonb not null,
  student_manifest_digest text not null check (student_manifest_digest ~ '^sha256:[a-f0-9]{64}$'),
  request_digest text not null check (request_digest ~ '^sha256:[a-f0-9]{64}$'),
  state public.assignment_provisioning_state not null default 'provisioning',
  provider_repository_id bigint unique check (provider_repository_id is null or provider_repository_id > 0),
  readback_private boolean,
  readback_owner text,
  readback_repository_name text,
  readback_template_commit text,
  readback_materialized_commit text,
  readback_bundle_digest text,
  readback_manifest_digest text,
  readback_materialized_files jsonb,
  collaborator_github_user_id bigint,
  assignee_current_login text,
  collaborator_permission text,
  invitation_id text,
  invitation_state public.repository_invitation_state not null default 'none',
  invitation_scan_receipt_id uuid,
  readiness_scan_receipt_id uuid,
  failure_code text check (failure_code is null or failure_code ~ '^[a-z0-9]+(?:[._-][a-z0-9]+)*$'),
  failure_at timestamptz,
  ready_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  unique (case_version_id, student_identity_id),
  check ((failure_code is null) = (failure_at is null)),
  check ((state = 'ready') = (ready_at is not null))
);

create unique index assignment_repository_identity_unique
  on private.assignment_provisioning(lower(repository_owner), lower(repository_name));

create table private.assignment_reservation_operations (
  client_operation_id text primary key check (length(client_operation_id) between 1 and 160),
  request_digest text not null check (request_digest ~ '^sha256:[a-f0-9]{64}$'),
  assignment_id uuid not null references private.assignment_provisioning(assignment_id) on delete restrict,
  created_at timestamptz not null default statement_timestamp()
);

create table private.provisioning_attempts (
  id bigint generated always as identity primary key,
  assignment_id uuid not null references private.assignment_provisioning(assignment_id) on delete restrict,
  attempted_state public.assignment_provisioning_state not null,
  outcome text not null check (outcome in ('succeeded', 'pending', 'failed')),
  failure_code text check (failure_code is null or failure_code ~ '^[a-z0-9]+(?:[._-][a-z0-9]+)*$'),
  attempted_by_identity_id uuid not null references public.github_identities(id) on delete restrict,
  created_at timestamptz not null default statement_timestamp(),
  check ((outcome = 'failed') = (failure_code is not null))
);

create table private.assignment_canary_scan_receipts (
  id uuid primary key default gen_random_uuid(),
  client_operation_id text not null unique check (length(client_operation_id) between 1 and 160),
  operation_digest text not null check (operation_digest ~ '^sha256:[a-f0-9]{64}$'),
  assignment_id uuid not null references private.assignment_provisioning(assignment_id) on delete restrict,
  provider_repository_id bigint not null check (provider_repository_id > 0),
  repository_owner text not null,
  repository_name text not null,
  scan_stage text not null check (scan_stage in ('pre_invitation', 'pre_ready')),
  template_commit text not null check (template_commit ~ '^[a-f0-9]{40}$'),
  materialized_commit text not null check (materialized_commit ~ '^[a-f0-9]{40}$'),
  student_bundle_digest text not null check (student_bundle_digest ~ '^sha256:[a-f0-9]{64}$'),
  student_manifest_digest text not null check (student_manifest_digest ~ '^sha256:[a-f0-9]{64}$'),
  materialized_files_digest text not null check (materialized_files_digest ~ '^sha256:[a-f0-9]{64}$'),
  repository_state_digest text not null check (repository_state_digest ~ '^sha256:[a-f0-9]{64}$'),
  canary_set_digest text not null check (canary_set_digest ~ '^sha256:[a-f0-9]{64}$'),
  scanner_version text not null check (scanner_version ~ '^[a-z0-9]+(?:[._-][a-z0-9]+)*$'),
  scanned_at timestamptz not null,
  recorded_by_identity_id uuid not null references public.github_identities(id) on delete restrict,
  recorded_at timestamptz not null default statement_timestamp()
);

alter table private.assignment_provisioning
  add constraint assignment_invitation_scan_receipt_fkey
  foreign key (invitation_scan_receipt_id)
  references private.assignment_canary_scan_receipts(id)
  on delete restrict,
  add constraint assignment_readiness_scan_receipt_fkey
  foreign key (readiness_scan_receipt_id)
  references private.assignment_canary_scan_receipts(id)
  on delete restrict;

create table private.provisioning_transition_operations (
  client_operation_id text primary key check (length(client_operation_id) between 1 and 160),
  request_digest text not null check (request_digest ~ '^sha256:[a-f0-9]{64}$'),
  assignment_id uuid not null references private.assignment_provisioning(assignment_id) on delete restrict,
  resulting_state public.assignment_provisioning_state not null,
  provisioning_attempt_id bigint not null unique references private.provisioning_attempts(id) on delete restrict,
  created_at timestamptz not null default statement_timestamp()
);

create or replace function private.sha256_text(p_value text)
returns text
language sql
immutable
strict
set search_path = ''
as $$
  select 'sha256:' || encode(extensions.digest(convert_to(p_value, 'UTF8'), 'sha256'), 'hex')
$$;

create or replace function private.canonical_jsonb_text(p_value jsonb)
returns text
language plpgsql
stable
strict
set search_path = ''
as $$
declare
  result text;
begin
  case jsonb_typeof(p_value)
    when 'object' then
      select '{' || coalesce(
        string_agg(to_jsonb(entry.key)::text || ':' || private.canonical_jsonb_text(entry.value), ',' order by entry.key collate "C"),
        ''
      ) || '}'
      into result
      from jsonb_each(p_value) entry;
    when 'array' then
      select '[' || coalesce(
        string_agg(private.canonical_jsonb_text(entry.value), ',' order by entry.ordinality),
        ''
      ) || ']'
      into result
      from jsonb_array_elements(p_value) with ordinality entry(value, ordinality);
    else
      result := p_value::text;
  end case;
  return result;
end;
$$;

create or replace function private.student_materialization_is_valid(
  p_materialization jsonb,
  p_expected_manifest_digest text
)
returns boolean
language plpgsql
stable
set search_path = ''
as $$
declare
  item jsonb;
  paths text[] := array[]::text[];
  descriptor_array jsonb;
  path_value text;
  total_bytes bigint := 0;
begin
  if jsonb_typeof(p_materialization) <> 'object'
    or (p_materialization - array['manifestDigest', 'files']) <> '{}'::jsonb
    or jsonb_typeof(p_materialization -> 'manifestDigest') <> 'string'
    or jsonb_typeof(p_materialization -> 'files') <> 'array'
    or jsonb_array_length(p_materialization -> 'files') = 0
    or jsonb_array_length(p_materialization -> 'files') > 200
    or p_materialization ->> 'manifestDigest' <> p_expected_manifest_digest then
    return false;
  end if;

  for item in select value from jsonb_array_elements(p_materialization -> 'files') loop
    if jsonb_typeof(item) <> 'object'
      or (item - array['path', 'mediaType', 'byteLength', 'digest', 'content']) <> '{}'::jsonb
      or jsonb_typeof(item -> 'path') <> 'string'
      or jsonb_typeof(item -> 'mediaType') <> 'string'
      or jsonb_typeof(item -> 'byteLength') <> 'number'
      or jsonb_typeof(item -> 'digest') <> 'string'
      or jsonb_typeof(item -> 'content') <> 'string' then
      return false;
    end if;
    path_value := item ->> 'path';
    if path_value = ''
      or path_value !~ '^[A-Za-z0-9][A-Za-z0-9._-]*(/[A-Za-z0-9][A-Za-z0-9._-]*)*$'
      or left(path_value, 1) = '/'
      or position(E'\\' in path_value) > 0
      or position(chr(8232) in path_value) > 0
      or position(chr(8233) in path_value) > 0
      or path_value ~ '(^|/)(\.|\.\.|)(/|$)'
      or lower(split_part(path_value, '/', 1)) in ('.private', 'private', 'protected')
      or path_value in (select unnest(paths))
      or (cardinality(paths) > 0 and paths[cardinality(paths)] collate "C" >= path_value collate "C")
      or item ->> 'mediaType' not in (
        'text/plain',
        'text/markdown',
        'text/csv',
        'application/json',
        'application/yaml'
      )
      or (item ->> 'byteLength')::bigint > 5000000
      or (item ->> 'byteLength')::bigint <> octet_length(item ->> 'content')
      or item ->> 'digest' <> private.sha256_text(item ->> 'content') then
      return false;
    end if;
    total_bytes := total_bytes + (item ->> 'byteLength')::bigint;
    if total_bytes > 10000000 then
      return false;
    end if;
    paths := array_append(paths, path_value);
  end loop;

  select jsonb_agg(
    jsonb_build_object(
      'byteLength', (entry.value ->> 'byteLength')::bigint,
      'digest', entry.value ->> 'digest',
      'path', entry.value ->> 'path'
    ) order by entry.ordinality
  )
  into descriptor_array
  from jsonb_array_elements(p_materialization -> 'files') with ordinality entry(value, ordinality);

  return p_expected_manifest_digest = private.sha256_text(
    private.canonical_jsonb_text(descriptor_array)
  );
exception when others then
  return false;
end;
$$;

create or replace function private.calibration_artifacts_are_valid(
  p_artifacts jsonb,
  p_protected_package jsonb
)
returns boolean
language plpgsql
stable
set search_path = ''
as $$
declare
  item jsonb;
  classes text[] := array[]::text[];
  digests text[] := array[]::text[];
  artifact_class text;
  artifact_digest text;
  anchors jsonb;
begin
  if jsonb_typeof(p_artifacts) <> 'array' or jsonb_array_length(p_artifacts) <> 3 then
    return false;
  end if;
  anchors := p_protected_package -> 'calibrationAnchors';
  if jsonb_typeof(anchors) <> 'array' or jsonb_array_length(anchors) <> 3 then
    return false;
  end if;

  for item in select value from jsonb_array_elements(p_artifacts) loop
    if jsonb_typeof(item) <> 'object'
      or (item - array['class', 'artifactDigest', 'canonicalArtifactText']) <> '{}'::jsonb
      or jsonb_typeof(item -> 'class') <> 'string'
      or jsonb_typeof(item -> 'artifactDigest') <> 'string'
      or jsonb_typeof(item -> 'canonicalArtifactText') <> 'string' then
      return false;
    end if;
    artifact_class := item ->> 'class';
    artifact_digest := item ->> 'artifactDigest';
    if artifact_class not in ('effective', 'partially-effective', 'not-yet-effective')
      or artifact_class = any(classes)
      or artifact_digest = any(digests)
      or artifact_digest = 'sha256:' || repeat('0', 64)
      or artifact_digest <> private.sha256_text(item ->> 'canonicalArtifactText') then
      return false;
    end if;
    perform (item ->> 'canonicalArtifactText')::jsonb;
    if item ->> 'canonicalArtifactText' <> private.canonical_jsonb_text(
      (item ->> 'canonicalArtifactText')::jsonb
    ) then
      return false;
    end if;
    if not exists (
      select 1 from jsonb_array_elements(anchors) anchor
      where anchor ->> 'class' = artifact_class
        and anchor ->> 'artifactDigest' = artifact_digest
    ) then
      return false;
    end if;
    classes := array_append(classes, artifact_class);
    digests := array_append(digests, artifact_digest);
  end loop;
  return true;
exception when others then
  return false;
end;
$$;

create or replace function private.github_identity_for_auth_user(p_auth_user_id uuid)
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
  where gi.auth_user_id = p_auth_user_id
  limit 1
$$;

create or replace function private.actor_may_author_case(
  p_identity_id uuid,
  p_case_id text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from private.case_author_grants grant_record
    where grant_record.staff_identity_id = p_identity_id
      and grant_record.case_id = p_case_id
      and grant_record.revoked_at is null
  )
$$;

create or replace function private.actor_is_blind_for_case(
  p_identity_id uuid,
  p_case_id text
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
    join public.case_versions case_version
      on case_version.id = assignment_record.case_version_id
    join public.blind_policies policy_record
      on policy_record.assignment_id = assignment_record.id
     and policy_record.case_version_id = assignment_record.case_version_id
     and policy_record.policy_version = assignment_record.required_blind_policy_version
    where case_version.case_id = p_case_id
      and assignment_record.student_identity_id = p_identity_id
      and assignment_record.attempt_one_submitted_at is null
      and assignment_record.revoked_at is null
      and policy_record.mode = 'attempt-one'
      and policy_record.blind_student_identity_id = p_identity_id
  )
$$;

create or replace function private.record_case_validation(
  p_actor_auth_user_id uuid,
  p_client_operation_id text,
  p_case_id text,
  p_version_label text,
  p_canonical_student_text text,
  p_student_bundle_digest text,
  p_student_materialization jsonb,
  p_student_manifest_digest text,
  p_canonical_protected_text text,
  p_protected_package_digest text,
  p_draft_preview_digest text,
  p_methodology_snapshot jsonb,
  p_requirements_snapshot jsonb,
  p_calibration_artifacts jsonb,
  p_validation_succeeded boolean,
  p_validation_errors jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_identity_id uuid;
  calculated_operation_digest text;
  existing_validation private.case_validations%rowtype;
  validation_id uuid;
  visible_package jsonb;
  protected_package jsonb;
  calculated_draft_preview_digest text;
  derived_bindings jsonb;
begin
  actor_identity_id := private.github_identity_for_auth_user(p_actor_auth_user_id);
  if actor_identity_id is null
    or not private.actor_may_author_case(actor_identity_id, p_case_id)
    or private.actor_is_blind_for_case(actor_identity_id, p_case_id) then
    raise exception 'Case validation requires authorized non-blind staff' using errcode = '42501';
  end if;

  begin
    visible_package := p_canonical_student_text::jsonb;
    protected_package := p_canonical_protected_text::jsonb;
  exception when others then
    raise exception 'Canonical case packages must be valid JSON' using errcode = '22023';
  end;

  if p_client_operation_id is null or length(p_client_operation_id) not between 1 and 160
    or p_case_id !~ '^[a-z0-9]+(?:[._-][a-z0-9]+)*$'
    or p_version_label is null or length(p_version_label) not between 1 and 80
    or jsonb_typeof(visible_package) <> 'object'
    or p_canonical_student_text <> private.canonical_jsonb_text(visible_package)
    or p_canonical_protected_text <> private.canonical_jsonb_text(protected_package)
    or visible_package ->> 'caseId' <> p_case_id
    or visible_package ->> 'versionLabel' <> p_version_label
    or p_student_bundle_digest <> private.sha256_text(p_canonical_student_text)
    or not private.student_materialization_is_valid(
      p_student_materialization,
      p_student_manifest_digest
    )
    or p_protected_package_digest <> private.sha256_text(p_canonical_protected_text)
    or p_draft_preview_digest !~ '^sha256:[a-f0-9]{64}$'
    or jsonb_typeof(p_methodology_snapshot) <> 'object'
    or jsonb_typeof(p_requirements_snapshot) <> 'object'
    or jsonb_typeof(p_validation_errors) <> 'array'
    or not private.calibration_artifacts_are_valid(
      p_calibration_artifacts,
      protected_package
    ) then
    raise exception 'Validation material or digest is invalid' using errcode = '22023';
  end if;

  calculated_draft_preview_digest := private.sha256_text(
    private.canonical_jsonb_text(
      jsonb_build_object(
        'approvedAt', null,
        'approvedBy', null,
        'caseId', p_case_id,
        'methodologySnapshot', p_methodology_snapshot,
        'protectedPackageDigest', p_protected_package_digest,
        'requirementsSnapshot', p_requirements_snapshot,
        'status', 'draft',
        'versionLabel', p_version_label,
        'visibleBundleDigest', p_student_bundle_digest
      )
    )
  );
  if p_draft_preview_digest <> calculated_draft_preview_digest then
    raise exception 'Draft preview digest does not match the exact validated material'
      using errcode = '55000';
  end if;

  if p_validation_succeeded and jsonb_array_length(p_validation_errors) <> 0 then
    raise exception 'Successful validation requires no errors'
      using errcode = '22023';
  end if;
  if not p_validation_succeeded and jsonb_array_length(p_validation_errors) = 0 then
    raise exception 'Failed validation requires at least one recorded error' using errcode = '22023';
  end if;

  select jsonb_agg(
    jsonb_build_object(
      'artifactDigest', item ->> 'artifactDigest',
      'class', item ->> 'class'
    ) order by item ->> 'class'
  ) into derived_bindings
  from jsonb_array_elements(p_calibration_artifacts) item;

  calculated_operation_digest := private.sha256_text(
    private.canonical_jsonb_text(jsonb_build_object(
      'calibrationArtifactsDigest', private.sha256_text(
        private.canonical_jsonb_text(p_calibration_artifacts)
      ),
      'draftPreviewDigest', p_draft_preview_digest,
      'caseId', p_case_id,
      'errors', p_validation_errors,
      'manifestDigest', p_student_manifest_digest,
      'methodology', p_methodology_snapshot,
      'protectedDigest', p_protected_package_digest,
      'requirements', p_requirements_snapshot,
      'studentDigest', p_student_bundle_digest,
      'succeeded', p_validation_succeeded,
      'versionLabel', p_version_label
    ))
  );

  perform pg_advisory_xact_lock(
    hashtextextended('case-validation-operation:' || p_client_operation_id, 0)
  );

  select validation_record.*
  into existing_validation
  from private.case_validations validation_record
  where validation_record.client_operation_id = p_client_operation_id
  for update;
  if found then
    if existing_validation.operation_digest <> calculated_operation_digest then
      raise exception 'Validation operation payload conflict' using errcode = '40001';
    end if;
    return existing_validation.id;
  end if;

  if p_validation_succeeded then
    perform pg_advisory_xact_lock(
      hashtextextended('case-validation:' || p_case_id || ':' || p_version_label, 0)
    );
    update private.case_validations validation_record
    set superseded_at = statement_timestamp()
    where validation_record.case_id = p_case_id
      and validation_record.version_label = p_version_label
      and validation_record.validation_succeeded
      and validation_record.superseded_at is null
      and validation_record.consumed_at is null;
  end if;

  insert into private.case_validations (
    client_operation_id,
    operation_digest,
    case_id,
    version_label,
    canonical_student_text,
    student_bundle_digest,
    student_materialization,
    student_manifest_digest,
    canonical_protected_text,
    protected_package_digest,
    draft_preview_digest,
    methodology_snapshot,
    requirements_snapshot,
    calibration_bindings,
    validation_succeeded,
    validation_errors,
    validated_by_identity_id
  ) values (
    p_client_operation_id,
    calculated_operation_digest,
    p_case_id,
    p_version_label,
    p_canonical_student_text,
    p_student_bundle_digest,
    p_student_materialization,
    p_student_manifest_digest,
    p_canonical_protected_text,
    p_protected_package_digest,
    p_draft_preview_digest,
    p_methodology_snapshot,
    p_requirements_snapshot,
    derived_bindings,
    p_validation_succeeded,
    p_validation_errors,
    actor_identity_id
  ) returning id into validation_id;

  insert into private.case_validation_calibration_artifacts (
    validation_id,
    calibration_class,
    canonical_artifact_text,
    artifact_digest
  )
  select
    validation_id,
    item ->> 'class',
    item ->> 'canonicalArtifactText',
    item ->> 'artifactDigest'
  from jsonb_array_elements(p_calibration_artifacts) item;

  return validation_id;
end;
$$;

create or replace function private.approve_case_version(
  p_actor_auth_user_id uuid,
  p_validation_id uuid,
  p_approval_operation_id text,
  p_expected_student_bundle_digest text,
  p_expected_student_manifest_digest text,
  p_expected_protected_package_digest text,
  p_expected_draft_preview_digest text
)
returns table (
  case_version_id uuid,
  case_version_digest text,
  approved_at timestamptz,
  approved_by text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_identity_id uuid;
  actor_github_user_id bigint;
  validation_record private.case_validations%rowtype;
  existing_publication private.case_version_publications%rowtype;
  new_case_version_id uuid;
  approval_request_digest text;
  approval_time timestamptz;
  approval_actor text;
  final_case_version_digest text;
  approved_source_text text;
  stored_calibration_artifacts jsonb;
begin
  if p_approval_operation_id is null or length(p_approval_operation_id) not between 1 and 160 then
    raise exception 'Approval operation id is invalid' using errcode = '22023';
  end if;
  actor_identity_id := private.github_identity_for_auth_user(p_actor_auth_user_id);
  select identity_record.github_user_id
  into actor_github_user_id
  from public.github_identities identity_record
  where identity_record.id = actor_identity_id;
  if actor_identity_id is null then
    raise exception 'Approval requires an authenticated GitHub identity' using errcode = '42501';
  end if;

  approval_request_digest := private.sha256_text(
    private.canonical_jsonb_text(jsonb_build_object(
      'actorIdentityId', actor_identity_id,
      'draftPreviewDigest', p_expected_draft_preview_digest,
      'manifestDigest', p_expected_student_manifest_digest,
      'protectedDigest', p_expected_protected_package_digest,
      'studentDigest', p_expected_student_bundle_digest,
      'validationId', p_validation_id
    ))
  );
  perform pg_advisory_xact_lock(
    hashtextextended('case-approval-operation:' || p_approval_operation_id, 0)
  );
  select publication.*
  into existing_publication
  from private.case_version_publications publication
  where publication.approval_operation_id = p_approval_operation_id;
  if found then
    if existing_publication.approval_request_digest <> approval_request_digest
      or not private.actor_may_author_case(actor_identity_id, existing_publication.case_id)
      or private.actor_is_blind_for_case(actor_identity_id, existing_publication.case_id) then
      raise exception 'Approval operation payload conflict or actor is unauthorized'
        using errcode = '40001';
    end if;
    return query select
      existing_publication.case_version_id,
      existing_publication.case_version_digest,
      existing_publication.approved_at,
      existing_publication.approved_by;
    return;
  end if;

  select validation_row.*
  into validation_record
  from private.case_validations validation_row
  where validation_row.id = p_validation_id
  for update;

  if validation_record.id is null or actor_identity_id is null
    or not private.actor_may_author_case(actor_identity_id, validation_record.case_id)
    or private.actor_is_blind_for_case(actor_identity_id, validation_record.case_id) then
    raise exception 'Approval requires an existing validation and authorized non-blind staff'
      using errcode = '42501';
  end if;
  if not validation_record.validation_succeeded
    or validation_record.superseded_at is not null
    or validation_record.consumed_at is not null
    or jsonb_array_length(validation_record.validation_errors) <> 0 then
    raise exception 'Validation is invalid, stale, uncalibrated, superseded, or already used'
      using errcode = '55000';
  end if;
  if validation_record.student_bundle_digest <> p_expected_student_bundle_digest
    or validation_record.student_manifest_digest <> p_expected_student_manifest_digest
    or validation_record.protected_package_digest <> p_expected_protected_package_digest
    or validation_record.draft_preview_digest <> p_expected_draft_preview_digest
    or validation_record.student_bundle_digest <> private.sha256_text(validation_record.canonical_student_text)
    or validation_record.protected_package_digest <> private.sha256_text(validation_record.canonical_protected_text)
    or not private.student_materialization_is_valid(
      validation_record.student_materialization,
      validation_record.student_manifest_digest
    ) then
    raise exception 'Approval digest does not match the validated material' using errcode = '55000';
  end if;

  select jsonb_agg(
    jsonb_build_object(
      'artifactDigest', artifact.artifact_digest,
      'canonicalArtifactText', artifact.canonical_artifact_text,
      'class', artifact.calibration_class
    ) order by artifact.calibration_class
  )
  into stored_calibration_artifacts
  from private.case_validation_calibration_artifacts artifact
  where artifact.validation_id = validation_record.id;
  if not private.calibration_artifacts_are_valid(
    stored_calibration_artifacts,
    validation_record.canonical_protected_text::jsonb
  ) then
    raise exception 'Stored calibration artifacts do not match the protected package'
      using errcode = '55000';
  end if;

  approval_time := date_trunc('milliseconds', statement_timestamp());
  approval_actor := 'github:' || actor_github_user_id::text;
  final_case_version_digest := private.sha256_text(
    private.canonical_jsonb_text(
      jsonb_build_object(
        'approvedAt', to_char(approval_time at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'approvedBy', approval_actor,
        'caseId', validation_record.case_id,
        'methodologySnapshot', validation_record.methodology_snapshot,
        'protectedPackageDigest', validation_record.protected_package_digest,
        'requirementsSnapshot', validation_record.requirements_snapshot,
        'status', 'approved',
        'versionLabel', validation_record.version_label,
        'visibleBundleDigest', validation_record.student_bundle_digest
      )
    )
  );
  approved_source_text := private.canonical_jsonb_text(
    jsonb_build_object(
      'approvedAt', to_char(approval_time at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'approvedBy', approval_actor,
      'methodologySnapshot', validation_record.methodology_snapshot,
      'protected', validation_record.canonical_protected_text::jsonb,
      'requirementsSnapshot', validation_record.requirements_snapshot,
      'status', 'approved',
      'visible', validation_record.canonical_student_text::jsonb
    )
  );

  new_case_version_id := gen_random_uuid();
  insert into public.case_versions (
    id,
    case_id,
    case_version_digest,
    student_bundle_digest,
    protected_package_digest
  ) values (
    new_case_version_id,
    validation_record.case_id,
    final_case_version_digest,
    validation_record.student_bundle_digest,
    validation_record.protected_package_digest
  );

  insert into private.case_version_publications (
    case_version_id,
    validation_id,
    approval_operation_id,
    approval_request_digest,
    case_id,
    version_label,
    canonical_student_text,
    student_bundle_digest,
    student_materialization,
    student_manifest_digest,
    canonical_protected_text,
    protected_package_digest,
    case_version_digest,
    canonical_approved_source_text,
    methodology_snapshot,
    requirements_snapshot,
    approver_identity_id,
    approved_by,
    approved_at
  ) values (
    new_case_version_id,
    validation_record.id,
    p_approval_operation_id,
    approval_request_digest,
    validation_record.case_id,
    validation_record.version_label,
    validation_record.canonical_student_text,
    validation_record.student_bundle_digest,
    validation_record.student_materialization,
    validation_record.student_manifest_digest,
    validation_record.canonical_protected_text,
    validation_record.protected_package_digest,
    final_case_version_digest,
    approved_source_text,
    validation_record.methodology_snapshot,
    validation_record.requirements_snapshot,
    actor_identity_id,
    approval_actor,
    approval_time
  );

  insert into private.case_calibration_bindings (
    case_version_id,
    calibration_class,
    artifact_digest
  )
  select
    new_case_version_id,
    item ->> 'class',
    item ->> 'artifactDigest'
  from jsonb_array_elements(validation_record.calibration_bindings) item;

  update private.case_validations
  set consumed_at = statement_timestamp(),
      published_case_version_id = new_case_version_id
  where id = validation_record.id;

  return query select
    new_case_version_id,
    final_case_version_digest,
    approval_time,
    approval_actor;
end;
$$;

create or replace function private.reserve_assignment(
  p_actor_auth_user_id uuid,
  p_client_operation_id text,
  p_case_version_digest text,
  p_student_github_user_id bigint,
  p_repository_owner text,
  p_template_commit text,
  p_student_bundle_digest text,
  p_student_materialization jsonb,
  p_student_manifest_digest text
)
returns table (
  assignment_id uuid,
  repository_owner text,
  repository_name text,
  provisioning_state public.assignment_provisioning_state
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_identity_id uuid;
  publication_record private.case_version_publications%rowtype;
  resolved_student_identity_id uuid;
  request_digest text;
  operation_record private.assignment_reservation_operations%rowtype;
  provisioning_record private.assignment_provisioning%rowtype;
  new_assignment_id uuid;
  deterministic_repository_name text;
  configuration_record private.provisioning_configuration%rowtype;
begin
  select publication.*
  into publication_record
  from private.case_version_publications publication
  where publication.case_version_digest = p_case_version_digest;

  actor_identity_id := private.github_identity_for_auth_user(p_actor_auth_user_id);
  select configuration.*
  into configuration_record
  from private.provisioning_configuration configuration
  where configuration.singleton;
  if publication_record.case_version_id is null or actor_identity_id is null
    or not private.actor_may_author_case(actor_identity_id, publication_record.case_id)
    or private.actor_is_blind_for_case(actor_identity_id, publication_record.case_id) then
    raise exception 'Assignment reservation requires authorized non-blind staff'
      using errcode = '42501';
  end if;
  if publication_record.student_bundle_digest <> p_student_bundle_digest
    or publication_record.student_manifest_digest <> p_student_manifest_digest
    or publication_record.student_materialization <> p_student_materialization
    or not private.student_materialization_is_valid(
      p_student_materialization,
      p_student_manifest_digest
    )
    or p_client_operation_id is null or length(p_client_operation_id) not between 1 and 160
    or p_student_github_user_id is null or p_student_github_user_id <= 0
    or p_repository_owner !~ '^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$'
    or p_template_commit !~ '^[a-f0-9]{40}$'
    or configuration_record.singleton is null
    or lower(p_repository_owner) <> lower(configuration_record.repository_owner)
    or p_template_commit <> configuration_record.template_commit then
    raise exception 'Assignment reservation payload is invalid or stale' using errcode = '22023';
  end if;

  select identity_record.id
  into resolved_student_identity_id
  from public.github_identities identity_record
  where identity_record.github_user_id = p_student_github_user_id;
  if resolved_student_identity_id is null then
    raise exception 'Assignee GitHub identity is unavailable' using errcode = '22023';
  end if;

  request_digest := private.sha256_text(
    jsonb_build_object(
      'bundleDigest', p_student_bundle_digest,
      'caseDigest', p_case_version_digest,
      'manifestDigest', p_student_manifest_digest,
      'owner', lower(p_repository_owner),
      'studentGithubUserId', p_student_github_user_id,
      'templateCommit', p_template_commit
    )::text
  );

  perform pg_advisory_xact_lock(
    hashtextextended('assignment-operation:' || p_client_operation_id, 0)
  );

  select operation.*
  into operation_record
  from private.assignment_reservation_operations operation
  where operation.client_operation_id = p_client_operation_id;
  if found then
    if operation_record.request_digest <> request_digest then
      raise exception 'Assignment operation payload conflict' using errcode = '40001';
    end if;
    select provisioning.* into provisioning_record
    from private.assignment_provisioning provisioning
    where provisioning.assignment_id = operation_record.assignment_id;
    return query select
      provisioning_record.assignment_id,
      provisioning_record.repository_owner,
      provisioning_record.repository_name,
      provisioning_record.state;
    return;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(publication_record.case_version_id::text || ':' || resolved_student_identity_id::text, 0)
  );
  select provisioning.*
  into provisioning_record
  from private.assignment_provisioning provisioning
  where provisioning.case_version_id = publication_record.case_version_id
    and provisioning.student_identity_id = resolved_student_identity_id;

  if found then
    if provisioning_record.request_digest <> request_digest then
      raise exception 'Assignment binding already has another payload' using errcode = '40001';
    end if;
    insert into private.assignment_reservation_operations (
      client_operation_id, request_digest, assignment_id
    ) values (
      p_client_operation_id, request_digest, provisioning_record.assignment_id
    );
    return query select
      provisioning_record.assignment_id,
      provisioning_record.repository_owner,
      provisioning_record.repository_name,
      provisioning_record.state;
    return;
  end if;

  new_assignment_id := gen_random_uuid();
  deterministic_repository_name := 'volta-sim-' || substr(
    encode(
      extensions.digest(
        convert_to(publication_record.case_version_digest || ':' || p_student_github_user_id::text, 'UTF8'),
        'sha256'
      ),
      'hex'
    ),
    1,
    24
  );

  insert into public.assignments (
    id, case_version_id, student_identity_id, required_blind_policy_version
  ) values (
    new_assignment_id, publication_record.case_version_id, resolved_student_identity_id, 1
  );
  insert into public.blind_policies (
    assignment_id, case_version_id, policy_version, mode, blind_student_identity_id
  ) values (
    new_assignment_id,
    publication_record.case_version_id,
    1,
    'attempt-one',
    resolved_student_identity_id
  );
  insert into private.assignment_provisioning (
    assignment_id,
    case_version_id,
    student_identity_id,
    repository_owner,
    repository_name,
    template_commit,
    student_bundle_digest,
    student_materialization,
    student_manifest_digest,
    request_digest
  ) values (
    new_assignment_id,
    publication_record.case_version_id,
    resolved_student_identity_id,
    p_repository_owner,
    deterministic_repository_name,
    p_template_commit,
    p_student_bundle_digest,
    p_student_materialization,
    p_student_manifest_digest,
    request_digest
  ) returning * into provisioning_record;
  insert into private.assignment_reservation_operations (
    client_operation_id, request_digest, assignment_id
  ) values (
    p_client_operation_id, request_digest, new_assignment_id
  );

  return query select
    provisioning_record.assignment_id,
    provisioning_record.repository_owner,
    provisioning_record.repository_name,
    provisioning_record.state;
end;
$$;

create or replace function private.record_clean_canary_scan(
  p_actor_auth_user_id uuid,
  p_client_operation_id text,
  p_assignment_id uuid,
  p_provider_repository_id bigint,
  p_repository_owner text,
  p_repository_name text,
  p_scan_stage text,
  p_template_commit text,
  p_materialized_commit text,
  p_student_bundle_digest text,
  p_student_manifest_digest text,
  p_materialized_files jsonb,
  p_repository_state_digest text,
  p_canary_set_digest text,
  p_scanner_version text,
  p_scanned_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_identity_id uuid;
  provisioning_record private.assignment_provisioning%rowtype;
  existing_receipt private.assignment_canary_scan_receipts%rowtype;
  case_id text;
  expected_materialized_files jsonb;
  materialized_files_digest text;
  operation_digest text;
  new_receipt_id uuid;
  expected_student_github_user_id bigint;
begin
  select provisioning.*
  into provisioning_record
  from private.assignment_provisioning provisioning
  where provisioning.assignment_id = p_assignment_id;
  if not found then
    raise exception 'Assignment provisioning record is unavailable' using errcode = '22023';
  end if;

  select publication.case_id into case_id
  from private.case_version_publications publication
  where publication.case_version_id = provisioning_record.case_version_id;
  actor_identity_id := private.github_identity_for_auth_user(p_actor_auth_user_id);
  if actor_identity_id is null
    or not private.actor_may_author_case(actor_identity_id, case_id)
    or private.actor_is_blind_for_case(actor_identity_id, case_id) then
    raise exception 'Repository scan recording requires authorized non-blind staff'
      using errcode = '42501';
  end if;

  select jsonb_agg(
    jsonb_build_object(
      'byteLength', (entry.value ->> 'byteLength')::bigint,
      'digest', entry.value ->> 'digest',
      'path', entry.value ->> 'path'
    ) order by entry.ordinality
  )
  into expected_materialized_files
  from jsonb_array_elements(
    provisioning_record.student_materialization -> 'files'
  ) with ordinality entry(value, ordinality);
  materialized_files_digest := private.sha256_text(
    private.canonical_jsonb_text(p_materialized_files)
  );

  if p_client_operation_id is null or length(p_client_operation_id) not between 1 and 160
    or p_provider_repository_id is null or p_provider_repository_id <= 0
    or p_repository_owner is null
    or p_repository_name is null
    or p_scan_stage not in ('pre_invitation', 'pre_ready')
    or p_template_commit !~ '^[a-f0-9]{40}$'
    or p_materialized_commit !~ '^[a-f0-9]{40}$'
    or p_student_bundle_digest !~ '^sha256:[a-f0-9]{64}$'
    or p_student_manifest_digest !~ '^sha256:[a-f0-9]{64}$'
    or jsonb_typeof(p_materialized_files) <> 'array'
    or p_repository_state_digest !~ '^sha256:[a-f0-9]{64}$'
    or p_canary_set_digest !~ '^sha256:[a-f0-9]{64}$'
    or p_scanner_version !~ '^[a-z0-9]+(?:[._-][a-z0-9]+)*$'
    or length(p_scanner_version) > 100
    or p_scanned_at is null
    or p_scanned_at < statement_timestamp() - interval '5 minutes'
    or p_scanned_at > statement_timestamp() + interval '1 minute' then
    raise exception 'Repository scan receipt is invalid' using errcode = '22023';
  end if;

  operation_digest := private.sha256_text(
    private.canonical_jsonb_text(jsonb_build_object(
      'actorIdentityId', actor_identity_id,
      'assignmentId', p_assignment_id,
      'canarySetDigest', p_canary_set_digest,
      'materializedCommit', p_materialized_commit,
      'materializedFiles', p_materialized_files,
      'providerRepositoryId', p_provider_repository_id,
      'repositoryStateDigest', p_repository_state_digest,
      'repositoryName', lower(p_repository_name),
      'repositoryOwner', lower(p_repository_owner),
      'scanStage', p_scan_stage,
      'scannedAt', p_scanned_at,
      'scannerVersion', p_scanner_version,
      'studentBundleDigest', p_student_bundle_digest,
      'studentManifestDigest', p_student_manifest_digest,
      'templateCommit', p_template_commit
    ))
  );
  perform pg_advisory_xact_lock(
    hashtextextended('assignment-scan-operation:' || p_client_operation_id, 0)
  );
  select receipt.*
  into existing_receipt
  from private.assignment_canary_scan_receipts receipt
  where receipt.client_operation_id = p_client_operation_id;
  if found then
    if existing_receipt.operation_digest <> operation_digest
      or existing_receipt.assignment_id <> p_assignment_id then
      raise exception 'Repository scan operation payload conflict' using errcode = '40001';
    end if;
    return existing_receipt.id;
  end if;

  select provisioning.*
  into provisioning_record
  from private.assignment_provisioning provisioning
  where provisioning.assignment_id = p_assignment_id
  for update;
  select identity_record.github_user_id
  into expected_student_github_user_id
  from public.github_identities identity_record
  where identity_record.id = provisioning_record.student_identity_id;
  if (
      (
        p_scan_stage = 'pre_invitation'
        and not (
          provisioning_record.state = 'repository_created'
          or (
            provisioning_record.state = 'invitation_pending'
            and provisioning_record.invitation_id is null
            and provisioning_record.invitation_state <> 'accepted'
          )
        )
      )
      or (p_scan_stage = 'pre_ready' and provisioning_record.state <> 'invitation_pending')
    )
    or (
      p_scan_stage = 'pre_ready'
      and (
        provisioning_record.invitation_state <> 'accepted'
        or provisioning_record.invitation_id is null
        or provisioning_record.collaborator_github_user_id <> expected_student_github_user_id
        or provisioning_record.assignee_current_login !~ '^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$'
        or provisioning_record.collaborator_permission <> 'push'
      )
    )
    or provisioning_record.provider_repository_id is distinct from p_provider_repository_id
    or lower(provisioning_record.repository_owner) <> lower(p_repository_owner)
    or lower(provisioning_record.repository_name) <> lower(p_repository_name)
    or provisioning_record.template_commit <> p_template_commit
    or provisioning_record.materialized_commit is distinct from p_materialized_commit
    or provisioning_record.student_bundle_digest <> p_student_bundle_digest
    or provisioning_record.student_manifest_digest <> p_student_manifest_digest
    or expected_materialized_files <> p_materialized_files
    or provisioning_record.readback_materialized_files <> p_materialized_files then
    raise exception 'Repository scan receipt does not match the current provider snapshot'
      using errcode = '55000';
  end if;

  new_receipt_id := gen_random_uuid();
  insert into private.assignment_canary_scan_receipts (
    id,
    client_operation_id,
    operation_digest,
    assignment_id,
    provider_repository_id,
    repository_owner,
    repository_name,
    scan_stage,
    template_commit,
    materialized_commit,
    student_bundle_digest,
    student_manifest_digest,
    materialized_files_digest,
    repository_state_digest,
    canary_set_digest,
    scanner_version,
    scanned_at,
    recorded_by_identity_id
  ) values (
    new_receipt_id,
    p_client_operation_id,
    operation_digest,
    p_assignment_id,
    p_provider_repository_id,
    p_repository_owner,
    p_repository_name,
    p_scan_stage,
    p_template_commit,
    p_materialized_commit,
    p_student_bundle_digest,
    p_student_manifest_digest,
    materialized_files_digest,
    p_repository_state_digest,
    p_canary_set_digest,
    p_scanner_version,
    p_scanned_at,
    actor_identity_id
  );
  return new_receipt_id;
end;
$$;

create or replace function private.record_assignment_provisioning(
  p_actor_auth_user_id uuid,
  p_client_operation_id text,
  p_assignment_id uuid,
  p_expected_state public.assignment_provisioning_state,
  p_new_state public.assignment_provisioning_state,
  p_provider_repository_id bigint,
  p_readback_private boolean,
  p_readback_owner text,
  p_readback_repository_name text,
  p_readback_template_commit text,
  p_readback_materialized_commit text,
  p_readback_bundle_digest text,
  p_readback_manifest_digest text,
  p_readback_materialized_files jsonb,
  p_assignee_current_login text,
  p_collaborator_github_user_id bigint,
  p_collaborator_permission text,
  p_invitation_id text,
  p_invitation_state public.repository_invitation_state,
  p_invitation_scan_receipt_id uuid,
  p_readiness_scan_receipt_id uuid,
  p_failure_code text
)
returns public.assignment_provisioning_state
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_identity_id uuid;
  provisioning_record private.assignment_provisioning%rowtype;
  operation_record private.provisioning_transition_operations%rowtype;
  invitation_scan_receipt private.assignment_canary_scan_receipts%rowtype;
  readiness_scan_receipt private.assignment_canary_scan_receipts%rowtype;
  case_id text;
  allowed_transition boolean;
  attempt_outcome text;
  expected_materialized_files jsonb;
  expected_materialized_files_digest text;
  expected_student_github_user_id bigint;
  request_digest text;
  attempt_id bigint;
  is_invitation_dispatch boolean;
  can_replace_invitation_scan boolean;
begin
  select provisioning.*
  into provisioning_record
  from private.assignment_provisioning provisioning
  where provisioning.assignment_id = p_assignment_id;
  if not found then
    raise exception 'Assignment provisioning record is unavailable' using errcode = '22023';
  end if;
  select publication.case_id into case_id
  from private.case_version_publications publication
  where publication.case_version_id = provisioning_record.case_version_id;

  actor_identity_id := private.github_identity_for_auth_user(p_actor_auth_user_id);
  if actor_identity_id is null
    or not private.actor_may_author_case(actor_identity_id, case_id)
    or private.actor_is_blind_for_case(actor_identity_id, case_id) then
    raise exception 'Provisioning update requires authorized non-blind staff'
      using errcode = '42501';
  end if;
  if p_client_operation_id is null or length(p_client_operation_id) not between 1 and 160 then
    raise exception 'Provisioning operation id is invalid' using errcode = '22023';
  end if;

  request_digest := private.sha256_text(
    private.canonical_jsonb_text(jsonb_build_object(
      'actorIdentityId', actor_identity_id,
      'assignmentId', p_assignment_id,
      'assigneeCurrentLogin', p_assignee_current_login,
      'invitationScanReceiptId', p_invitation_scan_receipt_id,
      'collaboratorGithubUserId', p_collaborator_github_user_id,
      'collaboratorPermission', p_collaborator_permission,
      'expectedState', p_expected_state,
      'failureCode', p_failure_code,
      'invitationId', p_invitation_id,
      'invitationState', p_invitation_state,
      'newState', p_new_state,
      'providerRepositoryId', p_provider_repository_id,
      'readbackBundleDigest', p_readback_bundle_digest,
      'readbackManifestDigest', p_readback_manifest_digest,
      'readbackMaterializedCommit', p_readback_materialized_commit,
      'readbackMaterializedFiles', p_readback_materialized_files,
      'readbackOwner', p_readback_owner,
      'readbackPrivate', p_readback_private,
      'readbackRepositoryName', p_readback_repository_name,
      'readbackTemplateCommit', p_readback_template_commit,
      'readinessScanReceiptId', p_readiness_scan_receipt_id
    ))
  );
  perform pg_advisory_xact_lock(
    hashtextextended('assignment-transition-operation:' || p_client_operation_id, 0)
  );
  select operation.*
  into operation_record
  from private.provisioning_transition_operations operation
  where operation.client_operation_id = p_client_operation_id;
  if found then
    if operation_record.request_digest <> request_digest
      or operation_record.assignment_id <> p_assignment_id then
      raise exception 'Provisioning operation payload conflict' using errcode = '40001';
    end if;
    return operation_record.resulting_state;
  end if;

  select provisioning.*
  into provisioning_record
  from private.assignment_provisioning provisioning
  where provisioning.assignment_id = p_assignment_id
  for update;
  if provisioning_record.state <> p_expected_state then
    raise exception 'Provisioning state changed; reconcile before retry' using errcode = '40001';
  end if;

  allowed_transition :=
    p_new_state = p_expected_state
    or (p_expected_state = 'provisioning' and p_new_state = 'repository_created')
    or (p_expected_state = 'repository_created' and p_new_state = 'invitation_pending')
    or (p_expected_state = 'invitation_pending' and p_new_state = 'ready');
  if not allowed_transition then
    raise exception 'Provisioning state transition is invalid' using errcode = '22023';
  end if;
  is_invitation_dispatch :=
    p_new_state = 'invitation_pending'
    and p_invitation_id is null
    and p_invitation_state = 'none'
    and p_failure_code is null;
  can_replace_invitation_scan :=
    provisioning_record.invitation_scan_receipt_id is not null
    and p_invitation_scan_receipt_id is distinct from provisioning_record.invitation_scan_receipt_id
    and provisioning_record.state = 'invitation_pending'
    and provisioning_record.invitation_id is null
    and provisioning_record.invitation_state <> 'accepted'
    and is_invitation_dispatch;
  if p_failure_code is not null and (
    p_failure_code !~ '^[a-z0-9]+(?:[._-][a-z0-9]+)*$'
    or length(p_failure_code) > 100
    or p_new_state <> p_expected_state
    or p_expected_state = 'ready'
  ) then
    raise exception 'Provisioning failure metadata must be an allowlisted code'
      using errcode = '22023';
  end if;

  select identity_record.github_user_id
  into expected_student_github_user_id
  from public.github_identities identity_record
  where identity_record.id = provisioning_record.student_identity_id;
  select jsonb_agg(
    jsonb_build_object(
      'byteLength', (entry.value ->> 'byteLength')::bigint,
      'digest', entry.value ->> 'digest',
      'path', entry.value ->> 'path'
    ) order by entry.ordinality
  )
  into expected_materialized_files
  from jsonb_array_elements(
    provisioning_record.student_materialization -> 'files'
  ) with ordinality entry(value, ordinality);
  expected_materialized_files_digest := private.sha256_text(
    private.canonical_jsonb_text(expected_materialized_files)
  );

  if p_new_state <> 'provisioning' and (
    p_provider_repository_id is null or p_provider_repository_id <= 0
    or p_readback_private is distinct from true
    or lower(p_readback_owner) <> lower(provisioning_record.repository_owner)
    or lower(p_readback_repository_name) <> lower(provisioning_record.repository_name)
    or p_readback_template_commit <> provisioning_record.template_commit
    or p_readback_materialized_commit !~ '^[a-f0-9]{40}$'
    or p_readback_bundle_digest <> provisioning_record.student_bundle_digest
    or p_readback_manifest_digest <> provisioning_record.student_manifest_digest
    or p_readback_materialized_files <> expected_materialized_files
  ) then
    raise exception 'Repository readback does not match the reservation' using errcode = '55000';
  end if;
  if p_new_state in ('invitation_pending', 'ready') and (
    p_assignee_current_login !~ '^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$'
    or (
      p_failure_code is null
      and p_invitation_state = 'none'
      and not (
        is_invitation_dispatch
        and p_invitation_scan_receipt_id is not null
      )
    )
  ) then
    raise exception 'Invitation readback is incomplete' using errcode = '55000';
  end if;
  if p_new_state = 'ready' and (
    p_invitation_state <> 'accepted'
    or p_invitation_id is null
    or p_collaborator_github_user_id <> expected_student_github_user_id
    or p_collaborator_permission <> 'push'
  ) then
    raise exception 'Ready requires an accepted least-permission invitation'
      using errcode = '55000';
  end if;
  if provisioning_record.provider_repository_id is not null
    and p_provider_repository_id is distinct from provisioning_record.provider_repository_id then
    raise exception 'Repository provider identity cannot be replaced' using errcode = '55000';
  end if;
  if provisioning_record.materialized_commit is not null
    and p_readback_materialized_commit is distinct from provisioning_record.materialized_commit then
    raise exception 'Repository materialized commit cannot be replaced' using errcode = '55000';
  end if;
  if provisioning_record.invitation_id is not null
    and p_invitation_id is distinct from provisioning_record.invitation_id then
    raise exception 'Invitation identity cannot be replaced' using errcode = '55000';
  end if;
  if provisioning_record.invitation_state = 'accepted'
    and p_invitation_state <> 'accepted' then
    raise exception 'Accepted invitation state cannot be reversed' using errcode = '55000';
  end if;
  if provisioning_record.invitation_scan_receipt_id is not null
    and p_invitation_scan_receipt_id is distinct from provisioning_record.invitation_scan_receipt_id
    and not can_replace_invitation_scan then
    raise exception 'Invitation scan receipt cannot be replaced' using errcode = '55000';
  end if;
  if provisioning_record.readiness_scan_receipt_id is not null
    and p_readiness_scan_receipt_id is distinct from provisioning_record.readiness_scan_receipt_id then
    raise exception 'Readiness scan receipt cannot be replaced' using errcode = '55000';
  end if;

  if p_new_state in ('invitation_pending', 'ready') then
    select receipt.*
    into invitation_scan_receipt
    from private.assignment_canary_scan_receipts receipt
    where receipt.id = p_invitation_scan_receipt_id;
    if not found
      or invitation_scan_receipt.scan_stage <> 'pre_invitation'
      or invitation_scan_receipt.assignment_id <> p_assignment_id
      or invitation_scan_receipt.provider_repository_id <> p_provider_repository_id
      or lower(invitation_scan_receipt.repository_owner) <> lower(p_readback_owner)
      or lower(invitation_scan_receipt.repository_name) <> lower(p_readback_repository_name)
      or invitation_scan_receipt.template_commit <> p_readback_template_commit
      or invitation_scan_receipt.materialized_commit <> p_readback_materialized_commit
      or invitation_scan_receipt.student_bundle_digest <> p_readback_bundle_digest
      or invitation_scan_receipt.student_manifest_digest <> p_readback_manifest_digest
      or invitation_scan_receipt.materialized_files_digest <> expected_materialized_files_digest
      or (
        (
          p_expected_state = 'repository_created'
          and p_new_state = 'invitation_pending'
        )
        or is_invitation_dispatch
      )
      and invitation_scan_receipt.recorded_at < statement_timestamp() - interval '5 minutes'
      or (
        is_invitation_dispatch
        and p_expected_state = 'invitation_pending'
        and p_invitation_scan_receipt_id is not distinct from provisioning_record.invitation_scan_receipt_id
      ) then
      raise exception 'Invitation requires an exact immutable clean scan receipt'
        using errcode = '55000';
    end if;
  end if;

  if p_new_state = 'ready' then
    select receipt.*
    into readiness_scan_receipt
    from private.assignment_canary_scan_receipts receipt
    where receipt.id = p_readiness_scan_receipt_id;
    if not found
      or readiness_scan_receipt.scan_stage <> 'pre_ready'
      or readiness_scan_receipt.assignment_id <> p_assignment_id
      or readiness_scan_receipt.provider_repository_id <> p_provider_repository_id
      or lower(readiness_scan_receipt.repository_owner) <> lower(p_readback_owner)
      or lower(readiness_scan_receipt.repository_name) <> lower(p_readback_repository_name)
      or readiness_scan_receipt.template_commit <> p_readback_template_commit
      or readiness_scan_receipt.materialized_commit <> p_readback_materialized_commit
      or readiness_scan_receipt.student_bundle_digest <> p_readback_bundle_digest
      or readiness_scan_receipt.student_manifest_digest <> p_readback_manifest_digest
      or readiness_scan_receipt.materialized_files_digest <> expected_materialized_files_digest
      or readiness_scan_receipt.recorded_at < statement_timestamp() - interval '5 minutes'
      or readiness_scan_receipt.canary_set_digest <> invitation_scan_receipt.canary_set_digest
      or readiness_scan_receipt.repository_state_digest <> invitation_scan_receipt.repository_state_digest
      or readiness_scan_receipt.scanner_version <> invitation_scan_receipt.scanner_version
      or readiness_scan_receipt.scanned_at < invitation_scan_receipt.scanned_at then
      raise exception 'Ready requires a fresh exact immutable clean scan receipt'
        using errcode = '55000';
    end if;
  end if;

  update private.assignment_provisioning
  set state = p_new_state,
      provider_repository_id = coalesce(provider_repository_id, p_provider_repository_id),
      materialized_commit = coalesce(materialized_commit, p_readback_materialized_commit),
      readback_private = coalesce(p_readback_private, readback_private),
      readback_owner = coalesce(p_readback_owner, readback_owner),
      readback_repository_name = coalesce(p_readback_repository_name, readback_repository_name),
      readback_template_commit = coalesce(p_readback_template_commit, readback_template_commit),
      readback_materialized_commit = coalesce(
        p_readback_materialized_commit,
        readback_materialized_commit
      ),
      readback_bundle_digest = coalesce(p_readback_bundle_digest, readback_bundle_digest),
      readback_manifest_digest = coalesce(p_readback_manifest_digest, readback_manifest_digest),
      readback_materialized_files = coalesce(
        p_readback_materialized_files,
        readback_materialized_files
      ),
      assignee_current_login = coalesce(p_assignee_current_login, assignee_current_login),
      collaborator_github_user_id = coalesce(
        p_collaborator_github_user_id,
        collaborator_github_user_id
      ),
      collaborator_permission = coalesce(p_collaborator_permission, collaborator_permission),
      invitation_id = coalesce(invitation_id, p_invitation_id),
      invitation_state = p_invitation_state,
      invitation_scan_receipt_id = case
        when invitation_scan_receipt_id is null or can_replace_invitation_scan
          then p_invitation_scan_receipt_id
        else invitation_scan_receipt_id
      end,
      readiness_scan_receipt_id = coalesce(
        readiness_scan_receipt_id,
        p_readiness_scan_receipt_id
      ),
      failure_code = p_failure_code,
      failure_at = case when p_failure_code is null then null else statement_timestamp() end,
      ready_at = case
        when p_new_state = 'ready' then coalesce(ready_at, statement_timestamp())
        else null
      end,
      updated_at = statement_timestamp()
  where assignment_id = p_assignment_id;

  attempt_outcome := case
    when p_failure_code is not null then 'failed'
    when p_new_state = 'ready' then 'succeeded'
    else 'pending'
  end;
  insert into private.provisioning_attempts (
    assignment_id,
    attempted_state,
    outcome,
    failure_code,
    attempted_by_identity_id
  ) values (
    p_assignment_id,
    p_new_state,
    attempt_outcome,
    p_failure_code,
    actor_identity_id
  ) returning id into attempt_id;

  insert into private.provisioning_transition_operations (
    client_operation_id,
    request_digest,
    assignment_id,
    resulting_state,
    provisioning_attempt_id
  ) values (
    p_client_operation_id,
    request_digest,
    p_assignment_id,
    p_new_state,
    attempt_id
  );

  return p_new_state;
end;
$$;

create or replace function private.student_assignment_is_ready(
  p_actor_auth_user_id uuid,
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
    from private.assignment_provisioning provisioning
    join private.assignment_canary_scan_receipts invitation_scan
      on invitation_scan.id = provisioning.invitation_scan_receipt_id
     and invitation_scan.scan_stage = 'pre_invitation'
     and invitation_scan.assignment_id = provisioning.assignment_id
     and invitation_scan.provider_repository_id = provisioning.provider_repository_id
     and lower(invitation_scan.repository_owner) = lower(provisioning.readback_owner)
     and lower(invitation_scan.repository_name) = lower(provisioning.readback_repository_name)
     and invitation_scan.template_commit = provisioning.readback_template_commit
     and invitation_scan.materialized_commit = provisioning.readback_materialized_commit
     and invitation_scan.student_bundle_digest = provisioning.readback_bundle_digest
     and invitation_scan.student_manifest_digest = provisioning.readback_manifest_digest
     and invitation_scan.materialized_files_digest = private.sha256_text(
       private.canonical_jsonb_text(provisioning.readback_materialized_files)
     )
    join private.assignment_canary_scan_receipts readiness_scan
      on readiness_scan.id = provisioning.readiness_scan_receipt_id
     and readiness_scan.scan_stage = 'pre_ready'
     and readiness_scan.assignment_id = provisioning.assignment_id
     and readiness_scan.provider_repository_id = provisioning.provider_repository_id
     and lower(readiness_scan.repository_owner) = lower(provisioning.readback_owner)
     and lower(readiness_scan.repository_name) = lower(provisioning.readback_repository_name)
     and readiness_scan.template_commit = provisioning.readback_template_commit
     and readiness_scan.materialized_commit = provisioning.readback_materialized_commit
     and readiness_scan.student_bundle_digest = provisioning.readback_bundle_digest
     and readiness_scan.student_manifest_digest = provisioning.readback_manifest_digest
     and readiness_scan.materialized_files_digest = private.sha256_text(
       private.canonical_jsonb_text(provisioning.readback_materialized_files)
     )
    join public.assignments assignment_record
      on assignment_record.id = provisioning.assignment_id
    join public.github_identities identity_record
      on identity_record.id = assignment_record.student_identity_id
    join auth.identities auth_identity
      on auth_identity.id = identity_record.auth_identity_id
     and auth_identity.user_id = identity_record.auth_user_id
     and auth_identity.provider = 'github'
     and auth_identity.provider_id = identity_record.github_user_id::text
    where provisioning.assignment_id = p_assignment_id
      and identity_record.auth_user_id = p_actor_auth_user_id
      and provisioning.state = 'ready'
      and provisioning.provider_repository_id is not null
      and provisioning.readback_private
      and lower(provisioning.readback_owner) = lower(provisioning.repository_owner)
      and lower(provisioning.readback_repository_name) = lower(provisioning.repository_name)
      and provisioning.readback_template_commit = provisioning.template_commit
      and provisioning.readback_materialized_commit = provisioning.materialized_commit
      and provisioning.readback_bundle_digest = provisioning.student_bundle_digest
      and provisioning.readback_manifest_digest = provisioning.student_manifest_digest
      and provisioning.readback_materialized_files = (
        select jsonb_agg(
          jsonb_build_object(
            'byteLength', (entry.value ->> 'byteLength')::bigint,
            'digest', entry.value ->> 'digest',
            'path', entry.value ->> 'path'
          ) order by entry.ordinality
        )
        from jsonb_array_elements(
          provisioning.student_materialization -> 'files'
        ) with ordinality entry(value, ordinality)
      )
      and provisioning.invitation_state = 'accepted'
      and provisioning.invitation_id is not null
      and provisioning.collaborator_github_user_id = identity_record.github_user_id
      and provisioning.assignee_current_login ~ '^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$'
      and provisioning.collaborator_permission = 'push'
      and provisioning.ready_at is not null
      and assignment_record.revoked_at is null
  )
$$;

create or replace function private.protect_case_validation_material()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.client_operation_id <> old.client_operation_id
    or new.operation_digest <> old.operation_digest
    or new.case_id <> old.case_id
    or new.version_label <> old.version_label
    or new.canonical_student_text <> old.canonical_student_text
    or new.student_bundle_digest <> old.student_bundle_digest
    or new.student_materialization <> old.student_materialization
    or new.student_manifest_digest <> old.student_manifest_digest
    or new.canonical_protected_text <> old.canonical_protected_text
    or new.protected_package_digest <> old.protected_package_digest
    or new.draft_preview_digest <> old.draft_preview_digest
    or new.methodology_snapshot <> old.methodology_snapshot
    or new.requirements_snapshot <> old.requirements_snapshot
    or new.calibration_bindings <> old.calibration_bindings
    or new.validation_succeeded <> old.validation_succeeded
    or new.validation_errors <> old.validation_errors
    or new.validated_by_identity_id <> old.validated_by_identity_id
    or new.validated_at <> old.validated_at
    or (old.superseded_at is not null and new.superseded_at is distinct from old.superseded_at)
    or (old.consumed_at is not null and new.consumed_at is distinct from old.consumed_at)
    or (old.published_case_version_id is not null and new.published_case_version_id is distinct from old.published_case_version_id) then
    raise exception 'Validated case material is immutable' using errcode = '55000';
  end if;
  return new;
end;
$$;

create trigger case_validation_material_is_immutable
before update on private.case_validations
for each row execute function private.protect_case_validation_material();

create trigger case_publications_are_append_only
before update or delete on private.case_version_publications
for each row execute function private.block_update_delete();

create trigger case_validation_calibration_artifacts_are_append_only
before update or delete on private.case_validation_calibration_artifacts
for each row execute function private.block_update_delete();

create trigger provisioning_configuration_is_append_only
before update or delete on private.provisioning_configuration
for each row execute function private.block_update_delete();

create trigger calibration_bindings_are_append_only
before update or delete on private.case_calibration_bindings
for each row execute function private.block_update_delete();

create trigger reservation_operations_are_append_only
before update or delete on private.assignment_reservation_operations
for each row execute function private.block_update_delete();

create trigger provisioning_attempts_are_append_only
before update or delete on private.provisioning_attempts
for each row execute function private.block_update_delete();

create trigger assignment_canary_scan_receipts_are_append_only
before update or delete on private.assignment_canary_scan_receipts
for each row execute function private.block_update_delete();

create trigger provisioning_transition_operations_are_append_only
before update or delete on private.provisioning_transition_operations
for each row execute function private.block_update_delete();

revoke insert, update, delete on public.case_versions from service_role;
revoke insert, update, delete on public.assignments from service_role;
revoke insert, update, delete on public.blind_policies from service_role;

revoke all on all tables in schema private from public, anon, authenticated, service_role;
revoke all on all sequences in schema private from public, anon, authenticated, service_role;

revoke all on function private.sha256_text(text) from public, anon, authenticated, service_role;
revoke all on function private.canonical_jsonb_text(jsonb) from public, anon, authenticated, service_role;
revoke all on function private.student_materialization_is_valid(jsonb, text) from public, anon, authenticated, service_role;
revoke all on function private.calibration_artifacts_are_valid(jsonb, jsonb) from public, anon, authenticated, service_role;
revoke all on function private.github_identity_for_auth_user(uuid) from public, anon, authenticated, service_role;
revoke all on function private.actor_may_author_case(uuid, text) from public, anon, authenticated, service_role;
revoke all on function private.actor_is_blind_for_case(uuid, text) from public, anon, authenticated, service_role;
revoke all on function private.record_case_validation(uuid, text, text, text, text, text, jsonb, text, text, text, text, jsonb, jsonb, jsonb, boolean, jsonb) from public, anon, authenticated;
revoke all on function private.approve_case_version(uuid, uuid, text, text, text, text, text) from public, anon, authenticated;
revoke all on function private.reserve_assignment(uuid, text, text, bigint, text, text, text, jsonb, text) from public, anon, authenticated;
revoke all on function private.record_clean_canary_scan(uuid, text, uuid, bigint, text, text, text, text, text, text, text, jsonb, text, text, text, timestamptz) from public, anon, authenticated;
revoke all on function private.record_assignment_provisioning(uuid, text, uuid, public.assignment_provisioning_state, public.assignment_provisioning_state, bigint, boolean, text, text, text, text, text, text, jsonb, text, bigint, text, text, public.repository_invitation_state, uuid, uuid, text) from public, anon, authenticated;
revoke all on function private.student_assignment_is_ready(uuid, uuid) from public, anon, authenticated;
revoke all on function private.protect_case_validation_material() from public, anon, authenticated, service_role;

grant execute on function private.record_case_validation(uuid, text, text, text, text, text, jsonb, text, text, text, text, jsonb, jsonb, jsonb, boolean, jsonb) to service_role;
grant execute on function private.approve_case_version(uuid, uuid, text, text, text, text, text) to service_role;
grant execute on function private.reserve_assignment(uuid, text, text, bigint, text, text, text, jsonb, text) to service_role;
grant execute on function private.record_clean_canary_scan(uuid, text, uuid, bigint, text, text, text, text, text, text, text, jsonb, text, text, text, timestamptz) to service_role;
grant execute on function private.record_assignment_provisioning(uuid, text, uuid, public.assignment_provisioning_state, public.assignment_provisioning_state, bigint, boolean, text, text, text, text, text, text, jsonb, text, bigint, text, text, public.repository_invitation_state, uuid, uuid, text) to service_role;
grant execute on function private.student_assignment_is_ready(uuid, uuid) to service_role;
