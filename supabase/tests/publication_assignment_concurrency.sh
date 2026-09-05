#!/usr/bin/env bash
set -euo pipefail

sim_root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
sim_db_container="supabase_db_volta-simulation-harness"
sim_first_output="$(mktemp)"
sim_second_output="$(mktemp)"

cleanup_files() {
  rm -f "$sim_first_output" "$sim_second_output"
}
trap cleanup_files EXIT

cd "$sim_root_dir"
supabase db reset --local >/dev/null

docker exec -i "$sim_db_container" psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 <<'SQL' >/dev/null
insert into auth.users (
  id, email, aud, role, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('71000000-0000-4000-8000-000000000001', 'concurrent-author@example.test', 'authenticated', 'authenticated', '{}', '{}', now(), now()),
  ('71000000-0000-4000-8000-000000000002', 'concurrent-student@example.test', 'authenticated', 'authenticated', '{}', '{}', now(), now());

insert into auth.identities (
  id, provider_id, user_id, identity_data, provider, created_at, updated_at
) values
  ('72000000-0000-4000-8000-000000000001', '701', '71000000-0000-4000-8000-000000000001', '{"sub":"701","user_name":"concurrent-author"}', 'github', now(), now()),
  ('72000000-0000-4000-8000-000000000002', '702', '71000000-0000-4000-8000-000000000002', '{"sub":"702","user_name":"concurrent-student"}', 'github', now(), now());

select private.sync_github_identity('71000000-0000-4000-8000-000000000001');
select private.sync_github_identity('71000000-0000-4000-8000-000000000002');

insert into private.case_author_grants (staff_identity_id, case_id)
select id, 'concurrent-case' from public.github_identities where github_user_id = 701;

insert into private.provisioning_configuration (
  repository_owner, template_commit, configured_by_identity_id
) select 'Volta-Labs-Inc', repeat('d', 40), id
from public.github_identities where github_user_id = 701;

do $$
declare
  visible_text text := '{"caseId":"concurrent-case","versionLabel":"v1"}';
  visible_digest text := private.sha256_text(visible_text);
  effective_text text := '{"rating":"effective"}';
  partial_text text := '{"rating":"partially-effective"}';
  not_yet_text text := '{"rating":"not-yet-effective"}';
  protected_text text;
  protected_digest text;
  manifest_digest text;
  materialization jsonb;
begin
  protected_text := private.canonical_jsonb_text(jsonb_build_object(
    'calibrationAnchors', jsonb_build_array(
      jsonb_build_object('class', 'effective', 'artifactDigest', private.sha256_text(effective_text), 'rationale', 'synthetic'),
      jsonb_build_object('class', 'partially-effective', 'artifactDigest', private.sha256_text(partial_text), 'rationale', 'synthetic'),
      jsonb_build_object('class', 'not-yet-effective', 'artifactDigest', private.sha256_text(not_yet_text), 'rationale', 'synthetic')
    )
  ));
  protected_digest := private.sha256_text(protected_text);
  manifest_digest := private.sha256_text(private.canonical_jsonb_text(jsonb_build_array(
    jsonb_build_object(
      'byteLength', 12,
      'digest', private.sha256_text(E'# Synthetic\n'),
      'path', 'README.md'
    )
  )));
  materialization := jsonb_build_object(
    'manifestDigest', manifest_digest,
    'files', jsonb_build_array(jsonb_build_object(
      'path', 'README.md', 'mediaType', 'text/markdown', 'byteLength', 12,
      'digest', private.sha256_text(E'# Synthetic\n'), 'content', E'# Synthetic\n'
    ))
  );

  insert into private.case_validations (
    id, client_operation_id, operation_digest, case_id, version_label,
    canonical_student_text, student_bundle_digest, student_materialization,
    student_manifest_digest, canonical_protected_text, protected_package_digest,
    draft_preview_digest, methodology_snapshot, requirements_snapshot,
    calibration_bindings, validation_succeeded, validation_errors,
    validated_by_identity_id
  ) values (
    '73000000-0000-4000-8000-000000000001', 'concurrent-validation',
    'sha256:1111111111111111111111111111111111111111111111111111111111111111',
    'concurrent-case', 'v1', visible_text, visible_digest, materialization,
    manifest_digest, protected_text, protected_digest,
    'sha256:2222222222222222222222222222222222222222222222222222222222222222',
    '{"capturedAt":"2026-09-04T12:00:00.000Z","source":"method","sourceDigest":"sha256:3333333333333333333333333333333333333333333333333333333333333333"}',
    '{"capturedAt":"2026-09-04T12:00:00.000Z","source":"requirements","sourceDigest":"sha256:4444444444444444444444444444444444444444444444444444444444444444"}',
    jsonb_build_array(
      jsonb_build_object('class', 'effective', 'artifactDigest', private.sha256_text(effective_text)),
      jsonb_build_object('class', 'partially-effective', 'artifactDigest', private.sha256_text(partial_text)),
      jsonb_build_object('class', 'not-yet-effective', 'artifactDigest', private.sha256_text(not_yet_text))
    ),
    true, '[]',
    (select id from public.github_identities where github_user_id = 701)
  );
  insert into private.case_validation_calibration_artifacts (
    validation_id, calibration_class, canonical_artifact_text, artifact_digest
  ) values
    ('73000000-0000-4000-8000-000000000001', 'effective', effective_text, private.sha256_text(effective_text)),
    ('73000000-0000-4000-8000-000000000001', 'partially-effective', partial_text, private.sha256_text(partial_text)),
    ('73000000-0000-4000-8000-000000000001', 'not-yet-effective', not_yet_text, private.sha256_text(not_yet_text));
end;
$$;
SQL

approval_sql="select case_version_id::text || '|' || case_version_digest from private.approve_case_version(
  '71000000-0000-4000-8000-000000000001',
  '73000000-0000-4000-8000-000000000001',
  'concurrent-approval',
  (select student_bundle_digest from private.case_validations where id = '73000000-0000-4000-8000-000000000001'),
  (select student_manifest_digest from private.case_validations where id = '73000000-0000-4000-8000-000000000001'),
  (select protected_package_digest from private.case_validations where id = '73000000-0000-4000-8000-000000000001'),
  (select draft_preview_digest from private.case_validations where id = '73000000-0000-4000-8000-000000000001')
)"

