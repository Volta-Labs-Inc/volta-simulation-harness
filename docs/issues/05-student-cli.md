# Issue 05: Student CLI

## Outcome

An assigned student can resume a simulation from their private repository, investigate through official personas and evidence, record reasoning and estimates, request staff review, work locally with any chosen tool, and submit a reproducible packet without exposing private work-agent activity or unrelated workspace data.

## Scope ownership

- **Product requirements:** SR-05, SR-09, SR-10, SR-11, SR-13, SR-14
- **Acceptance examples:** AC-05, AC-09
- **Estimate:** 2-2.5 focused engineering days.
- **Depends on:** Issues 03 and 04.
- **Blocks:** Issue 06 and the full journey in Issue 07.

## Current evidence status

- **Implemented locally:** The tool-neutral CLI completes a deterministic login-stub-to-reopened-resume journey. It guides the student's own evidence, rationale, estimates, expected evidence, pivot/stop conditions, criteria, calculations, competency claims, response choice, review request, and submission without supplying a judgment. Explicit text artifacts are bound to the assigned GitHub repository, commit, and blob IDs, while the reusable core remains the final completeness and acceptance authority.
- **Locally protected:** Production commands cannot select a network origin, repository root, or token path. The current checkout must match the repository and commit returned at login. The service pins the committed assignment `.gitignore` blob, the CLI reads it back byte-for-byte, and Git must confirm that both local control records are ignored. The user-only `.volta-sim/session.json` and recoverable pending-submission record contain no protected service truth. Mock protected state lives outside the student workspace and reaches the CLI only through allowlisted responses.
- **Locally resilient:** A submission is written to the ignored pending record before transmission. If the service commits but the response is lost, the next invocation resends the exact packet and operation ID, receives the one stored result, and removes the pending record. A rejected submission exits nonzero. No-build mode refuses selected artifacts before reading them, and the shared packet contract rejects all no-build artifacts.
- **Not implemented or verified:** Browser pairing, hosted API authorization, trusted hosted review resolution, GitHub repository materialization/readback, a distributed CLI release, hosted telemetry inspection, and the two-model student pilot remain pending.
- **Completion state:** The focused local increment and full local workspace are verified; hosted acceptance and AC-05/AC-09 remain open.

## In scope

- Commands for login/pairing, resume, status, talk, evidence request, collection, time advancement, evidence-ledger entries, decisions, estimates, checkpoints, review requests, submission, and logout.
- Visible brief, rubric, applicable requirements, completeness, available personas/evidence, released evidence, and official provenance.
- Student rationale when marking an eligible requirement not applicable.
- Open-ended checkpoints after meaningful decisions and evidence events.
- Non-blocking elevated-risk review guidance.
- Explicit-only telemetry and assignment-root file handling.
- Bounded supported artifact capture at a verified Git commit.
- Idempotent request retry and clear online/offline/failure feedback.

## Out of scope

- A separate student web application, editor, coding agent, or mandated implementation stack.
- Inspection of Claude Code, Codex, Cursor, shell, environment, processes, credentials, or unselected files.
- Execution, build, deployment, dependency installation, or automatic discovery of student artifacts.
- Public deployment, student-provided provider credentials, voice, offline simulation, or arbitrary evidence connectors.
- Staff dashboard and human evaluation: Issue 06.

## Exact behaviors

