begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

select ok(
  (
    select bool_and(c.relrowsecurity and c.relforcerowsecurity)
    from pg_class c
    where c.oid = any (array[
      'public.github_identities'::regclass,
      'public.case_versions'::regclass,
      'public.assignments'::regclass,
      'public.blind_policies'::regclass,
      'public.staff_case_grants'::regclass,
      'public.cli_pairing_codes'::regclass,
      'public.cli_tokens'::regclass,
      'public.official_events'::regclass,
      'public.submissions'::regclass,
      'public.evaluations'::regclass
    ])
  ),
  'every pilot data table has forced row protection'
);

select ok(
  not has_table_privilege('anon', 'public.assignments', 'SELECT')
  and not has_table_privilege('anon', 'public.official_events', 'SELECT')
  and not has_table_privilege('anon', 'public.submissions', 'SELECT')
  and not has_table_privilege('anon', 'public.evaluations', 'SELECT')
  and not has_table_privilege('anon', 'public.cli_tokens', 'SELECT'),
  'anonymous callers receive no active-data privileges'
);

select ok(
  has_table_privilege('authenticated', 'public.assignments', 'SELECT')
  and has_table_privilege('authenticated', 'public.official_events', 'SELECT')
  and has_table_privilege('authenticated', 'public.submissions', 'SELECT')
  and has_table_privilege('authenticated', 'public.evaluations', 'SELECT')
  and not has_table_privilege('authenticated', 'public.cli_tokens', 'SELECT')
  and not has_table_privilege('authenticated', 'public.blind_policies', 'SELECT'),
  'signed-in callers can reach only the RLS-filtered student-facing tables'
);

