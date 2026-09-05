# Issue 06: Staff Evaluation and Reopening

## Outcome

Authorized staff can validate and approve case work through the established boundaries, observe only official assignment activity, answer review requests without blocking the student, evaluate all four competencies, replay questionable provider wording, and reopen a submission as a separate immutable attempt.

## Scope ownership

- **Product requirements:** SR-12, SR-14, SR-15, SR-16, SR-17
- **Acceptance examples:** AC-06, AC-07, AC-08, AC-09
- **Estimate:** 2-3 focused engineering days.
- **Depends on:** Issues 03, 04, and 05.
- **Blocks:** The end-to-end pilot in Issue 07.

## Current evidence status

- **Implemented locally:** `packages/staff-dashboard` provides a synthetic staff workbench with Cases and Assignments entry points, authoritative-state labels, an official-only activity record, non-blocking review responses, four required human judgments, baseline-gated overall derivation, linked replay, immutable reopening, inert artifact display, and formula-neutralized export. The local fixture includes all five case states and the domain proof covers all six assignment states.
- **Browser evidence:** The real-browser journey recorded an effective no-build evaluation, a partially-effective result with the true `3/4` summary, linked replay, reopened Attempt 2, all five inert artifact types, no remote artifact request, no console warning/error, and no narrow-viewport overflow at 390 px. A post-binding smoke run confirmed six receipt-backed official events, immutable accepted baseline fields, five artifact formats, linked replay, reopen, and no private canary or console warning/error.
- **Adversarial corrections:** Official activity now requires independently supplied receipts binding assignment, attempt, case version, sequence, event identity, and exact event digest; duplicates and cross-assignment injection fail closed. Evaluation response facts come only from a digest-bound accepted-submission readback, not the evaluator's form. Artifact display requires a separate immutable submission receipt bound to the accepted assignment/attempt/submission, exact path/type/byte length/digest/bytes, with unsafe paths rejected. Replay requires trusted receipts for both distinct interactions and exact assignment/attempt/case/event/truth linkage. Reopen checks every accepted-attempt binding and safe attempt increment. Review response rejects closed, sandbox-unavailable, duplicate, or mismatched assignment-attempt requests.
- **Not implemented:** Hosted authentication and authorization, API/database role enforcement, durable append-only persistence and operation readback, polling across sessions, real Issue 03 approval handoff, hosted provider replay, and hosted state/readback remain outside this local increment.
- **Completion state:** Local staff journey implemented and verified; hosted and database release boundaries remain blocked.

## In scope

- A small staff dashboard with Cases and Assignments entry points.
- Case validation/preview display backed by Issue 01 and approval/publication actions backed by Issue 03.
- Assignment states: provisioning, active, review requested, submitted, reopened, and closed.
- Polling and manual refresh for official activity; no realtime subsystem.
- Review response and exceptional intervention records that do not block student work.
- Immutable submission packet display with facts, assumptions, contradictions, unknowns, missing-data plan, response, calculations, criteria, artifacts, estimates, and risk/review history.
- Four mandatory human competency judgments and derived overall result.
- Replay that preserves original and replacement records.
- Reopening into a separate attempt with prior evaluation intact.
- Blind-role denial throughout case and assignment views.

## Out of scope

- Rich visual case editor, collaborative editing, bulk operations, analytics, anomaly detection, automatic grading, notifications, queues, webhooks, or realtime subscriptions.
- Private work-agent transcript inspection or automatic artifact execution.
- Appeal workflow beyond a second authorized reviewer recording a separate review where requested.
- Mobile application or production-scale operations.

## Exact behaviors

1. Cases list as draft, needs validation, needs calibration, ready for approval, or published based on persisted authoritative state.
2. The case workspace uploads or selects authored input, shows Issue 01 validation failures and student/protected previews separately, then invokes Issue 03 for exact-version approval/publication.
3. The dashboard never treats successful validation as approval or successful approval as assignment readiness.
4. Assignment state reflects persisted service and GitHub readback rather than browser assumptions.
5. Authorized non-blind staff sees official actions, released evidence, decisions, estimates, review requests, interventions, and submission attempts.
6. No page, export, error, search, or log reveals private agent conversations, shell activity, environment, unselected files, or another assignment.
7. Polling reconciles by event cursor and remains correct after refresh, sign-out/sign-in, retry, and successive state transitions.
8. A staff review response is asynchronous. The student's sandbox remains available before and after the response.
9. Exceptional intervention records actor, reason, effect, and time without rewriting earlier events.
10. Evaluation requires one human rating and rationale for problem viability, evidence sufficiency, response feasibility, and objective success/failure criteria.
11. Overall effective is available only when all four ratings are effective. A missing baseline or credible baseline plan prevents effective evidence/success judgment even when a prototype is polished.
12. A defensible no-build result may be effective when all four competencies are supported.
13. Completeness or model output never creates the qualitative judgment.
14. Replay uses the original selected facts and creates a linked new provider record while preserving the original and existing evaluation.
15. Reopen preserves the original submission and evaluation and creates the next numbered active attempt with its own future evidence state and judgment.
16. Before Rishabh submits Attempt 1, his dashboard, direct API, and stale staff session expose only the student view for that case.

## Data and access obligations

