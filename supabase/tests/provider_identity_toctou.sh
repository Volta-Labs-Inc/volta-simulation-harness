#!/usr/bin/env bash
set -euo pipefail

sim_root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
sim_db_container="supabase_db_volta-simulation-harness"
sim_locker_output="$(mktemp)"
sim_submit_output="$(mktemp)"

cleanup_files() {
  rm -f "$sim_locker_output" "$sim_submit_output"
}
trap cleanup_files EXIT

cd "$sim_root_dir"
supabase db reset --local >/dev/null

docker exec -i "$sim_db_container" psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 <<'SQL' >/dev/null
insert into auth.users (
  id, email, aud, role, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '81000000-0000-4000-8000-000000000001',
  'toctou-student@example.test',
  'authenticated',
  'authenticated',
  '{}',
  '{}',
  now(),
  now()
);

insert into auth.identities (
  id, provider_id, user_id, identity_data, provider, created_at, updated_at
) values (
  '82000000-0000-4000-8000-000000000001',
  '811',
  '81000000-0000-4000-8000-000000000001',
  '{"sub":"811","user_name":"toctou-student"}',
  'github',
  now(),
  now()
);

select private.sync_github_identity('81000000-0000-4000-8000-000000000001');

insert into public.case_versions (
  id, case_id, case_version_digest, student_bundle_digest, protected_package_digest
) values (
  '83000000-0000-4000-8000-000000000001',
  'toctou-case',
  'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc'
);

begin;
insert into public.assignments (
  id, case_version_id, student_identity_id, required_blind_policy_version
) values (
  '84000000-0000-4000-8000-000000000001',
  '83000000-0000-4000-8000-000000000001',
  (select id from public.github_identities where github_user_id = 811),
  1
);
insert into public.blind_policies (
  assignment_id, case_version_id, policy_version, mode, blind_student_identity_id
) values (
  '84000000-0000-4000-8000-000000000001',
  '83000000-0000-4000-8000-000000000001',
  1,
  'attempt-one',
  (select id from public.github_identities where github_user_id = 811)
);
commit;
SQL

docker exec -e PGAPPNAME=identity-toctou-locker "$sim_db_container" \
  psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 -c \
  "begin; select id from public.assignments where id = '84000000-0000-4000-8000-000000000001' for update; select pg_sleep(5); commit;" \
  >"$sim_locker_output" 2>&1 &
sim_locker_pid=$!

for _ in {1..50}; do
  sim_locker_ready="$(docker exec "$sim_db_container" psql -U postgres -d postgres -X -Atc \
    "select count(*) from pg_stat_activity where application_name = 'identity-toctou-locker' and state = 'active'")"
  if [[ "$sim_locker_ready" == "1" ]]; then
    break
  fi
  sleep 0.1
done

if [[ "${sim_locker_ready:-0}" != "1" ]]; then
  wait "$sim_locker_pid" || true
  echo "FAIL: assignment lock was not established" >&2
  exit 1
fi

docker exec -e PGAPPNAME=identity-toctou-submit "$sim_db_container" \
  psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 -Atc \
  "with payload as (
     select '{
       \"submissionId\":\"toctou-submission\",
       \"assignmentId\":\"84000000-0000-4000-8000-000000000001\",
       \"studentGithubUserId\":\"811\",
       \"attemptNumber\":1,
       \"caseVersionDigest\":\"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\",
       \"gitCommitSha\":\"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\",
       \"ledger\":[{}],
       \"evidence\":[],
       \"decision\":{},
       \"estimates\":[{}],
       \"missingDataPlan\":\"measure first\",
       \"requirementAssessments\":[{}],
       \"competencyClaims\":[{},{},{},{}],
       \"successCriteria\":[{}],
       \"calculations\":[{}],
       \"economicRationale\":\"bounded test\",
       \"responsePlan\":{},
       \"submissionDigest\":\"sha256:9999999999999999999999999999999999999999999999999999999999999999\"
     }'::jsonb as packet
   )
   select coalesce(private.accept_submission(
     '81000000-0000-4000-8000-000000000001',
     '84000000-0000-4000-8000-000000000001',
     1,
     1,
     'toctou-operation',
     'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
     packet,
     statement_timestamp()
   )::text, 'DENIED') from payload;" \
  >"$sim_submit_output" 2>&1 &
sim_submit_pid=$!

for _ in {1..50}; do
  sim_submit_waiting="$(docker exec "$sim_db_container" psql -U postgres -d postgres -X -Atc \
    "select count(*) from pg_stat_activity where application_name = 'identity-toctou-submit' and wait_event_type = 'Lock'")"
  if [[ "$sim_submit_waiting" == "1" ]]; then
    break
  fi
  sleep 0.1
done

if [[ "${sim_submit_waiting:-0}" != "1" ]]; then
  wait "$sim_locker_pid" || true
  wait "$sim_submit_pid" || true
  echo "FAIL: submission did not wait on the assignment lock" >&2
  exit 1
fi

docker exec "$sim_db_container" psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 -c \
  "update auth.identities set provider_id = '899' where id = '82000000-0000-4000-8000-000000000001';" \
  >/dev/null

wait "$sim_locker_pid"
wait "$sim_submit_pid"

sim_submit_result="$(tr -d '[:space:]' <"$sim_submit_output")"
sim_state_result="$(docker exec "$sim_db_container" psql -U postgres -d postgres -X -Atc \
  "select (assignment_record.attempt_one_submitted_at is null)::integer || '|' || count(submission_record.id)
   from public.assignments assignment_record
   left join public.submissions submission_record on submission_record.assignment_id = assignment_record.id
   where assignment_record.id = '84000000-0000-4000-8000-000000000001'
   group by assignment_record.attempt_one_submitted_at")"

if [[ "$sim_submit_result" != "DENIED" || "$sim_state_result" != "1|0" ]]; then
  echo "FAIL: provider identity changed while waiting but submission result was $sim_submit_result and state was $sim_state_result" >&2
  exit 1
fi

echo "PASS: provider identity mutation while waiting produced no submission and no blind-role restoration"
