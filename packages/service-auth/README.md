# Service authorization foundation

This package gives service routes two reusable safety boundaries:

- `withAssignmentAuthorization` refuses the request once from current state, then reloads and checks the same actor, assignment, case version, role, and blind-policy version inside the elevated operation's locking boundary.
- The credential helpers issue short-lived pairing codes and assignment-scoped CLI tokens while persisting only purpose-separated keyed digests. Pairing consumption and token creation are one atomic store operation.

The backing store must derive `AuthenticatedActor` from the GitHub provider record in `auth.identities`. Editable profile metadata, email addresses, display names, and the current GitHub login are not authorization inputs.

`withLockedAuthorizationSnapshot` must hold a database transaction or equivalent serialization lock until its callback finishes. Returning a snapshot and committing before the callback would reintroduce a check-to-write race and does not satisfy the interface contract.

The migration in `supabase/migrations` supplies the corresponding local data boundary. Browser roles can read only RLS-filtered student-visible records and cannot write official records. The elevated service role can persist allowed changes, but possession of that credential is not authority; each route must pass through this package before using it.

Submission acceptance stores a database-normalized JSON receipt, computes its receipt digest internally, and verifies required identity fields and minimum packet shape. The packet's separate semantic `submissionDigest` is produced and validated by `@volta-sim/core` before this boundary is called.

Run the focused proof with:

```sh
npm test -- --run packages/service-auth/test
supabase db reset --local
supabase test db supabase/tests/identity_private_access.test.sql --local
bash supabase/tests/provider_identity_toctou.sh
supabase db lint --local --schema public,private --level warning --fail-on error
```

These are local checks. GitHub OAuth setup, hosted row-policy probes, credential revocation from a second machine, and the real Rishabh blind-session proof remain hosted pilot obligations.