select ok(
  not has_table_privilege('authenticated', 'public.official_events', 'INSERT')
  and not has_table_privilege('authenticated', 'public.official_events', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.official_events', 'DELETE')
  and not has_table_privilege('authenticated', 'public.submissions', 'INSERT')
  and not has_table_privilege('authenticated', 'public.evaluations', 'INSERT')
  and not has_table_privilege('authenticated', 'public.assignments', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.assignments', 'TRUNCATE'),
  'students have no direct official-record or assignment write privileges'
);

select ok(
  not has_column_privilege(
    'service_role',
    'public.assignments',
    'attempt_one_submitted_at',
    'UPDATE'
  )
  and not has_column_privilege(
    'service_role',
    'public.assignments',
    'required_blind_policy_version',
    'UPDATE'
  )
  and not has_table_privilege('service_role', 'public.blind_policies', 'INSERT')
  and not has_table_privilege('service_role', 'public.submissions', 'INSERT')
  and not has_table_privilege('service_role', 'public.cli_tokens', 'INSERT'),
  'even the service role must use atomic submission and credential operations'
);

select is_empty(
  $$
    select p.proname
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef
  $$,
  'no elevated function exists in the exposed public schema'
);

insert into auth.users (
  id, email, aud, role, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  (
    '10000000-0000-4000-8000-000000000001',
    'student@example.test',
    'authenticated',
    'authenticated',
    '{}',
    '{"github_user_id":"202","roles":["staff"]}',
    now(),
    now()
  ),
  (
    '10000000-0000-4000-8000-000000000002',
    'staff@example.test',
    'authenticated',
    'authenticated',
    '{}',
    '{}',
    now(),
    now()
  ),
  (
    '10000000-0000-4000-8000-000000000003',
    'unauthorized@example.test',
    'authenticated',
    'authenticated',
    '{}',
    '{"github_user_id":"101","roles":["staff","case-author"]}',
    now(),
    now()
  ),
  (
    '10000000-0000-4000-8000-000000000004',
    'other-student@example.test',
    'authenticated',
    'authenticated',
    '{}',
    '{}',
    now(),
    now()
  ),
  (
    '10000000-0000-4000-8000-000000000005',
    'bad-provider@example.test',
    'authenticated',
    'authenticated',
    '{}',
    '{}',
    now(),
    now()
  );

insert into auth.identities (
  id, provider_id, user_id, identity_data, provider, created_at, updated_at
) values
  (
    '20000000-0000-4000-8000-000000000001',
    '101',
    '10000000-0000-4000-8000-000000000001',
    '{"sub":"101","user_name":"rishabh-old"}',
    'github',
    now(),
    now()
  ),
  (
    '20000000-0000-4000-8000-000000000002',
    '202',
    '10000000-0000-4000-8000-000000000002',
    '{"sub":"202","user_name":"matt"}',
    'github',
    now(),
    now()
  ),
  (
    '20000000-0000-4000-8000-000000000003',
    '303',
    '10000000-0000-4000-8000-000000000003',
    '{"sub":"303","user_name":"not-staff"}',
    'github',
    now(),
    now()
  ),
  (
    '20000000-0000-4000-8000-000000000004',
    '404',
    '10000000-0000-4000-8000-000000000004',
    '{"sub":"404","user_name":"other-student"}',
    'github',
    now(),
    now()
  ),
  (
    '20000000-0000-4000-8000-000000000005',
    'not-a-number',
    '10000000-0000-4000-8000-000000000005',
    '{"sub":"not-a-number","user_name":"invalid"}',
    'github',
    now(),
    now()
  );

select lives_ok(
  $$select private.sync_github_identity('10000000-0000-4000-8000-000000000001')$$,
  'a GitHub identity is captured from the authenticated provider record'
);
select lives_ok(
  $$select private.sync_github_identity('10000000-0000-4000-8000-000000000002')$$,
  'an authorized staff identity is captured from the provider record'
);
select lives_ok(
  $$select private.sync_github_identity('10000000-0000-4000-8000-000000000003')$$,
  'an unprivileged account is captured without inheriting editable metadata roles'
);
select lives_ok(
  $$select private.sync_github_identity('10000000-0000-4000-8000-000000000004')$$,
  'the second student receives a distinct immutable provider identity'
);

select is(
  (
    select github_user_id
    from public.github_identities
    where auth_user_id = '10000000-0000-4000-8000-000000000001'
  ),
  101::bigint,
  'editable user metadata cannot replace the numeric GitHub provider identity'
);

select throws_ok(
  $$select private.sync_github_identity('10000000-0000-4000-8000-000000000005')$$,
  '22023',
  null,
  'a nonnumeric GitHub provider identity is rejected'
);

insert into auth.identities (
  id, provider_id, user_id, identity_data, provider, created_at, updated_at
) values (
  '20000000-0000-4000-8000-000000000006',
  '505',
  '10000000-0000-4000-8000-000000000001',
  '{"sub":"505","user_name":"unexpected-second-github"}',
  'github',
  now(),
  now()
);
select throws_ok(
  $$select private.sync_github_identity('10000000-0000-4000-8000-000000000001')$$,
  '28000',
  null,
  'ambiguous multiple GitHub identities fail closed instead of choosing one'
);
delete from auth.identities where id = '20000000-0000-4000-8000-000000000006';

update auth.identities
set identity_data = jsonb_set(identity_data, '{user_name}', '"rishabh-renamed"')
where id = '20000000-0000-4000-8000-000000000001';
select private.sync_github_identity('10000000-0000-4000-8000-000000000001');

select is(
  (
    select current_login
    from public.github_identities
    where auth_user_id = '10000000-0000-4000-8000-000000000001'
  ),
  'rishabh-renamed',
  'a renamed GitHub login is refreshed for display and invitations'
);
select is(
  (
    select github_user_id
    from public.github_identities
    where auth_user_id = '10000000-0000-4000-8000-000000000001'
  ),
  101::bigint,
  'a renamed login does not change the authorization identity'
);
select throws_ok(
  $$
    update public.github_identities
    set github_user_id = 999
    where auth_user_id = '10000000-0000-4000-8000-000000000001'
  $$,
  '55000',
  null,
  'the bound numeric GitHub identity cannot be edited later'
);

insert into public.case_versions (
  id, case_id, case_version_digest, student_bundle_digest, protected_package_digest
) values
  (
    '30000000-0000-4000-8000-000000000001',
    'support-routing',
    'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc'
  ),
  (
    '30000000-0000-4000-8000-000000000002',
    'other-case',
    'sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
    'sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
    'sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'
  );

insert into public.assignments (
  id, case_version_id, student_identity_id, required_blind_policy_version
) values
  (
    '40000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000001',
    (select id from public.github_identities where github_user_id = 101),
    1
  ),
  (
    '40000000-0000-4000-8000-000000000002',
    '30000000-0000-4000-8000-000000000002',
    (select id from public.github_identities where github_user_id = 404),
    1
  );

select throws_ok(
  $$
    insert into public.assignments (
      id, case_version_id, student_identity_id, status,
      current_attempt_number, attempt_one_submitted_at,
      required_blind_policy_version, state_version
    ) values (
      '40000000-0000-4000-8000-000000000099',
      '30000000-0000-4000-8000-000000000001',
      (select id from public.github_identities where github_user_id = 101),
      'submitted',
      1,
      statement_timestamp(),
      1,
      2
    )
  $$,
  '22023',
  null,
  'a newly inserted assignment cannot begin with blind access already restored'
);

insert into public.blind_policies (
  assignment_id, case_version_id, policy_version, mode, blind_student_identity_id
) values
  (
    '40000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000001',
    1,
    'attempt-one',
    (select id from public.github_identities where github_user_id = 101)
  ),
  (
    '40000000-0000-4000-8000-000000000002',
    '30000000-0000-4000-8000-000000000002',
    1,
    'none',
    null
  );

insert into public.staff_case_grants (staff_identity_id, case_version_id, permission)
select identity_record.id, '30000000-0000-4000-8000-000000000001', permission
from public.github_identities identity_record
cross join unnest(array[
  'timeline'::public.staff_case_permission,
  'protected-case'::public.staff_case_permission,
  'evaluate'::public.staff_case_permission,
  'author'::public.staff_case_permission
]) permission
where identity_record.github_user_id in (101, 202);

insert into public.official_events (
  id, assignment_id, attempt_number, sequence, client_operation_id,
  actor_identity_id, event_type, payload
) values
  (
    '50000000-0000-4000-8000-000000000001',
    '40000000-0000-4000-8000-000000000001',
    1,
    1,
    'operation-a',
    (select id from public.github_identities where github_user_id = 101),
    'student.note',
    '{"text":"own event"}'
  ),
  (
    '50000000-0000-4000-8000-000000000002',
    '40000000-0000-4000-8000-000000000002',
    1,
    1,
    'operation-b',
    (select id from public.github_identities where github_user_id = 404),
    'student.note',
    '{"text":"other event"}'
  );

select ok(
  private.assignment_policy_is_current('40000000-0000-4000-8000-000000000001'),
  'the assignment binds the exact required blind-policy version'
);
select ok(
  private.check_assignment_access(
    '10000000-0000-4000-8000-000000000001',
    '40000000-0000-4000-8000-000000000001',
    'student-read',
    1
  ),
  'the assigned student passes the service-side access decision'
);
select ok(
  not private.check_assignment_access(
    '10000000-0000-4000-8000-000000000004',
    '40000000-0000-4000-8000-000000000001',
    'student-read',
    1
  ),
  'the wrong student fails the service-side access decision'
);
select ok(
  private.check_assignment_access(
    '10000000-0000-4000-8000-000000000002',
    '40000000-0000-4000-8000-000000000001',
    'staff-read-protected-case',
    1
  ),
  'case-authorized staff can read the protected case'
);
select ok(
  not private.check_assignment_access(
    '10000000-0000-4000-8000-000000000003',
    '40000000-0000-4000-8000-000000000001',
    'staff-read-protected-case',
    1
  ),
  'editable metadata cannot grant an unauthorized person staff access'
);
select ok(
  not private.check_assignment_access(
    '10000000-0000-4000-8000-000000000001',
    '40000000-0000-4000-8000-000000000001',
    'staff-read-protected-case',
    1
  ),
  'the blind student staff member is denied protected access before Attempt 1 submission'
);
select ok(
  not private.check_assignment_access(
    '10000000-0000-4000-8000-000000000002',
    '40000000-0000-4000-8000-000000000001',
    'staff-read-protected-case',
    2
  ),
  'a stale or guessed blind-policy version fails closed'
);
select ok(
  not private.check_assignment_access(
    '10000000-0000-4000-8000-000000000001',
    '40000000-0000-4000-8000-000000000002',
    'student-read',
    1
  ),
  'assignment identifiers cannot be replayed across students'
);

set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select throws_ok(
  $$select id from public.assignments limit 1$$,
  '42501',
  null,
  'an anonymous caller cannot list assignments'
);
select throws_ok(
  $$select id from public.official_events limit 1$$,
  '42501',
  null,
  'an anonymous caller cannot read official events'
);
select throws_ok(
  $$select id from public.submissions limit 1$$,
  '42501',
  null,
  'an anonymous caller cannot read submissions'
);
select throws_ok(
  $$select id from public.evaluations limit 1$$,
  '42501',
  null,
  'an anonymous caller cannot read evaluations'
);
reset role;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);
select is(
  (select count(*)::int from public.assignments),
  1,
  'the student sees exactly their own assignment'
);
select is(
  (select count(*)::int from public.official_events),
  1,
  'the student sees exactly their own official events'
);
select is(
  (select count(*)::int from public.case_versions),
  0,
  'the blind student cannot read protected case-version metadata'
);
select throws_ok(
  $$
    insert into public.official_events (
      assignment_id, attempt_number, sequence, client_operation_id,
      actor_identity_id, event_type, payload
    ) values (
      '40000000-0000-4000-8000-000000000001', 1, 2, 'student-direct-event',
      (select id from public.github_identities limit 1), 'student.note', '{}'
    )
  $$,
  '42501',
  null,
  'the student cannot append an official event directly'
);
select throws_ok(
  $$
    insert into public.submissions (
      assignment_id, attempt_number, client_operation_id, actor_identity_id,
      case_version_digest, event_cutoff, packet, packet_digest
    ) values (
      '40000000-0000-4000-8000-000000000001', 1, 'student-direct-submission',
      (select id from public.github_identities limit 1),
      'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      1, '{}', 'sha256:1111111111111111111111111111111111111111111111111111111111111111'
    )
  $$,
  '42501',
  null,
  'the student cannot append a submission directly'
);
select throws_ok(
  $$
    insert into public.evaluations (
      submission_id, evaluator_identity_id, evaluation, evaluation_digest
    ) values (
      gen_random_uuid(), (select id from public.github_identities limit 1), '{}',
      'sha256:2222222222222222222222222222222222222222222222222222222222222222'
    )
  $$,
  '42501',
  null,
  'the student cannot append an evaluation directly'
);
select throws_ok(
  $$select private.check_assignment_access(
    '10000000-0000-4000-8000-000000000001',
    '40000000-0000-4000-8000-000000000001',
    'staff-read-protected-case',
    1
  )$$,
  '42501',
  null,
  'a browser session cannot invoke the elevated service decision directly'
);
reset role;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated"}',
  true
);
select is(
  (select count(*)::int from public.assignments),
  1,
  'authorized staff sees only the assignment for the granted case version'
);
select is(
  (select count(*)::int from public.case_versions),
  1,
  'case-scoped staff authorization does not broaden to other cases'
);
reset role;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-4000-8000-000000000003","role":"authenticated"}',
  true
);
select is(
  (select count(*)::int from public.assignments),
  0,
  'an unauthorized staff-shaped account sees no assignments'
);
select is(
  (select count(*)::int from public.case_versions),
  0,
  'an unauthorized staff-shaped account sees no protected case versions'
);
reset role;