docker exec -e PGAPPNAME=publication-concurrency-first "$sim_db_container" \
  psql -U postgres -d postgres -X -qAt -v ON_ERROR_STOP=1 -c \
  "begin; $approval_sql; select pg_sleep(3); commit;" >"$sim_first_output" 2>&1 &
sim_first_pid=$!

for _ in {1..50}; do
  sim_first_ready="$(docker exec "$sim_db_container" psql -U postgres -d postgres -X -Atc \
    "select count(*) from pg_stat_activity where application_name = 'publication-concurrency-first' and query like '%pg_sleep%'")"
  [[ "$sim_first_ready" == "1" ]] && break
  sleep 0.1
done
[[ "${sim_first_ready:-0}" == "1" ]] || { echo "FAIL: first approval did not hold its transaction" >&2; exit 1; }

docker exec -e PGAPPNAME=publication-concurrency-second "$sim_db_container" \
  psql -U postgres -d postgres -X -qAt -v ON_ERROR_STOP=1 -c "$approval_sql" >"$sim_second_output" 2>&1 &
sim_second_pid=$!

for _ in {1..50}; do
  sim_second_waiting="$(docker exec "$sim_db_container" psql -U postgres -d postgres -X -Atc \
    "select count(*) from pg_stat_activity where application_name = 'publication-concurrency-second' and wait_event_type = 'Lock'")"
  [[ "$sim_second_waiting" == "1" ]] && break
  sleep 0.1
done
[[ "${sim_second_waiting:-0}" == "1" ]] || { echo "FAIL: duplicate approval did not wait on the durable operation lock" >&2; exit 1; }

