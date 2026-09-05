# Assignment provisioning

This server-only package reserves one deterministic repository identity per student and published case version, reconciles provider state before every retry, and withholds student readiness until invitation and repository readback pass. Repository creation receives the exact path-sorted student files, verifies their bytes and manifest before the request, and requires the provider to return the same file inventory. An uncertain provider lookup never authorizes another create or invite.

The provisioning path derives protected canaries on the server and checks the exact student file bytes before it persists an assignment or calls the provider. It then scans the exact materialized provider snapshot immediately before each new invitation dispatch. A definitively failed invitation can be retried only after another scan of current repository state; uncertain outcomes are read back without redispatch. After acceptance it scans again before readiness. Both provider scans must carry a recomputed receipt identity, a trusted scanner version, server-bounded time, the same retry generation, canary set, and complete repository-state digest. The concrete local scanner covers working files, every ref, all reachable Git objects and history, and build output; unsupported filesystem entries fail closed. The provider boundary is an interface plus an in-memory mock, so no credential, network call, repository creation, or invitation is performed by the public test suite. Provider failures are stored and logged only as allowlisted codes; raw errors, tokens, and protected values never enter requests, ordinary logs, or durable receipts.

The local Supabase migration is the publication and assignment authority. It creates the final approved digest itself, retains the exact canonical packages and calibration bytes, binds a non-blind human actor, and closes direct service-role insert paths. Append-only scan and operation receipts make cross-process retries converge without duplicate transitions or attempts. The active pre-invitation receipt may advance only before an invitation is confirmed, and every retry dispatch requires a fresh receipt. Once dispatched, the exact historical receipt remains valid for later acceptance while readiness still requires a fresh post-acceptance scan. A readiness scan cannot be recorded until the accepted numeric invitee identity is durable, and stale or future client scan times are rejected when recorded. The in-memory store exists only to exercise the adapter workflow; it is not an approval or hosted authorization boundary.

Local verification:

```sh
npm test -- --run packages/provisioning/test
supabase db reset --local
supabase test db --local
bash supabase/tests/publication_assignment_concurrency.sh
bash supabase/tests/publication_digest_compatibility.sh
supabase db lint --local
```

A real GitHub App adapter, hosted human-auth transport, installation-scope readback, and real private-repository proof remain pending. Because a GitHub login can change between lookup and invite, hosted readiness must continue to rely on the numeric invitee and collaborator ID; the login is retained only as the current provider readback.