set local role service_role;
select throws_ok(
  $$
    insert into public.blind_policies (
      assignment_id, case_version_id, policy_version, mode, blind_student_identity_id
    ) values (
      '40000000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000001',
      2,
      'none',
      null
    )
  $$,
  '42501',
  null,
  'the service role cannot insert a policy that silently lifts Attempt 1 blindness'
);
select throws_ok(
  $$
    update public.assignments
    set required_blind_policy_version = 2
    where id = '40000000-0000-4000-8000-000000000001'
  $$,
  '42501',
  null,
  'the service role cannot directly change an assignment blind-policy version'
);
select ok(
  not private.advance_blind_policy(
    '10000000-0000-4000-8000-000000000002',
    '40000000-0000-4000-8000-000000000001',
    1,
    2,
    'none',
    null
  ),
  'the controlled policy transition refuses to lift blindness before Attempt 1 is accepted'
);
select ok(
  not private.check_assignment_access(
    '10000000-0000-4000-8000-000000000001',
    '40000000-0000-4000-8000-000000000001',
    'staff-read-protected-case',
    1
  ),
  'a rejected policy transition leaves the blind staff assignee denied'
);

insert into public.cli_pairing_codes (
  id, assignment_id, student_identity_id, blind_policy_version,
  code_digest, expires_at, created_at
) values
  (
    '60000000-0000-4000-8000-000000000001',
    '40000000-0000-4000-8000-000000000001',
    (select id from public.github_identities where github_user_id = 101),
    1,
    decode(repeat('aa', 32), 'hex'),
    '2026-09-04T12:05:00Z',
    '2026-09-04T12:00:00Z'
  ),
  (
    '60000000-0000-4000-8000-000000000002',
    '40000000-0000-4000-8000-000000000001',
    (select id from public.github_identities where github_user_id = 101),
    1,
    decode(repeat('dd', 32), 'hex'),
    '2026-09-04T12:00:30Z',
    '2026-09-04T12:00:00Z'
  ),
  (
    '60000000-0000-4000-8000-000000000003',
    '40000000-0000-4000-8000-000000000001',
    (select id from public.github_identities where github_user_id = 101),
    1,
    decode(repeat('ee', 32), 'hex'),
    '2026-09-04T12:05:00Z',
    '2026-09-04T12:00:00Z'
  ),
  (
    '60000000-0000-4000-8000-000000000004',
    '40000000-0000-4000-8000-000000000001',
    (select id from public.github_identities where github_user_id = 101),
    1,
    decode(repeat('12', 32), 'hex'),
    '2026-09-04T12:05:00Z',
    '2026-09-04T12:00:00Z'
  );