- Dashboard reads use the same case/assignment/blind authorization as API and database access; UI hiding alone is not a control.
- Persist review requests/responses, interventions, provider replays, human evaluations, and attempt lineage as append-only records.
- Staff-facing views explicitly select fields. They do not expose provider credentials, raw protected prompts, secret logs, or private workspace content.
- Submission artifacts render inertly. HTML/SVG cannot execute; Markdown cannot load remote content or make authenticated requests; CSV exports neutralize formulas.
- Approval, replay, evaluation, and reopen mutations use operation IDs and server time and require state/version readback.
- Blind restoration occurs only after the accepted Attempt 1 state is visible from the system of record.

## Falsifiable local proofs

- [ ] Run case validation, preview, approval handoff, and version history at desktop and narrow viewport.
- [x] Run assignment provisioning, active, review-requested, submitted, reopened, and closed states from authoritative fixtures.
- [ ] Refresh or sign in again between successive transitions; no stale action or hidden state appears.
- [ ] Attempt every staff action as anonymous, unauthorized staff, wrong student, assigned student, and blind staff; all denied roles fail at API and database boundaries.
- [x] Confirm the timeline contains only uniquely sequenced receipt-backed official events for the exact assignment attempt and submitted artifacts with independent immutable receipts.
- [x] Evaluate distinct defensible no-build, pilot, and data-collection responses as effective without canonical-answer comparison.
- [x] Evaluate a polished weak-baseline packet; overall effective remains unavailable.
- [x] Omit or downgrade each competency; save fails or derives the correct lower result. Stored contradictory derivations are rejected when projected for replay/reopen.
- [x] Replay one response and verify trusted original/replacement receipts, distinct interactions, exact assignment/attempt/case/event binding, route, facts, provider metadata, and unchanged evaluation.
- [x] Reopen an evaluated attempt and prove the prior submission/evaluation is fully digest-bound and frozen while a safely numbered Attempt 2 is distinct and writable.
- [x] Render hostile HTML, SVG, Markdown, JSON, and CSV fixtures as plain text and observe no script, navigation, remote fetch, or active formula in the local browser/export proof.

## Hosted proofs

- [ ] Matt completes the approved staff flow at desktop and a narrow viewport.
- [ ] Dashboard polling recovers after refresh and sequential review/submission/reopen changes.
- [ ] Rishabh's pre-submission stale staff session cannot reach case authoring, protected truth, calibration, observation, replay, evaluation, or reopen.
- [ ] Matt observes official activity and responds to a review request while Rishabh continues sandbox work.
- [ ] Matt evaluates Attempt 1 across all four competencies and reopens it.
- [ ] Read back immutable Attempt 1 submission/evaluation and distinct Attempt 2 state.
- [ ] Confirm dashboard, exports, and evaluation packet contain no private-workspace canaries.
- [ ] Exercise hostile artifact fixtures in the hosted browser with network and console observation.

## Rollback

- Disable staff mutations while preserving read-only access to verified records.
- Revert the dashboard deployment to the last verified version.
- Correct database behavior with additive migrations; never rewrite an evaluation or attempt.
- Disable replay if provider truth binding is uncertain; preserve original provider records.
- Revoke affected sessions if the blind-role boundary is suspect and keep the assignment paused for staff actions, not student sandbox work.

## Evidence record

| Evidence | Status | Artifact or readback | Verified by/date |
|---|---|---|---|
| Human rating, official-view, review response, replay, reopen, artifact receipt, and adversarial binding behavior | Local proof: 31/31 focused tests | `packages/staff-dashboard/test/domain.test.ts`; pinned Node 22.23.2/npm 10.9.9 | Codex / 2026-09-04 |
| Five authoritative case states | Local browser proof | `output/playwright/staff-dashboard/.playwright-cli/page-2026-09-04T15-35-24-294Z.png` | Codex / 2026-09-04 |
| Actual partially-effective evaluation summary | Local browser proof: `Partially Effective`, `3/4` | `output/playwright/staff-dashboard/.playwright-cli/page-2026-09-04T15-35-02-984Z.png` | Codex / 2026-09-04 |
| Narrow staff evaluation journey | Local browser proof: 390 px, `scrollWidth=390` | `output/playwright/staff-dashboard/.playwright-cli/page-2026-09-04T15-34-42-179Z.png` | Codex / 2026-09-04 |
| API/database role matrix | Pending; release blocker | `[denial and allowed readbacks]` | `[reviewer/date]` |
| Hostile artifact rendering | Local proof only: independently receipt-bound bytes; five formats inert; unsafe Windows/backslash/control/dot/empty paths rejected; zero console warnings/errors; static requests remained on `127.0.0.1` | `packages/staff-dashboard/test/domain.test.ts`; Playwright request/console readback | Codex / 2026-09-04 |
| Hosted evaluation and reopen | Pending | `[attempt/evaluation readbacks]` | `[reviewer/date]` |

## Completion gate

The local increment passed its bounded adversarial review and focused browser verification. Issue 06 is not shippable until real staff journeys, API/database denied-role probes, durable operation readback, successive-session behavior, and hosted hostile-rendering checks pass. It does not complete the epic until Issue 07 proves the reference case and blind run.
