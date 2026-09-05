# Issue 03: Publication and Assignment

## Outcome

An authorized staff member can approve one exact validated case version and create one isolated assignment whose private GitHub repository contains only the intended student bundle. Partial GitHub failures are recoverable without duplicate repositories or leaked protected material.

## Scope ownership

- **Product requirements:** SR-03, SR-04, SR-18
- **Acceptance examples:** AC-01, AC-02
- **Estimate:** 2-3 focused engineering days.
- **Depends on:** Issues 01 and 02.
- **Blocks:** Issue 05 and the hosted pilot in Issue 07.

## Current evidence status

- **Implemented and verified locally:** An additive database migration records validated canonical packages, exact student repository files, methodology and requirement snapshots, three byte-backed calibrations, and an authorized non-blind reviewer. Approval creates the final approved source and digest inside one transaction. Published versions, calibration bindings, clean-scan receipts, and operation receipts are append-only, while ordinary service-level direct inserts are denied. Durable operation locks converge concurrent validation, approval, assignment, and provisioning-transition retries without duplicate attempts.
- **Implemented against a strict mock and synthetic Git repositories:** One deterministic repository is reserved per student and version. Exact student bytes are checked against server-derived protected canaries before persistence or any provider call. The adapter receives only a clean materialization, reconciles after timeouts, rescans before every new invitation dispatch after a definitive failure, and distinguishes authoritative absence from an uncertain lookup that must not be retried. Readiness requires a fresh post-acceptance scan with a recomputed receipt identity, trusted scanner version, server-bounded time, and the same scan generation, canary set, and complete repository-state digest, plus exact repository and collaborator readback.
- **Not implemented or proven:** A real GitHub App adapter, selected-repository installation scope, hosted human-auth transport, real repository/invitation readback, and the hosted leak scan.
- **Completion state:** The local-only increment is complete. Issue 03 and AC-01/AC-02 remain open until the hosted proofs pass.

## In scope

- Atomic approval and publication of the exact validated visible and protected package digests.
- Immutable published case versions and calibration bindings.
- One isolated assignment record per student and case version.
- One private organization repository per assignment, created from the public template at a recorded commit.
- Addition of only the approved student bundle and workspace material.
- Collaborator invitation using the current login resolved from the immutable GitHub provider identity.
- Synchronous, idempotent provisioning with explicit partial-failure states and staff-visible retry.
- Repository and invitation readback before assignment readiness.
- Full working-tree, refs, and reachable-history protected-canary scan.

## Out of scope

- Case validation rules and importer: Issue 01.
- Human identity and access rules: Issue 02.
- Student CLI interactions: Issue 05.
- Queues, webhooks, automatic template synchronization, email notification, cleanup automation, and post-program repository policy.

## Exact behaviors

1. Approval accepts only a validation result for the exact current student/protected package digests and three distinct calibration artifacts whose stored bytes reproduce their protected anchor digests.
2. The approver is an authenticated, authorized human who is not the blind assignee for that case.
3. Publication atomically stores approver, approval time, canonical bytes, both package digests, overall case-version digest created at approval, methodology and requirement snapshots, and calibration bindings.
4. A material edit creates a new draft version and cannot reuse the prior approval.
5. Assignments bind permanently to one published case-version digest.
6. Two assignments for the same version receive identical starting bundle and evidence availability but separate service state and repositories.
7. Each assignment reserves one deterministic repository identity before calling GitHub.
8. The provisioning states are `provisioning`, `repository_created`, `invitation_pending`, and `ready`, with failure metadata that does not contain credentials or protected content.
9. After any timeout, the service reads GitHub before retrying. An uncertain or eventually consistent absence never redispatches creation or invitation; only authoritative absence can do so.
10. A failed invitation resumes against the existing repository after resolving the assignee's current login.
11. The repository is private, points to the trusted configured template commit, and materializes the exact approved student files rather than accepting a caller-supplied digest alone.
12. An assignment becomes ready only after provider repository ID, private visibility, owner, name, template and materialized commits, bundle and manifest digests, file inventory, immutable collaborator ID, current login, least permission, invitation ID, and acceptance are read back.
13. A student without an accepted invitation receives no repository or service access.
14. Provisioning and retry are idempotent under duplicate requests and concurrent staff actions.
15. The exact student materialization is checked against a server-derived protected-canary set before assignment persistence or any provider call. The exact provider snapshot is then scanned immediately before every new invitation dispatch, including retries after a definitive failure. After accepted-invitation readback, a fresh scan is required before readiness. Receipts bind assignment, provider repository, template and materialized commits, exact bundle/manifest/files, canary-set digest, trusted scanner version, retry generation, full repository-state digest, and server-bounded time; their complete identity is recomputed before use.
16. A hidden ref, reachable-history object, build output, unsupported filesystem entry, changed repository-state digest, weaker canary set, tampered receipt, untrusted scanner, stale/future scan time, timeout, or scanner failure prevents invitation or readiness. Raw canary values never enter assignment records, GitHub-facing payloads, ordinary audit output, or database receipts.