select ok(
  private.consume_pairing_code(
    '40000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    decode(repeat('aa', 32), 'hex'),
    decode(repeat('bb', 32), 'hex'),
    1,
    '2026-09-04T13:00:00Z',
    '2026-09-04T12:01:00Z'
  ) is not null,
  'a current pairing code is atomically exchanged for an assignment-scoped token'
);
select ok(
  (
    select consumed_at = '2026-09-04T12:01:00Z'
    from public.cli_pairing_codes
    where id = '60000000-0000-4000-8000-000000000001'
  ),
  'the successful exchange consumes the pairing code'
);
select ok(
  private.consume_pairing_code(
    '40000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    decode(repeat('aa', 32), 'hex'),
    decode(repeat('cc', 32), 'hex'),
    1,
    '2026-09-04T13:00:00Z',
    '2026-09-04T12:02:00Z'
  ) is null,
  'a consumed pairing code cannot be reused'
);
select ok(
  private.consume_pairing_code(
    '40000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    decode(repeat('dd', 32), 'hex'),
    decode(repeat('cc', 32), 'hex'),
    1,
    '2026-09-04T13:00:00Z',
    '2026-09-04T12:01:00Z'
  ) is null,
  'an expired pairing code is refused'
);
select ok(
  private.consume_pairing_code(
    '40000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000001',
    decode(repeat('ee', 32), 'hex'),
    decode(repeat('cc', 32), 'hex'),
    1,
    '2026-09-04T13:00:00Z',
    '2026-09-04T12:01:00Z'
  ) is null,
  'a pairing code cannot be replayed against another assignment'
);
select is(
  (
    select count(*)::int
    from private.resolve_cli_token(
      '40000000-0000-4000-8000-000000000001',
      decode(repeat('bb', 32), 'hex'),
      1,
      '2026-09-04T12:10:00Z'
    )
  ),
  1,
  'a current token resolves only within its assignment and blind-policy version'
);
select is(
  (
    select count(*)::int
    from private.resolve_cli_token(
      '40000000-0000-4000-8000-000000000002',
      decode(repeat('bb', 32), 'hex'),
      1,
      '2026-09-04T12:10:00Z'
    )
  ),
  0,
  'a token cannot be replayed against another assignment'
);
select is(
  (
    select count(*)::int
    from private.resolve_cli_token(
      '40000000-0000-4000-8000-000000000001',
      decode(repeat('bb', 32), 'hex'),
      2,
      '2026-09-04T12:10:00Z'
    )
  ),
  0,
  'a token bound to a stale blind-policy version is refused'
);
select ok(
  private.revoke_cli_token(
    '40000000-0000-4000-8000-000000000001',
    decode(repeat('bb', 32), 'hex'),
    '2026-09-04T12:11:00Z'
  ),
  'a current token can be revoked'
);
select is(
  (
    select count(*)::int
    from private.resolve_cli_token(
      '40000000-0000-4000-8000-000000000001',
      decode(repeat('bb', 32), 'hex'),
      1,
      '2026-09-04T12:12:00Z'
    )
  ),
  0,
  'a revoked token fails on the next request'
);