wait "$sim_first_pid"
wait "$sim_second_pid"
sim_first_result="$(grep -E '^[0-9a-f-]{36}\|sha256:[a-f0-9]{64}$' "$sim_first_output")"
sim_second_result="$(grep -E '^[0-9a-f-]{36}\|sha256:[a-f0-9]{64}$' "$sim_second_output")"
sim_publication_count="$(docker exec "$sim_db_container" psql -U postgres -d postgres -X -Atc \
  "select count(*) from private.case_version_publications where case_id = 'concurrent-case'")"
if [[ -z "$sim_first_result" || "$sim_first_result" != "$sim_second_result" || "$sim_publication_count" != "1" ]]; then
  echo "FAIL: concurrent approval did not converge on one publication" >&2
  exit 1
fi

reservation_sql="select assignment_id::text || '|' || repository_name from private.reserve_assignment(
  '71000000-0000-4000-8000-000000000001', 'concurrent-reservation',
  (select case_version_digest from private.case_version_publications), 702,
  'Volta-Labs-Inc', repeat('d', 40),
  (select student_bundle_digest from private.case_version_publications),
  (select student_materialization from private.case_version_publications),
  (select student_manifest_digest from private.case_version_publications)
)"

: >"$sim_first_output"
: >"$sim_second_output"
docker exec -e PGAPPNAME=reservation-concurrency-first "$sim_db_container" \
  psql -U postgres -d postgres -X -qAt -v ON_ERROR_STOP=1 -c \
  "begin; $reservation_sql; select pg_sleep(3); commit;" >"$sim_first_output" 2>&1 &
sim_first_pid=$!

for _ in {1..50}; do
  sim_first_ready="$(docker exec "$sim_db_container" psql -U postgres -d postgres -X -Atc \
    "select count(*) from pg_stat_activity where application_name = 'reservation-concurrency-first' and query like '%pg_sleep%'")"
  [[ "$sim_first_ready" == "1" ]] && break
  sleep 0.1
done
[[ "${sim_first_ready:-0}" == "1" ]] || { echo "FAIL: first reservation did not hold its transaction" >&2; exit 1; }

docker exec -e PGAPPNAME=reservation-concurrency-second "$sim_db_container" \
  psql -U postgres -d postgres -X -qAt -v ON_ERROR_STOP=1 -c "$reservation_sql" >"$sim_second_output" 2>&1 &
sim_second_pid=$!

for _ in {1..50}; do
  sim_second_waiting="$(docker exec "$sim_db_container" psql -U postgres -d postgres -X -Atc \
    "select count(*) from pg_stat_activity where application_name = 'reservation-concurrency-second' and wait_event_type = 'Lock'")"
  [[ "$sim_second_waiting" == "1" ]] && break
  sleep 0.1
done
[[ "${sim_second_waiting:-0}" == "1" ]] || { echo "FAIL: duplicate reservation did not wait on the durable operation lock" >&2; exit 1; }

wait "$sim_first_pid"
wait "$sim_second_pid"
sim_first_result="$(grep -E '^[0-9a-f-]{36}\|volta-sim-[a-f0-9]{24}$' "$sim_first_output")"
sim_second_result="$(grep -E '^[0-9a-f-]{36}\|volta-sim-[a-f0-9]{24}$' "$sim_second_output")"
sim_assignment_counts="$(docker exec "$sim_db_container" psql -U postgres -d postgres -X -Atc \
  "select
     (select count(*) from private.assignment_provisioning assignment_record
      join private.case_version_publications publication
        on publication.case_version_id = assignment_record.case_version_id
      where publication.case_id = 'concurrent-case')
     || '|' ||
     (select count(*) from private.assignment_reservation_operations operation
      join private.assignment_provisioning assignment_record
        on assignment_record.assignment_id = operation.assignment_id
      join private.case_version_publications publication
        on publication.case_version_id = assignment_record.case_version_id
      where publication.case_id = 'concurrent-case')")"
if [[ -z "$sim_first_result" || "$sim_first_result" != "$sim_second_result" || "$sim_assignment_counts" != "1|1" ]]; then
  echo "FAIL: concurrent reservation did not converge on one assignment and operation" >&2
  exit 1