1. `login` opens the approved browser pairing flow and returns only an assignment-scoped CLI token.
2. `resume` restores the server-authoritative assignment, attempt, event cursor, evidence state, pending or resolved review state, and a safe prior-attempt summary without duplicating prior actions. Reopening preserves the full accepted submission, events, evidence, and provider provenance in service-owned history.
3. `status` shows the brief, rubric, applicable requirements, completeness state, available personas/evidence, recent official evidence, and simulation stage. It withholds quality judgment and hidden anchors.
4. `talk` sends an explicit question to one available persona and displays generated wording separately from authoritative fact IDs and provenance.
5. `request`, `collect`, and `advance` submit explicit evidence/collection actions and show their authored outcomes and simulated time effects.
6. The student can record a fact, assumption, contradiction, or unknown. A fact must reference harness-released provenance.
7. The student can record a recommendation, buy-versus-build reasoning, estimate, confidence, expected evidence, pivot/stop condition, metric, baseline or baseline plan, target, date, economic projection, and failure threshold.
8. Meaningful events trigger open-ended checkpoint prompts without supplying an estimate, correct answer, or quality judgment.
9. Elevated-risk actions suggest staff review and record the student's choice; declining or waiting for review does not block later sandbox work.
10. `review-request` creates an asynchronous official request only when the student chooses continue or wait. Declining creates no pending request. The student can continue and later see an allowlisted staff response.
11. `submit` first reports missing requirements and provenance without rating quality. An accepted submission freezes the exact official-event cutoff and evidence state.
12. Build-mode submission includes only supported text files the student explicitly selects. No-build submissions require no artifact at the CLI, service request, and shared packet boundaries.
13. Selected paths must remain beneath the assignment root and cannot be absolute, traversal, hidden credential paths, symlinks, devices, submodules, unsupported types, or oversized content.
14. The CLI never enumerates or transmits private agent files, transcripts, shell history, environment, processes, parent directories, unrelated files, or a GitHub CLI token.
15. Every mutating command uses one operation ID and safely resumes after timeout. Submission also survives a committed response being lost across separate CLI processes.
16. The fixed service client limits response bytes and applies one hard deadline across both response headers and body. Timeout aborts transport and cancels a started body.
17. Errors say what the student can do next without revealing protected case or another assignment. A service rejection returns a failing process result for automation and agents.

## Data and access obligations

- The CLI receives only student-visible assignment data and writes only allowed student actions for the active attempt.
- Store the opaque CLI token in a user-only local file. Never print it after pairing or include it in diagnostic output.
- The hosted service records official actions, not command-line history or private tool activity.
- Artifact capture records path, media type, byte length, content digest, bytes, verified Git commit, and Git blob for explicitly selected supported content only. It compares raw working bytes with raw committed object bytes without invoking Git diff, text conversion, or clean/smudge filters.
- Server time, sequence, accepted event cutoff, assignment identity, and case-version digest override client claims.
- API responses remain allowlisted so a newly added protected field cannot reach the CLI automatically.

## Falsifiable local proofs

- [x] Run the complete CLI journey from login stub through status, persona interaction, collection, student-authored reasoning, review request, submission, logout, and reopened resume.
- [x] Expire, revoke, reuse, and replace a token; unauthorized requests fail without losing the service-side official record.
- [x] Interrupt every mutating command after its commit but before its response, retry, and prove one official result.
- [x] Confirm status and completeness contain no rating, score, quality, evaluation anchor, or expected answer.
- [x] Mark an eligible requirement not applicable with and without rationale; only the explicit rationale is recorded.
- [x] Submit a complete no-build packet built from guided commands and a bounded selected-text build packet; both preserve required evidence and calculations.
- [x] Require structured expected-evidence and pivot/stop records in the shared packet and collect them through bounded guided command fields.
- [x] Reject every no-build artifact in the shared contract and refuse a selected no-build path before artifact capture or submission.
- [x] Omit each required submission field and use stale or wrong-assignment provenance; acceptance fails and Attempt 1 remains active.
- [x] Interrupt a CLI submission after the service commits but before the response, retain the ignored pending packet, replay the exact request from a new process, and receive the single stored result. A service-declined packet exits nonzero.
- [x] Reopen a submitted attempt and prove the service-owned Attempt 1 submission, events, evidence, provider provenance, and replay receipt remain unchanged while the CLI receives only a safe history summary.
- [x] Decline suggested review and prove no pending request exists; resolve an accepted local review and expose only the allowlisted response. Hosted staff delivery is still pending.
- [x] Place canaries in agent configuration, transcripts, shell history, environment, process arguments, parent paths, unselected files, and private service truth; student output and captured requests contain none, and network capture contains only the injected loopback service.
- [x] Attempt absolute, traversal, dot-control, control-character, Unicode-separator, symlink, device, submodule, oversized, unsupported, and out-of-root artifacts; reject before content transmission.
- [x] Pin the trusted template `.gitignore` blob, compare working and committed bytes, and use `git check-ignore` for the session and pending-submission records.
- [x] Install hostile local diff, text-conversion, clean/smudge, and filesystem-monitor settings; prove selected-file verification executes none and compares raw committed-object bytes.
- [x] Stall response headers, stall a response body, and continuously trickle body bytes; prove one absolute deadline aborts transport and cancels the body. Reject an oversized response before parsing.
- [x] Confirm formula-prefixed CSV and active-looking HTML/Markdown content remains inert text and triggers no retrieval or execution in the CLI boundary.