select ok(
  private.consume_pairing_code(
    '40000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    decode(repeat('12', 32), 'hex'),
    decode(repeat('ff', 32), 'hex'),
    1,
    '2026-09-04T12:00:30Z',
    '2026-09-04T12:00:10Z'
  ) is not null,
  'the credential operation can issue a token with a bounded lifetime'
);
select is(
  (
    select count(*)::int
    from private.resolve_cli_token(
      '40000000-0000-4000-8000-000000000001',
      decode(repeat('ff', 32), 'hex'),
      1,
      '2026-09-04T12:01:00Z'
    )
  ),
  0,
  'an expired CLI token is refused'
);
select ok(
  (select bool_and(octet_length(token_digest) = 32) from public.cli_tokens)
  and (select bool_and(octet_length(code_digest) = 32) from public.cli_pairing_codes),
  'the database stores only fixed-length credential digests'
);

create temp table submission_test_packets (
  label text primary key,
  packet jsonb not null
) on commit drop;
insert into submission_test_packets (label, packet) values
  (
    'assignment-a',
    '{
      "submissionId":"submission-a",
      "assignmentId":"40000000-0000-4000-8000-000000000001",
      "studentGithubUserId":"101",
      "attemptNumber":1,
      "caseVersionDigest":"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "gitCommitSha":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "ledger":[{"kind":"assumption"}],
      "evidence":[],
      "decision":{"choice":"continue"},
      "estimates":[{"subject":"pilot"}],
      "missingDataPlan":"Measure a baseline before expanding.",
      "requirementAssessments":[{"requirementId":"baseline"}],
      "competencyClaims":[
        {"competencyId":"problem-viability"},
        {"competencyId":"evidence-sufficiency"},
        {"competencyId":"response-feasibility"},
        {"competencyId":"objective-success-criteria"}
      ],
      "successCriteria":[{"metric":"misroute rate"}],
      "calculations":[{"name":"weekly cost"}],
      "economicRationale":"The bounded pilot tests whether avoided rework exceeds cost.",
      "responsePlan":{"mode":"pilot"},
      "submissionDigest":"sha256:9999999999999999999999999999999999999999999999999999999999999999"
    }'::jsonb
  ),
  (
    'assignment-b',
    '{
      "submissionId":"submission-b",
      "assignmentId":"40000000-0000-4000-8000-000000000002",
      "studentGithubUserId":"404",
      "attemptNumber":1,
      "caseVersionDigest":"sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
      "gitCommitSha":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      "ledger":[{"kind":"unknown"}],
      "evidence":[],
      "decision":{"choice":"stop"},
      "estimates":[{"subject":"collection"}],
      "missingDataPlan":"Collect representative demand first.",
      "requirementAssessments":[{"requirementId":"demand"}],
      "competencyClaims":[
        {"competencyId":"problem-viability"},
        {"competencyId":"evidence-sufficiency"},
        {"competencyId":"response-feasibility"},
        {"competencyId":"objective-success-criteria"}
      ],
      "successCriteria":[{"metric":"evidence coverage"}],
      "calculations":[{"name":"collection effort"}],
      "economicRationale":"No build is justified until demand is measured.",
      "responsePlan":{"mode":"no-build"},
      "submissionDigest":"sha256:8888888888888888888888888888888888888888888888888888888888888888"
    }'::jsonb
  );