fi

transition_sql="select private.record_assignment_provisioning(
  '71000000-0000-4000-8000-000000000001',
  'concurrent-repository-transition',
  (select assignment_id from private.assignment_provisioning assignment_record
   join private.case_version_publications publication
     on publication.case_version_id = assignment_record.case_version_id
   where publication.case_id = 'concurrent-case'),
  'provisioning', 'repository_created', 9901, true,
  'Volta-Labs-Inc',
  (select repository_name from private.assignment_provisioning assignment_record
   join private.case_version_publications publication
     on publication.case_version_id = assignment_record.case_version_id
   where publication.case_id = 'concurrent-case'),
  repeat('d', 40), repeat('f', 40),
  (select student_bundle_digest from private.case_version_publications where case_id = 'concurrent-case'),
  (select student_manifest_digest from private.case_version_publications where case_id = 'concurrent-case'),
  (select jsonb_agg(
     jsonb_build_object(
       'byteLength', (entry.value ->> 'byteLength')::bigint,
       'digest', entry.value ->> 'digest',
       'path', entry.value ->> 'path'
     ) order by entry.ordinality
   )
   from private.case_version_publications publication,
     jsonb_array_elements(publication.student_materialization -> 'files')
       with ordinality entry(value, ordinality)
   where publication.case_id = 'concurrent-case'),
  null, null, null, null, 'none', null, null, null
)"

: >"$sim_first_output"
: >"$sim_second_output"
docker exec -e PGAPPNAME=transition-concurrency-first "$sim_db_container" \
  psql -U postgres -d postgres -X -qAt -v ON_ERROR_STOP=1 -c \
  "begin; $transition_sql; select pg_sleep(3); commit;" >"$sim_first_output" 2>&1 &
sim_first_pid=$!

sleep 0.25

docker exec -e PGAPPNAME=transition-concurrency-second "$sim_db_container" \
  psql -U postgres -d postgres -X -qAt -v ON_ERROR_STOP=1 -c "$transition_sql" >"$sim_second_output" 2>&1 &
sim_second_pid=$!

for _ in {1..50}; do
  sim_second_waiting="$(docker exec "$sim_db_container" psql -U postgres -d postgres -X -Atc \
    "select count(*) from pg_stat_activity where application_name = 'transition-concurrency-second' and wait_event_type = 'Lock'")"
  [[ "$sim_second_waiting" == "1" ]] && break
  sleep 0.1
done
[[ "${sim_second_waiting:-0}" == "1" ]] || { echo "FAIL: duplicate provisioning transition did not wait on the durable operation lock" >&2; exit 1; }

wait "$sim_first_pid"
wait "$sim_second_pid"
sim_first_result="$(grep -E '^repository_created$' "$sim_first_output")"
sim_second_result="$(grep -E '^repository_created$' "$sim_second_output")"
sim_transition_counts="$(docker exec "$sim_db_container" psql -U postgres -d postgres -X -Atc \
  "select
     (select count(*) from private.provisioning_attempts attempt
      join private.assignment_provisioning assignment_record
        on assignment_record.assignment_id = attempt.assignment_id
      join private.case_version_publications publication
        on publication.case_version_id = assignment_record.case_version_id
      where publication.case_id = 'concurrent-case')
     || '|' ||
     (select count(*) from private.provisioning_transition_operations operation
      join private.assignment_provisioning assignment_record
        on assignment_record.assignment_id = operation.assignment_id
      join private.case_version_publications publication
        on publication.case_version_id = assignment_record.case_version_id
      where publication.case_id = 'concurrent-case')")"
if [[ "$sim_first_result" != "repository_created" || "$sim_second_result" != "repository_created" || "$sim_transition_counts" != "1|1" ]]; then
  echo "FAIL: concurrent provisioning transition did not converge on one state change, attempt, and receipt" >&2
  exit 1
fi

echo "PASS: concurrent approval, reservation, and provisioning retries waited on durable locks and converged without duplicates"