## Data and access obligations

- Persist immutable case versions, approval records, assignments, provisioning attempts, operation receipts, provider repository IDs, invitation state, collaborator readback, trusted template/materialized commits, canonical student materialization, bundle/manifest digests, and the two stage-bound clean-scan receipts.
- Only authorized non-blind staff can approve, publish, assign, or retry provisioning.
- The GitHub App credential stays server-side. Its installation is limited to the public template and repositories it creates, without access to unrelated Volta repositories.
- Required permissions are limited to repository administration for creation/collaboration, contents for template and bundle operations, and metadata readback.
- Protected package bytes and raw canaries never pass through the repository builder, temporary Git worktree, commit history, ordinary logs, GitHub request payloads, or durable scan receipts.
- Published case, approval, and assignment-version bindings cannot be updated or deleted by ordinary application roles.
- GitHub login remains a mutable invitation lookup. A login rename can race the provider call, so readiness always requires both the accepted invitation and final collaborator readback to carry the assignment's immutable numeric GitHub ID. The hosted proof must exercise or otherwise read back that provider behavior.

## Falsifiable local proofs

- [x] Reject approval for invalid, uncalibrated, stale-digest, already used, or superseded validation inputs.
- [x] Publish the valid exact version and prove both package digests, exact canonical source, approval record, and byte-backed calibrations commit together.
- [x] Modify visible and protected material after validation; prior approval cannot publish it.
- [x] Create two assignments for one version and compare starting bundle/manifest digests while denying cross-assignment readiness.
- [x] Mock repository success followed by timeout; retry finds the original repository and creates no duplicate.
- [x] Mock repository success plus invitation failure; retry performs only the missing invite/readback work.
- [x] Replay duplicate and concurrent approval/reservation/provisioning requests across database sessions; one publication, assignment, transition, attempt, operation receipt, and repository identity survive.
- [x] Put the full scanner on the actual synthetic provisioning path. Dirty working files, refs, reachable Git objects/history, build output, unsupported entries, timeouts, and scanner failures produce zero invitations.
- [x] Put a protected canary in an otherwise valid exact student materialization; preflight rejects it before persistence and before every provider call, without exposing the canary in requests, records, errors, or logs.
- [x] After a definitive invitation failure, mutate hidden repository state and retry; a new invitation scan runs, blocks redispatch, and preserves prior receipts as append-only evidence.
- [x] Mutate a hidden ref, reachable history, and build output after the clean invitation scan; the fresh readiness scan prevents the assignment from becoming ready.
- [x] Reject a pre-ready scan before accepted invitation readback, stale/future scan times, cross-assignment receipts, a weaker canary set, changed full repository-state digest, tampered receipt identity, untrusted scanner version, changed generation, or reversed scan time. Preserve the exact historical invitation receipt through delayed acceptance while still requiring a fresh readiness receipt.
- [x] Run the Issue 03 pgTAP file with another legitimate case/publication/assignment fixture already present; owned counts and proof remain isolated.
- [x] Reject public visibility, wrong owner/name/template/bundle/manifest/files, replaced provider/invitation IDs, or excessive collaborator permission.
- [x] Prove synthetic credentials, protected canaries, and raw provider failures never enter adapter logs or student repository requests.