select throws_ok(
  $$
    select private.accept_submission(
      '10000000-0000-4000-8000-000000000001',
      '40000000-0000-4000-8000-000000000001',
      1,
      1,
      'submit-invalid',
      'sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
      '{"decision":"continue"}',
      '2026-09-04T12:20:00Z'
    )
  $$,
  '22023',
  null,
  'a submission for a different case digest is rejected'
);
select ok(
  private.accept_submission(
    '10000000-0000-4000-8000-000000000001',
    '40000000-0000-4000-8000-000000000001',
    1,
    1,
    'submit-empty',
    'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    '{}'::jsonb,
    '2026-09-04T12:20:00Z'
  ) is null,
  'an incomplete submission packet is rejected before assignment state changes'
);
select ok(
  to_regprocedure(
    'private.accept_submission(uuid,uuid,integer,integer,text,text,jsonb,text,timestamp with time zone)'
  ) is null,
  'the submission API exposes no caller-controlled receipt digest parameter'
);
select ok(
  (
    select attempt_one_submitted_at is null
    from public.assignments
    where id = '40000000-0000-4000-8000-000000000001'
  ),
  'failed shape and case checks do not restore blind staff access'
);
select ok(
  private.accept_submission(
    '10000000-0000-4000-8000-000000000001',
    '40000000-0000-4000-8000-000000000001',
    1,
    1,
    'submit-valid',
    'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    (select packet from submission_test_packets where label = 'assignment-a'),
    '2026-09-04T12:21:00Z'
  ) is not null,
  'a valid submission is accepted atomically'
);
select ok(
  (
    select submission_record.packet_receipt_text = submission_record.packet::text
      and submission_record.packet_digest = private.submission_packet_receipt_digest(submission_record.packet)
    from public.submissions submission_record
    where submission_record.assignment_id = '40000000-0000-4000-8000-000000000001'
  ),
  'the accepted receipt text and digest are derived from the database-normalized packet'
);
select ok(
  (
    select attempt_one_submitted_at = '2026-09-04T12:21:00Z'
      and status = 'submitted'
      and state_version = 2
    from public.assignments
    where id = '40000000-0000-4000-8000-000000000001'
  ),
  'the accepted Attempt 1 submission atomically records blind-role restoration'
);
select ok(
  private.check_assignment_access(
    '10000000-0000-4000-8000-000000000001',
    '40000000-0000-4000-8000-000000000001',
    'staff-read-protected-case',
    1
  ),
  'the former blind assignee regains only their case-scoped staff access after submission'
);
select is(
  private.accept_submission(
    '10000000-0000-4000-8000-000000000001',
    '40000000-0000-4000-8000-000000000001',
    1,
    1,
    'submit-valid',
    'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    (select packet from submission_test_packets where label = 'assignment-a'),
    '2026-09-04T12:22:00Z'
  ),
  (
    select id
    from public.submissions
    where assignment_id = '40000000-0000-4000-8000-000000000001'
  ),
  'retrying the same submission operation returns the immutable original'
);

