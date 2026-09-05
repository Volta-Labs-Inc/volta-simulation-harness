begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

select ok(
  not has_table_privilege('service_role', 'public.case_versions', 'INSERT')
  and not has_table_privilege('service_role', 'public.case_versions', 'UPDATE')
  and not has_table_privilege('service_role', 'public.case_versions', 'DELETE')
  and not has_table_privilege('service_role', 'public.assignments', 'INSERT')
  and not has_table_privilege('service_role', 'public.blind_policies', 'INSERT'),
  'the service role cannot manufacture published cases or assignments with direct table writes'
);

select ok(
  not has_table_privilege('service_role', 'private.case_version_publications', 'INSERT')
  and not has_table_privilege('service_role', 'private.case_calibration_bindings', 'INSERT')
  and not has_table_privilege('service_role', 'private.assignment_provisioning', 'INSERT')
  and not has_table_privilege('service_role', 'private.assignment_canary_scan_receipts', 'INSERT')
  and not has_table_privilege('service_role', 'private.provisioning_transition_operations', 'INSERT'),
  'publication and provisioning records are writable only through controlled functions'
);

select ok(
  not exists (
    select 1
    from information_schema.columns
    where table_schema = 'private'
      and table_name = 'assignment_canary_scan_receipts'
      and column_name in ('canary', 'canaries', 'canary_value', 'raw_canaries', 'content')
  ),
  'the durable clean-scan receipt stores only a canary-set digest, never raw canaries'
);