## Hosted proofs

- [ ] Matt approves one exact fictional case version and reads back the immutable approval and package digests.
- [ ] Create a real private test assignment repository in `Volta-Labs-Inc` from the recorded public-template commit.
- [ ] Read back privacy, owner, repository ID, commit, bundle digest, collaborator permission, and invitation state.
- [ ] Confirm the invitation remains pending until acceptance and the assignment is not prematurely ready.
- [ ] Fail or interrupt one provisioning step, retry, and confirm the same repository is reconciled.
- [ ] Scan the real repository's working tree, all refs, and reachable objects for protected canaries.
- [ ] Probe repository and service access as anonymous, wrong student, uninvited account, and blind staff assignee.

## Rollback

- Disable new approval, assignment, and provisioning operations first.
- Revert the hosted service deployment while preserving published cases, assignments, and provisioning readbacks.
- Correct schema or access faults with additive forward migrations; do not rewrite a published version.
- Reconcile a partially created repository from stored provider IDs. Do not automatically delete, rename, or recreate it.
- Revoke the GitHub App credential or installation if its boundary is uncertain. Existing private repositories remain preserved for manual review.

## Evidence record

| Evidence | Status | Artifact or readback | Verified by/date |
|---|---|---|---|
| Atomic exact-version approval and durable scan gate | Verified locally | `supabase test db --local`: 2 files / 145 assertions pass, including publication, exact-source, calibration-byte, privilege, bounds, two-stage scan freshness, operation-receipt, and immutability checks; it also passes with the committed concurrency fixture present | Codex / 2026-09-04 |
| Cross-runtime final digest | Verified locally | `bash supabase/tests/publication_digest_compatibility.sh`: database-approved source reproduces its digest through core | Codex / 2026-09-04 |
| Material-change invalidation | Verified locally | pgTAP denies altered visible/protected digests, arbitrary draft digests, consumed and superseded validations | Codex / 2026-09-04 |
| Durable duplicate/concurrent operations | Verified locally | `bash supabase/tests/publication_assignment_concurrency.sh`: competing sessions wait and converge on one publication, assignment, provisioning transition, attempt, and operation receipt | Codex / 2026-09-04 |
| Idempotent provisioning failures | Verified with mock only | `packages/provisioning/test`: 57/57 pass for pre-provider byte preflight, authoritative-vs-uncertain absence, timeout reconciliation, fresh-scan invitation retry, hostile-receipt rejection, exact readback, bounded materialization, two assignments, and safe logs | Codex / 2026-09-04 |
| Provisioning-path full-history canary scan | Verified locally | `packages/provisioning/test`: the concrete Git scan runs immediately before invitation and after acceptance; a failed-invite retry rescans, and post-scan ref/history/build mutations, unsupported entries, stale state, weaker canary sets, timeouts, and failures cannot reach readiness | Codex / 2026-09-04 |
| Workspace quality and dependency audit | Verified locally | Pinned Node 22.23.2/npm 10.9.9: `npm run verify` passes 16 files / 252 tests; `npm audit --audit-level=high` reports 0 vulnerabilities; clean database reset plus 2 files / 145 pgTAP assertions pass; database lint reports no schema errors | Codex / 2026-09-04 |
| Real private repository and invitation readback | Pending; AC-02 blocker | Requires selected-scope GitHub App and accepted real invitation | Pending |
| Hosted human approval | Pending; AC-01 blocker | Requires hosted auth transport and Matt's exact fictional-case approval | Pending |

## Completion gate

The local implementation is ready for hosted integration. Issue 03 is shippable only after an authenticated hosted approval and one real private test repository pass the complete repository, invitation, permission, and leak readback. Local database and mock success do not satisfy AC-01 or AC-02 and do not prove the blind pilot journey.