insert into public.evaluations (
  id, submission_id, evaluator_identity_id, evaluation, evaluation_digest
) values (
  '70000000-0000-4000-8000-000000000001',
  (select id from public.submissions where assignment_id = '40000000-0000-4000-8000-000000000001'),
  (select id from public.github_identities where github_user_id = 202),
  '{"overall":"effective"}',
  'sha256:3333333333333333333333333333333333333333333333333333333333333333'
);

select ok(
  private.accept_submission(
    '10000000-0000-4000-8000-000000000004',
    '40000000-0000-4000-8000-000000000002',
    1,
    1,
    'other-student-submission',
    'sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
    (select packet from submission_test_packets where label = 'assignment-b'),
    '2026-09-04T12:22:00Z'
  ) is not null,
  'the second assignment also submits through the atomic operation'
);
insert into public.evaluations (
  id, submission_id, evaluator_identity_id, evaluation, evaluation_digest
) values (
  '70000000-0000-4000-8000-000000000002',
  (select id from public.submissions where assignment_id = '40000000-0000-4000-8000-000000000002'),
  (select id from public.github_identities where github_user_id = 202),
  '{"overall":"partially-effective"}',
  'sha256:5555555555555555555555555555555555555555555555555555555555555555'
);

reset role;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-4000-8000-000000000004","role":"authenticated"}',
  true
);
select is(
  (select count(*)::int from public.submissions),
  1,
  'an assigned student can read their own immutable submission'
);
select is(
  (select count(*)::int from public.evaluations),
  0,
  'an assigned student without staff authority cannot read an unreleased human evaluation'
);
reset role;