insert into auth.users (
  id, email, aud, role, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('31000000-0000-4000-8000-000000000001', 'author@example.test', 'authenticated', 'authenticated', '{}', '{}', now(), now()),
  ('31000000-0000-4000-8000-000000000002', 'student-one@example.test', 'authenticated', 'authenticated', '{}', '{}', now(), now()),
  ('31000000-0000-4000-8000-000000000003', 'student-two@example.test', 'authenticated', 'authenticated', '{}', '{}', now(), now()),
  ('31000000-0000-4000-8000-000000000004', 'untrusted@example.test', 'authenticated', 'authenticated', '{}', '{}', now(), now());

insert into auth.identities (
  id, provider_id, user_id, identity_data, provider, created_at, updated_at
) values
  ('32000000-0000-4000-8000-000000000001', '501', '31000000-0000-4000-8000-000000000001', '{"sub":"501","user_name":"case-author"}', 'github', now(), now()),
  ('32000000-0000-4000-8000-000000000002', '502', '31000000-0000-4000-8000-000000000002', '{"sub":"502","user_name":"student-one"}', 'github', now(), now()),
  ('32000000-0000-4000-8000-000000000003', '503', '31000000-0000-4000-8000-000000000003', '{"sub":"503","user_name":"student-two"}', 'github', now(), now()),
  ('32000000-0000-4000-8000-000000000004', '504', '31000000-0000-4000-8000-000000000004', '{"sub":"504","user_name":"untrusted"}', 'github', now(), now());

select lives_ok(
  $$ select private.sync_github_identity(id) from auth.users where id::text like '31000000%' $$,
  'immutable provider identities are available for the local approval and assignment proof'
);

insert into private.case_author_grants (staff_identity_id, case_id)
select id, 'synthetic-publication'
from public.github_identities
where github_user_id = 501;

insert into private.provisioning_configuration (
  repository_owner, template_commit, configured_by_identity_id
) select
  'Volta-Labs-Inc',
  repeat('d', 40),
  id
from public.github_identities
where github_user_id = 501
on conflict (singleton) do nothing;

create temp table issue03_fixture (
  visible_text text,
  visible_digest text,
  protected_text text,
  protected_digest text,
  methodology jsonb,
  requirements jsonb,
  materialization jsonb,
  manifest_digest text,
  calibration_artifacts jsonb,
  draft_preview_digest text
);

insert into issue03_fixture (
  visible_text,
  methodology,
  requirements
) values (
  private.canonical_jsonb_text('{"assessmentUse":"assessed","caseId":"synthetic-publication","versionLabel":"v1"}'::jsonb),
  '{"capturedAt":"2026-09-04T12:00:00.000Z","source":"synthetic methodology","sourceDigest":"sha256:1111111111111111111111111111111111111111111111111111111111111111"}',
  '{"capturedAt":"2026-09-04T12:00:00.000Z","source":"synthetic requirements","sourceDigest":"sha256:2222222222222222222222222222222222222222222222222222222222222222"}'
);

update issue03_fixture
set visible_digest = private.sha256_text(visible_text),
    calibration_artifacts = jsonb_build_array(
      jsonb_build_object(
        'class', 'effective',
        'canonicalArtifactText', private.canonical_jsonb_text('{"rating":"effective"}'::jsonb),
        'artifactDigest', private.sha256_text(private.canonical_jsonb_text('{"rating":"effective"}'::jsonb))
      ),
      jsonb_build_object(
        'class', 'partially-effective',
        'canonicalArtifactText', private.canonical_jsonb_text('{"rating":"partially-effective"}'::jsonb),
        'artifactDigest', private.sha256_text(private.canonical_jsonb_text('{"rating":"partially-effective"}'::jsonb))
      ),
      jsonb_build_object(
        'class', 'not-yet-effective',
        'canonicalArtifactText', private.canonical_jsonb_text('{"rating":"not-yet-effective"}'::jsonb),
        'artifactDigest', private.sha256_text(private.canonical_jsonb_text('{"rating":"not-yet-effective"}'::jsonb))
      )
    );

update issue03_fixture
set protected_text = private.canonical_jsonb_text(
      jsonb_build_object(
        'calibrationAnchors', (
          select jsonb_agg(
            jsonb_build_object(
              'artifactDigest', item ->> 'artifactDigest',
              'class', item ->> 'class',
              'rationale', 'Synthetic local calibration'
            ) order by item ->> 'class'
          )
          from jsonb_array_elements(calibration_artifacts) item
        )
      )
    ),
    manifest_digest = private.sha256_text(
      private.canonical_jsonb_text(
        jsonb_build_array(
          jsonb_build_object(
            'byteLength', 12,
            'digest', private.sha256_text(E'# Synthetic\n'),
            'path', 'README.md'
          )
        )
      )
    );

update issue03_fixture
set protected_digest = private.sha256_text(protected_text),
    materialization = jsonb_build_object(
      'manifestDigest', manifest_digest,
      'files', jsonb_build_array(
        jsonb_build_object(
          'path', 'README.md',
          'mediaType', 'text/markdown',
          'byteLength', 12,
          'digest', private.sha256_text(E'# Synthetic\n'),
          'content', E'# Synthetic\n'
        )
      )
    );

update issue03_fixture
set draft_preview_digest = private.sha256_text(
  private.canonical_jsonb_text(
    jsonb_build_object(
      'approvedAt', null,
      'approvedBy', null,
      'caseId', 'synthetic-publication',
      'methodologySnapshot', methodology,
      'protectedPackageDigest', protected_digest,
      'requirementsSnapshot', requirements,
      'status', 'draft',
      'versionLabel', 'v1',
      'visibleBundleDigest', visible_digest
    )
  )
);

select ok(
  private.student_materialization_is_valid(materialization, manifest_digest),
  'student repository materialization binds exact bytes, lengths, paths, and a recomputed manifest digest'
) from issue03_fixture;

select is(
  manifest_digest,
  'sha256:128b254472f60b820f2cb328b4e314ba95a4bd4639add0c7d279641cf347898a',
  'database and TypeScript compute the same manifest digest for the ASCII materialization contract'
) from issue03_fixture;

select ok(
  not private.student_materialization_is_valid(
    jsonb_set(materialization, '{files,0,path}', '"ＲEADME.md"'),
    manifest_digest
  ),
  'non-ASCII and confusable materialization paths are rejected before hashing'
) from issue03_fixture;

select ok(
  not private.student_materialization_is_valid(
    jsonb_set(materialization, '{files,0,mediaType}', '"application/octet-stream"'),
    manifest_digest
  ),
  'student repository files are limited to the explicitly supported text media types'
) from issue03_fixture;

select ok(
  not private.student_materialization_is_valid(
    jsonb_build_object(
      'manifestDigest', manifest_digest,
      'files', (
        select jsonb_agg(jsonb_build_object(
          'path', 'file-' || lpad(item::text, 3, '0') || '.txt',
          'mediaType', 'text/plain',
          'byteLength', 0,
          'digest', private.sha256_text(''),
          'content', ''
        ) order by item)
        from generate_series(1, 201) item
      )
    ),
    manifest_digest
  ),
  'student repository materialization rejects more than 200 files'
) from issue03_fixture;

select ok(
  not private.student_materialization_is_valid(
    jsonb_set(materialization, '{files,0,byteLength}', '5000001'),
    manifest_digest
  ),
  'student repository materialization rejects a file larger than five million bytes'
) from issue03_fixture;

with large_files as (
  select jsonb_agg(jsonb_build_object(
    'path', chr(96 + item) || '.txt',
    'mediaType', 'text/plain',
    'byteLength', 4000000,
    'digest', private.sha256_text(repeat('x', 4000000)),
    'content', repeat('x', 4000000)
  ) order by item) as files
  from generate_series(1, 3) item
), large_manifest as (
  select files, private.sha256_text(private.canonical_jsonb_text(
    (
      select jsonb_agg(jsonb_build_object(
        'byteLength', (entry.value ->> 'byteLength')::bigint,
        'digest', entry.value ->> 'digest',
        'path', entry.value ->> 'path'
      ) order by entry.ordinality)
      from jsonb_array_elements(files) with ordinality entry(value, ordinality)
    )
  )) as digest
  from large_files
)
select ok(
  not private.student_materialization_is_valid(
    jsonb_build_object('manifestDigest', digest, 'files', files),
    digest
  ),
  'student repository materialization rejects more than ten million total bytes'
) from large_manifest;

select throws_ok(
  $$
    select private.record_case_validation(
      '31000000-0000-4000-8000-000000000004', 'unauthorized-validation',
      'synthetic-publication', 'v1', visible_text, visible_digest, materialization,
      manifest_digest, protected_text, protected_digest, draft_preview_digest,
      methodology, requirements, calibration_artifacts, true, '[]'
    ) from issue03_fixture
  $$,
  '42501',
  'Case validation requires authorized non-blind staff',
  'an authenticated person without the case-author grant cannot validate a case'
);

select throws_ok(
  $$
    select private.record_case_validation(
      '31000000-0000-4000-8000-000000000001', 'arbitrary-preview-digest',
      'synthetic-publication', 'v1', visible_text, visible_digest, materialization,
      manifest_digest, protected_text, protected_digest,
      'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      methodology, requirements, calibration_artifacts, true, '[]'
    ) from issue03_fixture
  $$,
  '55000',
  'Draft preview digest does not match the exact validated material',
  'a caller cannot swap an arbitrary valid-looking case digest for the recomputed draft preview'
);

select throws_ok(
  $$
    select private.record_case_validation(
      '31000000-0000-4000-8000-000000000001', 'noncanonical-visible',
      'synthetic-publication', 'v1',
      '{ "versionLabel": "v1", "caseId": "synthetic-publication", "assessmentUse": "assessed" }',
      private.sha256_text('{ "versionLabel": "v1", "caseId": "synthetic-publication", "assessmentUse": "assessed" }'),
      materialization, manifest_digest, protected_text, protected_digest,
      draft_preview_digest, methodology, requirements, calibration_artifacts, true, '[]'
    ) from issue03_fixture
  $$,
  '22023',
  'Validation material or digest is invalid',
  'whitespace or key-order variants cannot create a digest core would interpret differently'
);

select throws_ok(
  $$
    select private.record_case_validation(
      '31000000-0000-4000-8000-000000000001', 'forged-calibration',
      'synthetic-publication', 'v1', visible_text, visible_digest, materialization,
      manifest_digest, protected_text, protected_digest, draft_preview_digest,
      methodology, requirements,
      jsonb_set(calibration_artifacts, '{0,artifactDigest}', '"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"'),
      true, '[]'
    ) from issue03_fixture
  $$,
  '22023',
  'Validation material or digest is invalid',
  'calibration hashes must match the stored calibration bytes and protected anchors'
);

create temp table issue03_state (key text primary key, value text not null);

insert into issue03_state
select 'invalid_validation', private.record_case_validation(
  '31000000-0000-4000-8000-000000000001', 'invalid-validation',
  'synthetic-publication', 'v1', visible_text, visible_digest, materialization,
  manifest_digest, protected_text, protected_digest, draft_preview_digest,
  methodology, requirements, calibration_artifacts, false, '["synthetic error"]'
)::text from issue03_fixture;

select throws_ok(
  $$
    select * from private.approve_case_version(
      '31000000-0000-4000-8000-000000000001',
      (select value::uuid from issue03_state where key = 'invalid_validation'),
      'approve-invalid',
      (select visible_digest from issue03_fixture),
      (select manifest_digest from issue03_fixture),
      (select protected_digest from issue03_fixture),
      (select draft_preview_digest from issue03_fixture)
    )
  $$,
  '55000',
  'Validation is invalid, stale, uncalibrated, superseded, or already used',
  'a failed validation cannot be approved'
);

insert into issue03_state
select 'valid_validation', private.record_case_validation(
  '31000000-0000-4000-8000-000000000001', 'valid-validation',
  'synthetic-publication', 'v1', visible_text, visible_digest, materialization,
  manifest_digest, protected_text, protected_digest, draft_preview_digest,
  methodology, requirements, calibration_artifacts, true, '[]'
)::text from issue03_fixture;

select is(
  private.record_case_validation(
    '31000000-0000-4000-8000-000000000001', 'valid-validation',
    'synthetic-publication', 'v1', visible_text, visible_digest, materialization,
    manifest_digest, protected_text, protected_digest, draft_preview_digest,
    methodology, requirements, calibration_artifacts, true, '[]'
  )::text,
  (select value from issue03_state where key = 'valid_validation'),
  'the same validation operation safely returns the existing exact record'
) from issue03_fixture;

select throws_ok(
  $$
    select * from private.approve_case_version(
      '31000000-0000-4000-8000-000000000001',
      (select value::uuid from issue03_state where key = 'valid_validation'),
      'approve-material-change',
      'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      (select manifest_digest from issue03_fixture),
      (select protected_digest from issue03_fixture),
      (select draft_preview_digest from issue03_fixture)
    )
  $$,
  '55000',
  'Approval digest does not match the validated material',
  'a visible material change invalidates approval of the prior validation'
);

select throws_ok(
  $$
    select * from private.approve_case_version(
      '31000000-0000-4000-8000-000000000001',
      (select value::uuid from issue03_state where key = 'valid_validation'),
      'approve-protected-change',
      (select visible_digest from issue03_fixture),
      (select manifest_digest from issue03_fixture),
      'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      (select draft_preview_digest from issue03_fixture)
    )
  $$,
  '55000',
  'Approval digest does not match the validated material',
  'a protected material change invalidates approval of the prior validation'
);

create temp table issue03_publication as
select approval.*
from issue03_fixture fixture
cross join lateral private.approve_case_version(
  '31000000-0000-4000-8000-000000000001',
  (select value::uuid from issue03_state where key = 'valid_validation'),
  'approve-valid', fixture.visible_digest, fixture.manifest_digest,
  fixture.protected_digest, fixture.draft_preview_digest
) approval;

select is((select count(*) from issue03_publication), 1::bigint, 'one exact publication is created');
select is(
  (select count(*) from public.case_versions where case_id = 'synthetic-publication'),
  1::bigint,
  'the public immutable version commits atomically'
);
select is(
  (select count(*) from private.case_version_publications where case_id = 'synthetic-publication'),
  1::bigint,
  'the exact private publication receipt commits atomically'
);
select is(
  (
    select count(*)
    from private.case_calibration_bindings binding
    join private.case_version_publications publication
      on publication.case_version_id = binding.case_version_id
    where publication.case_id = 'synthetic-publication'
  ),
  3::bigint,
  'exactly three calibration bindings commit with publication'
);

select ok(
  publication.case_version_digest <> fixture.draft_preview_digest
  and publication.case_version_digest = private.sha256_text(
    private.canonical_jsonb_text(
      jsonb_build_object(
        'approvedAt', to_char(publication.approved_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'approvedBy', publication.approved_by,
        'caseId', 'synthetic-publication',
        'methodologySnapshot', fixture.methodology,
        'protectedPackageDigest', fixture.protected_digest,
        'requirementsSnapshot', fixture.requirements,
        'status', 'approved',
        'versionLabel', 'v1',
        'visibleBundleDigest', fixture.visible_digest
      )
    )
  ),
  'approval creates the final digest from exact content, approver, approval time, and approved status'
) from issue03_publication publication cross join issue03_fixture fixture;

select ok(
  publication.canonical_student_text = fixture.visible_text
  and publication.canonical_protected_text = fixture.protected_text
  and publication.student_materialization = fixture.materialization
  and publication.methodology_snapshot = fixture.methodology
  and publication.requirements_snapshot = fixture.requirements
  and publication.approver_identity_id = (
    select id from public.github_identities where github_user_id = 501
  )
  and (publication.canonical_approved_source_text::jsonb ->> 'status') = 'approved',
  'publication retains the exact validated packages, source snapshots, repository files, and human approver'
) from private.case_version_publications publication cross join issue03_fixture fixture
where publication.case_id = 'synthetic-publication';

select ok(
  (
    select bool_and(
      binding.artifact_digest = private.sha256_text(artifact.canonical_artifact_text)
    )
    from private.case_calibration_bindings binding
    join private.case_version_publications publication
      on publication.case_version_id = binding.case_version_id
     and publication.case_id = 'synthetic-publication'
    join private.case_validation_calibration_artifacts artifact
      on artifact.validation_id = (select value::uuid from issue03_state where key = 'valid_validation')
     and artifact.calibration_class = binding.calibration_class
  ),
  'published calibration digests remain bound to the stored calibration artifact bytes'
);

select results_eq(
  $$ select case_version_id::text, case_version_digest, approved_at::text, approved_by
     from private.approve_case_version(
       '31000000-0000-4000-8000-000000000001',
       (select value::uuid from issue03_state where key = 'valid_validation'),
       'approve-valid',
       (select visible_digest from issue03_fixture),
       (select manifest_digest from issue03_fixture),
       (select protected_digest from issue03_fixture),
       (select draft_preview_digest from issue03_fixture)
     ) $$,
  $$ select case_version_id::text, case_version_digest, approved_at::text, approved_by
     from issue03_publication $$,
  'an approval retry after a lost response returns the same immutable publication'
);

select throws_ok(
  $$
    select * from private.approve_case_version(
      '31000000-0000-4000-8000-000000000001',
      (select value::uuid from issue03_state where key = 'valid_validation'),
      'approve-valid',
      'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      (select manifest_digest from issue03_fixture),
      (select protected_digest from issue03_fixture),
      (select draft_preview_digest from issue03_fixture)
    )
  $$,
  '40001',
  'Approval operation payload conflict or actor is unauthorized',
  'an approval retry cannot reuse its operation id for different material'
);

select throws_ok(
  $$
    select * from private.approve_case_version(
      '31000000-0000-4000-8000-000000000001',
      (select value::uuid from issue03_state where key = 'valid_validation'),
      'approve-already-used',
      (select visible_digest from issue03_fixture),
      (select manifest_digest from issue03_fixture),
      (select protected_digest from issue03_fixture),
      (select draft_preview_digest from issue03_fixture)
    )
  $$,
  '55000',
  'Validation is invalid, stale, uncalibrated, superseded, or already used',
  'a consumed validation cannot manufacture another publication under a new operation id'
);

create temp table issue03_supersede as
select
  private.canonical_jsonb_text(
    jsonb_set(visible_text::jsonb, '{versionLabel}', '"v2"')
  ) as visible_text,
  protected_text,
  protected_digest,
  methodology,
  requirements,
  materialization,
  manifest_digest,
  calibration_artifacts
from issue03_fixture;
alter table issue03_supersede add column visible_digest text;
alter table issue03_supersede add column draft_preview_digest text;
update issue03_supersede set visible_digest = private.sha256_text(visible_text);
update issue03_supersede set draft_preview_digest = private.sha256_text(
  private.canonical_jsonb_text(jsonb_build_object(
    'approvedAt', null,
    'approvedBy', null,
    'caseId', 'synthetic-publication',
    'methodologySnapshot', methodology,
    'protectedPackageDigest', protected_digest,
    'requirementsSnapshot', requirements,
    'status', 'draft',
    'versionLabel', 'v2',
    'visibleBundleDigest', visible_digest
  ))
);

insert into issue03_state
select 'superseded_validation', private.record_case_validation(
  '31000000-0000-4000-8000-000000000001', 'superseded-validation',
  'synthetic-publication', 'v2', visible_text, visible_digest, materialization,
  manifest_digest, protected_text, protected_digest, draft_preview_digest,
  methodology, requirements, calibration_artifacts, true, '[]'
)::text from issue03_supersede;
select private.record_case_validation(
  '31000000-0000-4000-8000-000000000001', 'replacement-validation',
  'synthetic-publication', 'v2', visible_text, visible_digest, materialization,
  manifest_digest, protected_text, protected_digest, draft_preview_digest,
  methodology, requirements, calibration_artifacts, true, '[]'
) from issue03_supersede;

select throws_ok(
  $$
    select * from private.approve_case_version(
      '31000000-0000-4000-8000-000000000001',
      (select value::uuid from issue03_state where key = 'superseded_validation'),
      'approve-superseded',
      (select visible_digest from issue03_supersede),
      (select manifest_digest from issue03_supersede),
      (select protected_digest from issue03_supersede),
      (select draft_preview_digest from issue03_supersede)
    )
  $$,
  '55000',
  'Validation is invalid, stale, uncalibrated, superseded, or already used',
  'a later successful validation supersedes the earlier approval input'
);

insert into issue03_state
select 'assignment_one', assignment_id::text
from issue03_fixture fixture
cross join lateral private.reserve_assignment(
  '31000000-0000-4000-8000-000000000001', 'reserve-one',
  (select case_version_digest from issue03_publication), 502,
  'Volta-Labs-Inc', repeat('d', 40), fixture.visible_digest,
  fixture.materialization, fixture.manifest_digest
);

select is(
  reservation.assignment_id::text,
  (select value from issue03_state where key = 'assignment_one'),
  'the same reservation operation returns the same assignment'
) from issue03_fixture fixture
cross join lateral private.reserve_assignment(
  '31000000-0000-4000-8000-000000000001', 'reserve-one',
  (select case_version_digest from issue03_publication), 502,
  'Volta-Labs-Inc', repeat('d', 40), fixture.visible_digest,
  fixture.materialization, fixture.manifest_digest
) reservation;

select throws_ok(
  $$
    select * from private.reserve_assignment(
      '31000000-0000-4000-8000-000000000001', 'reserve-one',
      (select case_version_digest from issue03_publication), 503,
      'Volta-Labs-Inc', repeat('d', 40),
      (select visible_digest from issue03_fixture),
      (select materialization from issue03_fixture),
      (select manifest_digest from issue03_fixture)
    )
  $$,
  '40001',
  'Assignment operation payload conflict',
  'a reservation operation id cannot be reused for another student'
);

select throws_ok(
  $$
    select * from private.reserve_assignment(
      '31000000-0000-4000-8000-000000000001', 'wrong-owner',
      (select case_version_digest from issue03_publication), 503,
      'Other-Owner', repeat('d', 40),
      (select visible_digest from issue03_fixture),
      (select materialization from issue03_fixture),
      (select manifest_digest from issue03_fixture)
    )
  $$,
  '22023',
  'Assignment reservation payload is invalid or stale',
  'the caller cannot choose an untrusted repository owner'
);

select throws_ok(
  $$
    select * from private.reserve_assignment(
      '31000000-0000-4000-8000-000000000001', 'wrong-template',
      (select case_version_digest from issue03_publication), 503,
      'Volta-Labs-Inc', repeat('e', 40),
      (select visible_digest from issue03_fixture),
      (select materialization from issue03_fixture),
      (select manifest_digest from issue03_fixture)
    )
  $$,
  '22023',
  'Assignment reservation payload is invalid or stale',
  'the caller cannot choose an untrusted template commit'
);

insert into issue03_state
select 'assignment_two', assignment_id::text
from issue03_fixture fixture
cross join lateral private.reserve_assignment(
  '31000000-0000-4000-8000-000000000001', 'reserve-two',
  (select case_version_digest from issue03_publication), 503,
  'Volta-Labs-Inc', repeat('d', 40), fixture.visible_digest,
  fixture.materialization, fixture.manifest_digest
);

select ok(
  one.assignment_id <> two.assignment_id
  and one.repository_name <> two.repository_name
  and one.student_bundle_digest = two.student_bundle_digest
  and one.student_manifest_digest = two.student_manifest_digest,
  'two students receive isolated assignments with the same exact starting material'
) from private.assignment_provisioning one
join private.assignment_provisioning two on one.assignment_id <> two.assignment_id
where one.assignment_id = (select value::uuid from issue03_state where key = 'assignment_one')
  and two.assignment_id = (select value::uuid from issue03_state where key = 'assignment_two');

select is(
  private.student_assignment_is_ready(
    '31000000-0000-4000-8000-000000000002',
    (select value::uuid from issue03_state where key = 'assignment_one')
  ),
  false,
  'student service readiness is false before invitation acceptance and repository readback'
);

create temp table issue03_readback as
select jsonb_agg(
  jsonb_build_object(
    'byteLength', (entry.value ->> 'byteLength')::bigint,
    'digest', entry.value ->> 'digest',
    'path', entry.value ->> 'path'
  ) order by entry.ordinality
) as files
from issue03_fixture fixture,
jsonb_array_elements(fixture.materialization -> 'files') with ordinality entry(value, ordinality);

select throws_ok(
  $$
    select private.record_assignment_provisioning(
      '31000000-0000-4000-8000-000000000001',
      'transition-public-rejected',
      (select value::uuid from issue03_state where key = 'assignment_one'),
      'provisioning', 'repository_created', 9001, false,
      'Volta-Labs-Inc', (select repository_name from private.assignment_provisioning where assignment_id = (select value::uuid from issue03_state where key = 'assignment_one')),
      repeat('d', 40), repeat('f', 40), (select visible_digest from issue03_fixture),
      (select manifest_digest from issue03_fixture), (select files from issue03_readback),
      null, null, null, null, 'none', null, null, null
    )
  $$,
  '55000',
  'Repository readback does not match the reservation',
  'a public repository never advances provisioning'
);

select throws_ok(
  $$
    select private.record_assignment_provisioning(
      '31000000-0000-4000-8000-000000000001',
      'transition-owner-rejected',
      (select value::uuid from issue03_state where key = 'assignment_one'),
      'provisioning', 'repository_created', 9001, true,
      'Wrong-Owner', (select repository_name from private.assignment_provisioning where assignment_id = (select value::uuid from issue03_state where key = 'assignment_one')),
      repeat('d', 40), repeat('f', 40), (select visible_digest from issue03_fixture),
      (select manifest_digest from issue03_fixture), (select files from issue03_readback),
      null, null, null, null, 'none', null, null, null
    )
  $$,
  '55000',
  'Repository readback does not match the reservation',
  'a wrong repository owner never advances provisioning'
);

select lives_ok(
  $$
    select private.record_assignment_provisioning(
      '31000000-0000-4000-8000-000000000001',
      'transition-repository-created',
      (select value::uuid from issue03_state where key = 'assignment_one'),
      'provisioning', 'repository_created', 9001, true,
      'Volta-Labs-Inc', (select repository_name from private.assignment_provisioning where assignment_id = (select value::uuid from issue03_state where key = 'assignment_one')),
      repeat('d', 40), repeat('f', 40), (select visible_digest from issue03_fixture),
      (select manifest_digest from issue03_fixture), (select files from issue03_readback),
      null, null, null, null, 'none', null, null, null
    )
  $$,
  'exact private repository creation readback advances the durable state'
);

select throws_ok(
  $$
    select private.record_assignment_provisioning(
      '31000000-0000-4000-8000-000000000001',
      'transition-invite-without-scan',
      (select value::uuid from issue03_state where key = 'assignment_one'),
      'repository_created', 'invitation_pending', 9001, true,
      'Volta-Labs-Inc', (select repository_name from private.assignment_provisioning where assignment_id = (select value::uuid from issue03_state where key = 'assignment_one')),
      repeat('d', 40), repeat('f', 40), (select visible_digest from issue03_fixture),
      (select manifest_digest from issue03_fixture), (select files from issue03_readback),
      'student-renamed', 502, 'push', 'invite-1', 'pending', null, null, null
    )
  $$,
  '55000',
  'Invitation requires an exact immutable clean scan receipt',
  'an invitation cannot be recorded before the exact repository snapshot has a clean scan receipt'
);

insert into issue03_state
select 'scan_one', private.record_clean_canary_scan(
  '31000000-0000-4000-8000-000000000001',
  'scan-assignment-one',
  (select value::uuid from issue03_state where key = 'assignment_one'),
  9001,
  'Volta-Labs-Inc',
  (select repository_name from private.assignment_provisioning where assignment_id = (select value::uuid from issue03_state where key = 'assignment_one')),
  'pre_invitation',
  repeat('d', 40),
  repeat('f', 40),
  (select visible_digest from issue03_fixture),
  (select manifest_digest from issue03_fixture),
  (select files from issue03_readback),
  'sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
  'sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
  'git-all-reachable-v1',
  statement_timestamp()
)::text;

select is(
  private.record_clean_canary_scan(
    '31000000-0000-4000-8000-000000000001',
    'scan-assignment-one',
    (select value::uuid from issue03_state where key = 'assignment_one'),
    9001,
    'Volta-Labs-Inc',
    (select repository_name from private.assignment_provisioning where assignment_id = (select value::uuid from issue03_state where key = 'assignment_one')),
    'pre_invitation',
    repeat('d', 40),
    repeat('f', 40),
    (select visible_digest from issue03_fixture),
    (select manifest_digest from issue03_fixture),
    (select files from issue03_readback),
    'sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
    'sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
    'git-all-reachable-v1',
    (select scanned_at from private.assignment_canary_scan_receipts where id = (select value::uuid from issue03_state where key = 'scan_one'))
  )::text,
  (select value from issue03_state where key = 'scan_one'),
  'an exact lost-response scan retry returns the original immutable receipt'
);

select throws_ok(
  $$
    select private.record_clean_canary_scan(
      '31000000-0000-4000-8000-000000000001',
      'scan-assignment-one',
      (select value::uuid from issue03_state where key = 'assignment_two'),
      9001,
      'Volta-Labs-Inc',
      (select repository_name from private.assignment_provisioning where assignment_id = (select value::uuid from issue03_state where key = 'assignment_one')),
      'pre_invitation', repeat('d', 40), repeat('f', 40),
      (select visible_digest from issue03_fixture),
      (select manifest_digest from issue03_fixture),
      (select files from issue03_readback),
      'sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
      'sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
      'git-all-reachable-v1',
      (select scanned_at from private.assignment_canary_scan_receipts where id = (select value::uuid from issue03_state where key = 'scan_one'))
    )
  $$,
  '40001',
  'Repository scan operation payload conflict',
  'a clean scan receipt cannot be replayed across assignments'
);

select throws_ok(
  $$
    select private.record_clean_canary_scan(
      '31000000-0000-4000-8000-000000000001',
      'scan-assignment-one-stale',
      (select value::uuid from issue03_state where key = 'assignment_one'),
      9001,
      'Volta-Labs-Inc',
      (select repository_name from private.assignment_provisioning where assignment_id = (select value::uuid from issue03_state where key = 'assignment_one')),
      'pre_invitation', repeat('d', 40), repeat('a', 40),
      (select visible_digest from issue03_fixture),
      (select manifest_digest from issue03_fixture),
      (select files from issue03_readback),
      'sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
      'sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
      'git-all-reachable-v1', statement_timestamp()
    )
  $$,
  '55000',
  'Repository scan receipt does not match the current provider snapshot',
  'a stale materialized commit cannot receive a clean scan receipt'
);

select throws_ok(
  $$
    select private.record_clean_canary_scan(
      '31000000-0000-4000-8000-000000000001',
      'scan-assignment-one-stale-time',
      (select value::uuid from issue03_state where key = 'assignment_one'),
      9001, 'Volta-Labs-Inc',
      (select repository_name from private.assignment_provisioning where assignment_id = (select value::uuid from issue03_state where key = 'assignment_one')),
      'pre_invitation', repeat('d', 40), repeat('f', 40),
      (select visible_digest from issue03_fixture),
      (select manifest_digest from issue03_fixture),
      (select files from issue03_readback),
      'sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
      'sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
      'git-all-reachable-v1', statement_timestamp() - interval '6 minutes'
    )
  $$,
  '22023',
  'Repository scan receipt is invalid',
  'a materially stale client scan time is rejected'
);

select throws_ok(
  $$
    select private.record_clean_canary_scan(
      '31000000-0000-4000-8000-000000000001',
      'scan-assignment-one-future-time',
      (select value::uuid from issue03_state where key = 'assignment_one'),
      9001, 'Volta-Labs-Inc',
      (select repository_name from private.assignment_provisioning where assignment_id = (select value::uuid from issue03_state where key = 'assignment_one')),
      'pre_invitation', repeat('d', 40), repeat('f', 40),
      (select visible_digest from issue03_fixture),
      (select manifest_digest from issue03_fixture),
      (select files from issue03_readback),
      'sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
      'sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
      'git-all-reachable-v1', statement_timestamp() + interval '2 minutes'
    )
  $$,
  '22023',
  'Repository scan receipt is invalid',
  'a materially future client scan time is rejected'
);

select lives_ok(
  $$
    select private.record_assignment_provisioning(
      '31000000-0000-4000-8000-000000000001',
      'transition-invitation-pending',
      (select value::uuid from issue03_state where key = 'assignment_one'),
      'repository_created', 'invitation_pending', 9001, true,
      'Volta-Labs-Inc', (select repository_name from private.assignment_provisioning where assignment_id = (select value::uuid from issue03_state where key = 'assignment_one')),
      repeat('d', 40), repeat('f', 40), (select visible_digest from issue03_fixture),
      (select manifest_digest from issue03_fixture), (select files from issue03_readback),
      'student-renamed', 502, 'push', 'invite-1', 'pending',
      (select value::uuid from issue03_state where key = 'scan_one'), null, null
    )
  $$,
  'pending invitation binds the exact clean snapshot, immutable GitHub id, current login, permission, and invitation id'
);

-- Simulate elapsed provider-review time without a six-minute test delay. The
-- append-only trigger is disabled only for this postgres-owned fixture update.
alter table private.assignment_canary_scan_receipts
  disable trigger assignment_canary_scan_receipts_are_append_only;
update private.assignment_canary_scan_receipts
set recorded_at = statement_timestamp() - interval '6 minutes'
where id = (select value::uuid from issue03_state where key = 'scan_one');
alter table private.assignment_canary_scan_receipts
  enable trigger assignment_canary_scan_receipts_are_append_only;

select throws_ok(
  $$
    select private.record_clean_canary_scan(
      '31000000-0000-4000-8000-000000000001',
      'scan-before-acceptance-rejected',
      (select value::uuid from issue03_state where key = 'assignment_one'),
      9001,
      'Volta-Labs-Inc',
      (select repository_name from private.assignment_provisioning where assignment_id = (select value::uuid from issue03_state where key = 'assignment_one')),
      'pre_ready', repeat('d', 40), repeat('f', 40),
      (select visible_digest from issue03_fixture),
      (select manifest_digest from issue03_fixture),
      (select files from issue03_readback),
      'sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
      'sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
      'git-all-reachable-v1', statement_timestamp()
    )
  $$,
  '55000',
  'Repository scan receipt does not match the current provider snapshot',
  'a pre-ready scan is rejected until the accepted invitation identity is durably read back'
);

select lives_ok(
  $$
    select private.record_assignment_provisioning(
      '31000000-0000-4000-8000-000000000001',
      'transition-invitation-accepted',
      (select value::uuid from issue03_state where key = 'assignment_one'),
      'invitation_pending', 'invitation_pending', 9001, true,
      'Volta-Labs-Inc', (select repository_name from private.assignment_provisioning where assignment_id = (select value::uuid from issue03_state where key = 'assignment_one')),
      repeat('d', 40), repeat('f', 40), (select visible_digest from issue03_fixture),
      (select manifest_digest from issue03_fixture), (select files from issue03_readback),
      'student-renamed', 502, 'push', 'invite-1', 'accepted',
      (select value::uuid from issue03_state where key = 'scan_one'), null, null
    )
  $$,
  'accepted invitation identity remains reconcilable after the historical invitation scan ages'
);

select throws_ok(
  $$
    select private.record_assignment_provisioning(
      '31000000-0000-4000-8000-000000000001',
      'transition-ready-without-fresh-scan',
      (select value::uuid from issue03_state where key = 'assignment_one'),
      'invitation_pending', 'ready', 9001, true,
      'Volta-Labs-Inc', (select repository_name from private.assignment_provisioning where assignment_id = (select value::uuid from issue03_state where key = 'assignment_one')),
      repeat('d', 40), repeat('f', 40), (select visible_digest from issue03_fixture),
      (select manifest_digest from issue03_fixture), (select files from issue03_readback),
      'student-renamed', 502, 'push', 'invite-1', 'accepted',
      (select value::uuid from issue03_state where key = 'scan_one'), null, null
    )
  $$,
  '55000',
  'Ready requires a fresh exact immutable clean scan receipt',
  'the earlier invitation scan cannot be reused to make an accepted assignment ready'
);

insert into issue03_state
select 'scan_ready_changed_state', private.record_clean_canary_scan(
  '31000000-0000-4000-8000-000000000001',
  'scan-assignment-one-ready-changed-state',
  (select value::uuid from issue03_state where key = 'assignment_one'),
  9001,
  'Volta-Labs-Inc',
  (select repository_name from private.assignment_provisioning where assignment_id = (select value::uuid from issue03_state where key = 'assignment_one')),
  'pre_ready', repeat('d', 40), repeat('f', 40),
  (select visible_digest from issue03_fixture),
  (select manifest_digest from issue03_fixture),
  (select files from issue03_readback),
  'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  'sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
  'git-all-reachable-v1', statement_timestamp()
)::text;

select throws_ok(
  $$
    select private.record_assignment_provisioning(
      '31000000-0000-4000-8000-000000000001',
      'transition-ready-changed-state',
      (select value::uuid from issue03_state where key = 'assignment_one'),
      'invitation_pending', 'ready', 9001, true,
      'Volta-Labs-Inc', (select repository_name from private.assignment_provisioning where assignment_id = (select value::uuid from issue03_state where key = 'assignment_one')),
      repeat('d', 40), repeat('f', 40), (select visible_digest from issue03_fixture),
      (select manifest_digest from issue03_fixture), (select files from issue03_readback),
      'student-renamed', 502, 'push', 'invite-1', 'accepted',
      (select value::uuid from issue03_state where key = 'scan_one'),
      (select value::uuid from issue03_state where key = 'scan_ready_changed_state'), null
    )
  $$,
  '55000',
  'Ready requires a fresh exact immutable clean scan receipt',
  'a changed hidden repository-state digest prevents readiness even after a clean scan result'
);

insert into issue03_state
select 'scan_ready_weaker_set', private.record_clean_canary_scan(
  '31000000-0000-4000-8000-000000000001',
  'scan-assignment-one-ready-weaker-set',
  (select value::uuid from issue03_state where key = 'assignment_one'),
  9001,
  'Volta-Labs-Inc',
  (select repository_name from private.assignment_provisioning where assignment_id = (select value::uuid from issue03_state where key = 'assignment_one')),
  'pre_ready', repeat('d', 40), repeat('f', 40),
  (select visible_digest from issue03_fixture),
  (select manifest_digest from issue03_fixture),
  (select files from issue03_readback),
  'sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
  'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  'git-all-reachable-v1', statement_timestamp()
)::text;

select throws_ok(
  $$
    select private.record_assignment_provisioning(
      '31000000-0000-4000-8000-000000000001',
      'transition-ready-weaker-set',
      (select value::uuid from issue03_state where key = 'assignment_one'),
      'invitation_pending', 'ready', 9001, true,
      'Volta-Labs-Inc', (select repository_name from private.assignment_provisioning where assignment_id = (select value::uuid from issue03_state where key = 'assignment_one')),
      repeat('d', 40), repeat('f', 40), (select visible_digest from issue03_fixture),
      (select manifest_digest from issue03_fixture), (select files from issue03_readback),
      'student-renamed', 502, 'push', 'invite-1', 'accepted',
      (select value::uuid from issue03_state where key = 'scan_one'),
      (select value::uuid from issue03_state where key = 'scan_ready_weaker_set'), null
    )
  $$,
  '55000',
  'Ready requires a fresh exact immutable clean scan receipt',
  'a weaker or different protected-canary set cannot authorize readiness'
);

insert into issue03_state
select 'scan_ready', private.record_clean_canary_scan(
  '31000000-0000-4000-8000-000000000001',
  'scan-assignment-one-ready',
  (select value::uuid from issue03_state where key = 'assignment_one'),
  9001,
  'Volta-Labs-Inc',
  (select repository_name from private.assignment_provisioning where assignment_id = (select value::uuid from issue03_state where key = 'assignment_one')),
  'pre_ready',
  repeat('d', 40),
  repeat('f', 40),
  (select visible_digest from issue03_fixture),
  (select manifest_digest from issue03_fixture),
  (select files from issue03_readback),
  'sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
  'sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
  'git-all-reachable-v1',
  statement_timestamp()
)::text;

select throws_ok(
  $$
    select private.record_assignment_provisioning(
      '31000000-0000-4000-8000-000000000001',
      'transition-provider-replaced',
      (select value::uuid from issue03_state where key = 'assignment_one'),
      'invitation_pending', 'ready', 9002, true,
      'Volta-Labs-Inc', (select repository_name from private.assignment_provisioning where assignment_id = (select value::uuid from issue03_state where key = 'assignment_one')),
      repeat('d', 40), repeat('f', 40), (select visible_digest from issue03_fixture),
      (select manifest_digest from issue03_fixture), (select files from issue03_readback),
      'student-renamed', 502, 'push', 'invite-1', 'accepted',
      (select value::uuid from issue03_state where key = 'scan_one'),
      (select value::uuid from issue03_state where key = 'scan_ready'), null
    )
  $$,
  '55000',
  'Repository provider identity cannot be replaced',
  'a retry cannot replace the repository provider identity'
);

select throws_ok(
  $$
    select private.record_assignment_provisioning(
      '31000000-0000-4000-8000-000000000001',
      'transition-invitation-replaced',
      (select value::uuid from issue03_state where key = 'assignment_one'),
      'invitation_pending', 'ready', 9001, true,
      'Volta-Labs-Inc', (select repository_name from private.assignment_provisioning where assignment_id = (select value::uuid from issue03_state where key = 'assignment_one')),
      repeat('d', 40), repeat('f', 40), (select visible_digest from issue03_fixture),
      (select manifest_digest from issue03_fixture), (select files from issue03_readback),
      'student-renamed', 502, 'push', 'invite-2', 'accepted',
      (select value::uuid from issue03_state where key = 'scan_one'),
      (select value::uuid from issue03_state where key = 'scan_ready'), null
    )
  $$,
  '55000',
  'Invitation identity cannot be replaced',
  'a retry cannot replace the invitation identity'
);

select throws_ok(
  $$
    select private.record_assignment_provisioning(
      '31000000-0000-4000-8000-000000000001',
      'transition-excess-permission',
      (select value::uuid from issue03_state where key = 'assignment_one'),
      'invitation_pending', 'ready', 9001, true,
      'Volta-Labs-Inc', (select repository_name from private.assignment_provisioning where assignment_id = (select value::uuid from issue03_state where key = 'assignment_one')),
      repeat('d', 40), repeat('f', 40), (select visible_digest from issue03_fixture),
      (select manifest_digest from issue03_fixture), (select files from issue03_readback),
      'student-renamed', 502, 'admin', 'invite-1', 'accepted',
      (select value::uuid from issue03_state where key = 'scan_one'),
      (select value::uuid from issue03_state where key = 'scan_ready'), null
    )
  $$,
  '55000',
  'Ready requires an accepted least-permission invitation',
  'excess collaborator permission prevents readiness'
);

select lives_ok(
  $$
    select private.record_assignment_provisioning(
      '31000000-0000-4000-8000-000000000001',
      'transition-ready',
      (select value::uuid from issue03_state where key = 'assignment_one'),
      'invitation_pending', 'ready', 9001, true,
      'Volta-Labs-Inc', (select repository_name from private.assignment_provisioning where assignment_id = (select value::uuid from issue03_state where key = 'assignment_one')),
      repeat('d', 40), repeat('f', 40), (select visible_digest from issue03_fixture),
      (select manifest_digest from issue03_fixture), (select files from issue03_readback),
      'student-renamed', 502, 'push', 'invite-1', 'accepted',
      (select value::uuid from issue03_state where key = 'scan_one'),
      (select value::uuid from issue03_state where key = 'scan_ready'), null
    )
  $$,
  'accepted invitation plus every exact repository and collaborator readback makes the assignment ready'
);

insert into issue03_state
select 'ready_at', ready_at::text
from private.assignment_provisioning
where assignment_id = (select value::uuid from issue03_state where key = 'assignment_one');

select lives_ok(
  $$
    select private.record_assignment_provisioning(
      '31000000-0000-4000-8000-000000000001',
      'transition-ready',
      (select value::uuid from issue03_state where key = 'assignment_one'),
      'invitation_pending', 'ready', 9001, true,
      'Volta-Labs-Inc', (select repository_name from private.assignment_provisioning where assignment_id = (select value::uuid from issue03_state where key = 'assignment_one')),
      repeat('d', 40), repeat('f', 40), (select visible_digest from issue03_fixture),
      (select manifest_digest from issue03_fixture), (select files from issue03_readback),
      'student-renamed', 502, 'push', 'invite-1', 'accepted',
      (select value::uuid from issue03_state where key = 'scan_one'),
      (select value::uuid from issue03_state where key = 'scan_ready'), null
    )
  $$,
  'an exact ready-state retry is idempotent'
);

select is(
  (select ready_at::text from private.assignment_provisioning where assignment_id = (select value::uuid from issue03_state where key = 'assignment_one')),
  (select value from issue03_state where key = 'ready_at'),
  'a ready-state retry preserves the original readiness time'
);

select ok(
  (
    select count(*) = 4
    from private.provisioning_attempts
    where assignment_id = (select value::uuid from issue03_state where key = 'assignment_one')
  )
  and (
    select count(*) = 4
    from private.provisioning_transition_operations
    where assignment_id = (select value::uuid from issue03_state where key = 'assignment_one')
  ),
  'lost-response replay returns the original transition without another state change, attempt, or receipt'
);

select throws_ok(
  $$
    select private.record_assignment_provisioning(
      '31000000-0000-4000-8000-000000000001',
      'transition-ready',
      (select value::uuid from issue03_state where key = 'assignment_one'),
      'invitation_pending', 'ready', 9001, true,
      'Volta-Labs-Inc', (select repository_name from private.assignment_provisioning where assignment_id = (select value::uuid from issue03_state where key = 'assignment_one')),
      repeat('d', 40), repeat('f', 40), (select visible_digest from issue03_fixture),
      (select manifest_digest from issue03_fixture), (select files from issue03_readback),
      'different-login', 502, 'push', 'invite-1', 'accepted',
      (select value::uuid from issue03_state where key = 'scan_one'),
      (select value::uuid from issue03_state where key = 'scan_ready'), null
    )
  $$,
  '40001',
  'Provisioning operation payload conflict',
  'an operation id cannot be replayed with any consequential input changed'
);

select ok(
  private.student_assignment_is_ready(
    '31000000-0000-4000-8000-000000000002',
    (select value::uuid from issue03_state where key = 'assignment_one')
  )
  and not private.student_assignment_is_ready(
    '31000000-0000-4000-8000-000000000003',
    (select value::uuid from issue03_state where key = 'assignment_one')
  ),
  'readiness is bound to the accepted immutable student identity and denied cross-assignment'
);

select throws_ok(
  $$ update private.case_version_publications set approved_by = 'forged' $$,
  '55000',
  'case_version_publications records are append-only',
  'the exact publication record cannot be rewritten'
);

select throws_ok(
  $$ update private.case_validation_calibration_artifacts set canonical_artifact_text = '{"forged":true}' $$,
  '55000',
  'case_validation_calibration_artifacts records are append-only',
  'stored calibration artifact bytes cannot be rewritten after validation'
);

insert into issue03_state
select 'author_assignment', assignment_id::text
from issue03_fixture fixture
cross join lateral private.reserve_assignment(
  '31000000-0000-4000-8000-000000000001', 'reserve-author-as-blind-student',
  (select case_version_digest from issue03_publication), 501,
  'Volta-Labs-Inc', repeat('d', 40), fixture.visible_digest,
  fixture.materialization, fixture.manifest_digest
);

select throws_ok(
  $$
    select private.record_case_validation(
      '31000000-0000-4000-8000-000000000001', 'blind-author-validation',
      'synthetic-publication', 'v1', visible_text, visible_digest, materialization,
      manifest_digest, protected_text, protected_digest, draft_preview_digest,
      methodology, requirements, calibration_artifacts, true, '[]'
    ) from issue03_fixture
  $$,
  '42501',
  'Case validation requires authorized non-blind staff',
  'an authorized case author becomes ineligible while they are the blind assignee'
);

select * from finish();
rollback;
