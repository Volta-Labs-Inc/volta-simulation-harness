# Issue 02: Identity and Private Access

## Outcome

Every person and CLI session is bound to the correct immutable GitHub identity and assignment. Anonymous people, other students, uninvited contractors, and a blind staff assignee cannot reach protected case or assignment data. Rishabh retains student access to his own Attempt 1 while every ordinary staff privilege for that case remains denied until an accepted submission.

## Scope ownership

- **Product requirements:** SR-05, SR-12, SR-15, SR-18
- **Acceptance examples:** AC-02, AC-09
- **Estimate:** 2.5-3 focused engineering days.
- **Depends on:** Issue 01.
- **Blocks:** Issues 03 and 04.

## Current evidence status

- **Implemented and verified locally:** The reproducible Supabase migration persists immutable numeric GitHub provider identities from `auth.identities`, case-scoped staff grants, exact-version blind policies, assignments, one-time pairing codes, assignment-scoped token hashes, append-only official records, deny-by-default grants and row rules, and atomic submission/blind-restoration behavior. The service authorization package repeats the same fail-closed actor, assignment, case-version, attempt, role, and blind-policy decision immediately before elevated work.
- **Local proof:** A fresh database reset applies migration `20260904134924`; 82 pgTAP checks pass; 19 focused service-authorization tests pass; the provider-identity concurrency reproducer denies a submission when the GitHub identity changes while waiting; and anonymous local Data API requests return `401` for assignments, official events, submissions, evaluations, and CLI tokens.
- **Adversarial corrections:** The original QA failures are closed locally: the service role cannot directly lift blindness, provider identity is locked and revalidated during submission, incomplete packets cannot change assignment state and the database owns the normalized receipt/digest, and elevated requests remain bound to the exact assignment, case version, attempt, and blind-policy version across both authorization reads.
- **Still pending:** Real GitHub OAuth/provider behavior, hosted grants and Data API probes, pairing and revocation from a second machine/session, and Rishabh's real before/after Attempt 1 blind run.
- **Completion state:** The local identity/private-access foundation is implemented and verified. Issue 02 remains incomplete at the hosted integration boundary; this evidence does not satisfy AC-02 or AC-09 and does not establish production readiness.

## In scope

- GitHub OAuth sign-in through Supabase using a dedicated OAuth application.
- Persistent binding to GitHub's immutable numeric provider identity.
- Staff membership, case authorization, assignment membership, blind policy, and attempt state.
- A case-specific effective-role decision shared by browser, API, CLI, and elevated operations.
- Explicit database grants and row-level access for anonymous, assigned student, wrong student, ordinary staff, and blind staff.
- Short-lived, one-time browser-to-CLI pairing and assignment-scoped opaque tokens stored only as hashes.
- Revocation, expiry, last-use tracking, successive-session behavior, and indistinguishable not-found denials.

## Out of scope

- Private repository creation and GitHub App credentials: Issue 03.
- Provider credentials and interaction authorization: Issue 04.
- CLI commands beyond login/resume/logout: Issue 05.
- Long-term identity lifecycle, organization-wide SCIM, automated offboarding, and retention policy.

## Exact behaviors

1. Authorization uses the immutable GitHub provider ID from the authenticated identity record, never user-editable profile metadata, email, display name, or login.
2. A GitHub login is treated only as current contact information and is resolved immediately before Issue 03 invites a collaborator.
3. An assigned student can list and read only their assignment, visible case bundle, released evidence, official activity, and released feedback.
4. Other students and uninvited people receive no record, list entry, existence clue, or mutation path for that assignment.
5. Ordinary staff reaches only cases covered by explicit staff authorization.
6. If a staff member is the blind student for a case and Attempt 1 is not submitted, every protected read and staff action is denied before any broader staff rule is considered.
7. An invalid, incomplete, or interrupted submission does not restore blind staff access.
8. The accepted Attempt 1 transition restores ordinary staff access once and records the effective-role change.
9. Elevated server operations repeat the actor, assignment, attempt, and blind decision even though their database credential can bypass row filtering.
10. Pairing codes expire quickly, work once, and reveal no token in logs. CLI tokens are random, assignment-scoped, expiring, revocable, and checked on every request.
11. Revocation or assignment removal takes effect on the next request, including an existing CLI or browser session.
12. Authentication failure and authorization failure disclose no protected object content.

## Data and access obligations

- Persist profiles with immutable provider identity, staff memberships, case authorizations, assignments, blind policies, pairing grants, token hashes, expiry/revocation, and audit metadata.
- Use a dedicated pilot database with explicit grants and row-level denial. Do not reuse another Volta application's project.
- New tables and views are not assumed to be exposed or protected by defaults; both grants and row behavior require tests.
- Views preserve the caller's access. Any elevated database operation is private, narrowly callable, and repeats the effective-role decision.
- Browser and CLI receive public identifiers and authorized content only. Elevated database credentials never reach either client.
- Before migrations apply, record that no other application, deployment, job, or script uses the pilot database URL.