## Hosted proofs

- [ ] Pair from a clean machine/session using GitHub identity and resume the correct assignment from its private repository.
- [ ] Run successive sessions and a revoked-token session to detect stale state.
- [ ] Complete the approved student flow through both configured model choices and representative evidence actions.
- [ ] Continue sandbox work after elevated-risk review guidance and verify no production endpoint or credential is available.
- [ ] Instrument the assignment workspace and outbound traffic; prove explicit-only telemetry and zero private canaries.
- [ ] Submit no-build and selected-text-artifact test packets; read back event cutoff, evidence snapshot, calculations, Git commit, and artifact digests.
- [ ] View only official activity from the staff account; no private work-agent content appears.

## Rollback

- Disable new CLI pairing or mutating commands while leaving the student's repository and existing official record intact.
- Revoke affected tokens and distribute a corrected CLI release through the approved channel.
- Keep prior events and submissions immutable. A client retry reconciles from the server event cursor.
- Never remove student repository content or scan the workspace as part of rollback.

## Evidence record

| Evidence | Status | Artifact or readback | Verified by/date |
|---|---|---|---|
| Submission behavior foundation | Verified locally | `core acceptance reused by packages/student-cli/src/mock-service.ts`; malformed, stale, wrong-assignment, no-build, and build probes | Codex / 2026-09-04 |
| Complete CLI subprocess journey | Verified locally | Pinned Node 22/npm 10 `vitest run packages/student-cli/test`: 6 files, 55 tests; subprocesses cover login stub, resume/status, official actions, guided reasoning, checkpoint, non-blocking review, no-build submission and early artifact refusal, lost-response replay, rejected-submit exit, logout, and reopened resume | Codex / 2026-09-04 |
| Explicit-only telemetry canaries | Verified locally | File/network audit plus private service, agent configuration, transcript, history, environment, process-argument, parent, and unselected-file canaries | Codex / 2026-09-04 |
| Repository-bound handoff | Verified locally | Pinned repository/commit/template-ignore blob proof, `git check-ignore`, raw selected-byte Git object match, before/after capture verification, hostile diff/filter/filesystem-monitor canaries, and dirty/untracked/mismatched proof denials | Codex / 2026-09-04 |
| Successive-session and retry behavior | Verified locally | Expired, revoked, reused, and replaced tokens; every mutating command interrupted and replayed once; CLI submit recovered after a committed response was lost | Codex / 2026-09-04 |
| Transport bounds | Verified locally | 1 MB response cap plus one absolute header-and-body deadline; header abort, stalled-body cancellation, trickling-body cancellation, and rejected-body disposal probes | Codex / 2026-09-04 |
| Review choice and response | Verified locally only | Decline creates no request; accepted request remains non-blocking; local service resolution exposes only the allowlisted response. Hosted staff delivery remains pending | Codex / 2026-09-04 |
| Hosted student journey | Pending | `[pilot evidence packet]` | `[reviewer/date]` |
| Full local workspace regression after integrated adversarial corrections | Verified locally | Pinned Node 22/npm 10 `npm run verify`: 16 files, 252 tests; `npm audit --omit=dev`: 0 vulnerabilities | Codex / 2026-09-04 |

## Completion gate

The focused local Issue 05 gate and full local workspace verification pass. Issue 05 is not shippable until the same journey, review delivery, privacy instrumentation, GitHub repository readback, token lifecycle, and immutable submission handoff pass against the hosted test service from a clean second machine. This does not claim AC-05, AC-09, production readiness, human evaluation, or a blind pilot.