select throws_ok(
  $$update public.official_events set payload = '{"tampered":true}' where id = '50000000-0000-4000-8000-000000000001'$$,
  '55000',
  null,
  'official events cannot be updated even by an elevated database actor'
);
select throws_ok(
  $$delete from public.official_events where id = '50000000-0000-4000-8000-000000000001'$$,
  '55000',
  null,
  'official events cannot be deleted even by an elevated database actor'
);
select throws_ok(
  $$update public.submissions set packet = '{"tampered":true}' where assignment_id = '40000000-0000-4000-8000-000000000001'$$,
  '55000',
  null,
  'submissions cannot be updated even by an elevated database actor'
);
select throws_ok(
  $$delete from public.evaluations where id = '70000000-0000-4000-8000-000000000001'$$,
  '55000',
  null,
  'evaluations cannot be deleted even by an elevated database actor'
);
select throws_ok(
  $$update public.case_versions set case_id = 'changed' where id = '30000000-0000-4000-8000-000000000001'$$,
  '55000',
  null,
  'a frozen case version cannot be changed'
);
select throws_ok(
  $$update public.blind_policies set mode = 'none' where assignment_id = '40000000-0000-4000-8000-000000000001'$$,
  '55000',
  null,
  'a required blind-policy version cannot be rewritten'
);
select throws_ok(
  $$update public.assignments set case_version_id = '30000000-0000-4000-8000-000000000002' where id = '40000000-0000-4000-8000-000000000001'$$,
  '55000',
  null,
  'an assignment cannot move to another case version'
);
select throws_ok(
  $$
    update public.staff_case_grants
    set permission = 'author'
    where staff_identity_id = (select id from public.github_identities where github_user_id = 202)
      and permission = 'protected-case'
  $$,
  '55000',
  null,
  'an existing staff grant cannot be widened or moved to another case'
);

update public.staff_case_grants
set revoked_at = statement_timestamp()
where staff_identity_id = (select id from public.github_identities where github_user_id = 202)
  and case_version_id = '30000000-0000-4000-8000-000000000001'
  and permission = 'protected-case';
select ok(
  not private.check_assignment_access(
    '10000000-0000-4000-8000-000000000002',
    '40000000-0000-4000-8000-000000000001',
    'staff-read-protected-case',
    1
  ),
  'revoking a staff grant takes effect on the next service-side decision'
);

set local role service_role;
select ok(
  private.advance_blind_policy(
    '10000000-0000-4000-8000-000000000002',
    '40000000-0000-4000-8000-000000000001',
    1,
    2,
    'none',
    null
  ),
  'an authorized staff member can advance the policy through the controlled operation after Attempt 1'
);
select is(
  (
    select required_blind_policy_version
    from public.assignments
    where id = '40000000-0000-4000-8000-000000000001'
  ),
  2,
  'the controlled transition atomically binds the new policy version'
);
select ok(
  not private.check_assignment_access(
    '10000000-0000-4000-8000-000000000002',
    '40000000-0000-4000-8000-000000000001',
    'staff-author-case',
    1
  ),
  'the previous policy version becomes stale immediately after the transition'
);
select ok(
  private.check_assignment_access(
    '10000000-0000-4000-8000-000000000002',
    '40000000-0000-4000-8000-000000000001',
    'staff-author-case',
    2
  ),
  'the newly bound policy version preserves the authorized case action'
);
reset role;

select * from finish();
rollback;