## Falsifiable local proofs

- [x] Persist the immutable numeric GitHub provider ID from seeded `auth.identities` records; reject nonnumeric or changed provider bindings and ignore user-editable metadata.
- [x] Change the GitHub login while retaining the numeric provider ID; contact information refreshes without changing authorization identity.
- [x] Exercise allowed and denied local operations as anonymous, assigned student, wrong student, authorized staff, unauthorized staff, and blind staff.
- [x] Deny blind access through database rules and the elevated service decision, including stale role and blind-policy state; dashboard and hosted Data API proof remains pending.
- [x] Reject an incomplete Attempt 1 packet without restoring blind access; the concurrent provider-identity mutation also produces no submission or restoration.
- [x] Accept Attempt 1 atomically; ordinary case-scoped staff access returns only afterward.
- [x] Create, exchange, reuse, expire, revoke, and cross-assignment-test one-time pairing codes and hashed tokens; only current assignment-scoped credentials resolve.
- [ ] Pair and revoke from a second clean machine/session, then prove the next request fails through the real CLI and hosted service.
- [ ] Compare hosted absent and unauthorized lookups and confirm their status/body disclose no object existence.
- [x] Run database tests proving intended-role success and stopped-role failure across the local matrix.

## Hosted proofs

- [ ] Complete GitHub OAuth through a fresh browser session and read back the provider identity stored by Supabase.
- [ ] Attempt metadata spoofing and confirm no access change.
- [ ] Pair a CLI from a clean machine/session, resume the assignment, then revoke it and prove the next request fails.
- [ ] Probe active data anonymously and as a wrong student through both API and direct database client paths.
- [ ] Use Rishabh's stale staff session before Attempt 1 submission; protected dashboard/API/database/elevated routes all deny him while student status remains available.
- [ ] Read back grants, row rules, role bindings, blind policy version, and audit events from the hosted database.

## Rollback

- Disable new sign-in and CLI pairing while preserving existing identity and audit records.
- Revoke affected CLI tokens and OAuth sessions when identity binding is uncertain.
- Roll back browser/service code to the last verified release, but correct database protection with additive forward migrations.
- Default to denial if blind-policy or staff-authorization state cannot be verified.
- Never restore access by deleting an audit record or changing an accepted attempt.

## Evidence record

| Evidence | Status | Artifact or readback | Verified by/date |
|---|---|---|---|
| Reproducible local schema | Verified locally | `supabase db reset --local`; migration `20260904134924_identity_private_access.sql` applied successfully | Codex / 2026-09-04 |
| Provider identity binding | Verified with local Supabase identity fixtures | `identity_private_access.test.sql`: immutable numeric `provider_id`, metadata spoof denial, rename preservation, changed/nonnumeric identity rejection | Codex / 2026-09-04 |
| Database allow/deny and state matrix | Verified locally; 82/82 pgTAP checks pass | `supabase test db supabase/tests/identity_private_access.test.sql --local` | Codex / 2026-09-04 |
| Elevated service authorization | Verified locally; 19/19 focused tests pass | `npx vitest run packages/service-auth/test` | Codex / 2026-09-04 |
| Submission receipt and minimum shape defense | Verified locally | Incomplete packet rejected; caller-controlled receipt digest removed; stored receipt text/digest match the database-derived packet representation | Codex / 2026-09-04 |
| Provider-identity submission race | Verified locally | `bash supabase/tests/provider_identity_toctou.sh`: identity mutation while waiting returns `DENIED`, creates zero submissions, and leaves restoration unset | Codex / 2026-09-04 |
| Anonymous local Data API probes | Verified locally | HTTP `401` for assignments, official events, submissions, evaluations, and CLI tokens | Codex / 2026-09-04 |
| Original four adversarial QA failures | Corrected and regression-tested locally | Direct blind-policy bypass denied; provider identity revalidated under lock; malformed packet blocked with database-owned receipt; assignment/case/attempt drift denied | Codex / 2026-09-04 |
| OAuth provider identity binding | Pending hosted proof | Fresh GitHub OAuth session and Supabase provider-identity readback | Pending |
| Second-machine CLI pairing and revocation | Pending hosted proof | Clean-machine pairing, successive request, revoke, and next-request denial | Pending |
| Hosted blind-role and Data API probes | Pending; pilot gate | Hosted grants/row-rule readback plus Rishabh dashboard, API, database, and elevated-route probes before and after Attempt 1 | Pending |

## Completion gate

The reusable local foundation has passed its migration, database, concurrency, service-authorization, anonymous-request, full-workspace, and dependency-audit checks. Issue 02 is not complete or production-ready until real GitHub OAuth identity binding, hosted grants/Data API behavior, second-machine CLI pairing and revocation, and Rishabh's before/after Attempt 1 blind run are captured. Those hosted results are required evidence for AC-02 and AC-09 and remain part of Issue 07's final pilot gate.
