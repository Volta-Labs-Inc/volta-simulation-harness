# Issue 04: Truth and Provider Engine

## Outcome

Student conversations and evidence actions release only authored, state-eligible facts. The student's configured model may order exact authored segments but cannot add or paraphrase student-visible prose, choose evidence, create case truth, advance simulation state, or see more context than the current interaction requires. Provider and replay records remain auditable.

## Scope ownership

- **Product requirements:** SR-06, SR-07, SR-08, SR-09, SR-11, SR-17
- **Acceptance examples:** AC-03, AC-04, AC-05
- **Estimate:** 2.5-3.5 focused engineering days.
- **Depends on:** Issues 01 and 02.
- **Blocks:** Issues 05 and 06.

## Pinned provider choices and current blocker

The internal pilot uses one direct OpenAI Responses API boundary with two dated model snapshots:

- `gpt-5-mini-2025-08-07`
- `gpt-4.1-mini-2025-04-14`

The exact IDs are configuration, but they are pinned so the pilot case cannot change silently. Students cannot supply a model ID, base URL, provider key, or alternate endpoint outside this allowlist.

**Hosted blocker:** On 2026-09-04, a readback using the existing AI Lab OpenAI credential returned HTTP 401 before any model request or case-data transfer. Local work may proceed with capture and mock providers. Hosted proof is blocked until Volta supplies a valid project credential, both exact model IDs are retrieved successfully, and provider retention/data controls are recorded.

## Current evidence status

- **Implemented and verified locally:** The `@volta-sim/truth-engine` package rechecks assignment access at the elevated boundary and again immediately before a successful truth commit, resolves authored truth before rendering, sends a minimal deep-frozen prompt copy, supports the two pinned model IDs, and provides capture/mock renderers plus a fixed-endpoint OpenAI Responses adapter. The engine accepts only an exact arrangement of supplied fact claims and response-point text; a changed, added, or omitted segment fails closed. Bounded output and metadata, five authored consequence classes, atomic in-memory truth transitions, non-blocking review guidance, consequential-input idempotency, provider-failure audit records, and linked replay are covered by 40 focused tests. Official facts and provenance remain separate.
- **Not implemented:** Durable Issue 04 records in the hosted service, a hosted OpenAI call, hosted provider logs/cost capture, or the staff/student interfaces that invoke this package. The in-memory stores are local proof fixtures, not deployment persistence.
- **Hosted status:** Blocked by the HTTP 401 credential result above. No hosted provider or cross-model claim exists.

## In scope

- Deterministic authored routing for persona, evidence, and collection actions.
- Trusted assignment state as the only source for prerequisites, released facts/evidence, time, and resource consequences.
- Prompt-local model rendering after official facts are selected.
- Two pinned OpenAI models through one bounded Responses API adapter.
- Provider/model/calibration disclosure and event provenance.
- Complete, partial, biased, unavailable, and unusable authored collection outcomes.
- Non-blocking staff-review guidance for elevated-risk sandbox actions.
- Idempotent action processing, fail-closed provider behavior, and linked replay.
- Capture and mock providers for local proof.

## Out of scope

- Broad provider marketplace, OpenRouter routing, student-defined endpoints, arbitrary retrieval, student-held provider keys, voice, or dynamic model discovery.
- Automatic semantic inference beyond authored cues or semantic validation of arbitrary model prose. The pilot guarantees consistency for requests satisfying the same authored cue contract, not every possible request paraphrase. Provider output can arrange exact authored segments only.
- Automatic qualitative evaluation or penalties based on provider/model choice.
- Real external effects, production credentials, or production endpoints.
- Student command experience and local materialization: Issue 05.
- Staff replay interface and evaluation view: Issue 06.

## Exact behaviors

1. The service verifies the actor, assignment, attempt, case-version digest, operation ID, and trusted current state before resolving an action.
2. Authored cues, complete cue groups, exclusions, prerequisites, target, channel, and stable priority determine one route.
3. No match returns the authored unavailable result with zero facts, evidence, time, or resource change.
4. Equal highest-priority eligible routes fail as ambiguous with zero release or state change.
5. The selected route deterministically identifies eligible official fact IDs, released evidence IDs, time effect, resource effect, risk guidance, and checkpoint trigger.
6. Requests satisfying the same authored cue contract from the same state release the same fact IDs and provenance regardless of renderer model.
7. The model receives only the current persona material, selected official facts, permitted response points, and the minimum current interaction needed to arrange the authored response segments.
8. The model never receives the full protected package, calibrations, evaluation anchors, another assignment, unrelated unreleased evidence, provider secrets, or workspace files.
9. Model output is bounded and schema-validated. Every returned source ID and segment must exactly match the immutable prepared prompt; additions, omissions, edits, or paraphrases fail closed before any state transition.
10. The student sees authoritative facts and provenance separately from generated wording.
11. A flawed collection method releases its authored consequence without advance coaching that it is flawed.
12. Elevated-risk choices suggest asynchronous staff review, record whether it was requested, and permit continued sandbox work. They expose no real credential or production endpoint.
13. Provider timeout, refusal, invalid or oversized output, malformed metadata, incomplete status, or 401 releases zero facts and commits no time/resource transition. The failed operation remains auditable.
14. Repeating an operation ID with identical consequential input returns the existing outcome without duplicating facts, evidence, time, cost, or review events. Reusing it for a changed request, model, review choice, replay source, or action type is rejected.
15. Replay creates a new linked provider response against the original selected truth while retaining the original. Replay never changes evaluation automatically.
16. The official record includes authored route, facts, evidence, consequences, prompt-package digest, provider, exact model, calibration status, rendered response, failure class, and replay link.

## Data and access obligations

- Persist official action requests, deterministic operation fingerprints, idempotency keys, route decisions or no-release reasons, fact and evidence releases, time/resource transitions, review choices, provider attempts, bounded response metadata, replay links, attempt numbers, and case-version digests as append-only records.
- Keep provider credentials only in the hosted secret store. They never reach browsers, CLI output, logs, repositories, submissions, or prompts.
- Build prompt payloads server-side from allowlisted fields after authorization and route selection.
- Blind students may invoke student actions for their own assignment but cannot use replay or staff provider tools before Attempt 1 submission.
- Provider responses are hostile input. Cap raw bodies before parsing, require a completed provider status, and store/render only exact authored segments with safe bounded metadata.
- After asynchronous provider work, the durable truth store must recheck authorization under the same lock or transaction that appends the official event.
- Outbound destinations are restricted to the configured OpenAI API and the hosted service's required platform endpoints. Redirects cannot escape the allowlist.
- Logs retain provider, exact model, status, latency, usage/cost metadata, and identifiers without full protected prompts or response content by default.

## Falsifiable local proofs

- [x] Authored cue-equivalent requests return the same route and official facts.
- [x] No-match, failed prerequisites, and equal highest-priority routes release nothing.
- [x] Exercise complete, partial, biased, unavailable, and unusable collection outcomes and verify exact authored time/resource consequences.
- [x] Capture prompts with canaries in full truth, calibrations, another persona/assignment boundary, and unrelated evidence; only current prompt-local material appears.
- [x] Run both pinned model configurations through local capture renderers and compare official fact IDs, evidence IDs, route, prompt digest, and provenance.
- [x] Return invented fact IDs, invented authoritative wording, an unsupported plain-language claim with valid IDs, null/malformed attempts and metadata, refusal, timeout, 401, incomplete status, and oversized content from mock providers; every provider failure releases nothing, preserves its auditable operation result, and leaves truth state unchanged.
- [x] Make key resolution and transport ignore cancellation, resolve or reject after the deadline, and verify the timeout record remains final with no late truth change or unhandled rejection.
- [x] Retry conversation, collection, and replay with the same operation ID, including concurrent retries; one renderer call and one official transition survive. Reusing the ID with changed consequential input conflicts.
- [x] Exercise elevated-risk behavior; review is suggested and recorded while the next sandbox action remains allowed.
- [x] Attempt arbitrary base URLs, model IDs, headers, and redirect behavior; configuration is rejected before rendering or the fixed-endpoint transport returns a zero-release failure. Arbitrary retrieval is absent from the package interface.
- [x] Replay a response and prove both operation records remain, selected truth is unchanged, and the human-evaluation marker is untouched. Replay requires `staff-evaluate`; read-only protected-case access is insufficient.

## Hosted proofs

- [ ] Resolve the current HTTP 401 with a valid Volta-held OpenAI project credential.
- [ ] Retrieve and record availability for `gpt-5-mini-2025-08-07` and `gpt-4.1-mini-2025-04-14` before enabling provider actions.
- [ ] Record the provider retention/data-control review and confirm no case data was sent during the failed 401 probe.
- [ ] Run the same authored cue contract from identical state through both pinned models; compare route, fact IDs, evidence IDs, provenance, and exact authored-segment membership while allowing segment-order differences.
- [ ] Inspect captured prompt payloads for prompt-local context and zero protected canaries.
- [ ] Inject timeout, invalid response, refusal, and duplicate retry; read back zero unintended state change.
- [ ] Complete the flawed simple-ticket collection action and verify time, dataset digest, student-visible sampling frame, and absence of pre-action coaching.
- [ ] Exercise the elevated-risk classifier-routing choice and verify guidance, continued sandbox work, and no external production action.

## Rollback

- Disable provider-backed actions independently while leaving deterministic local status, existing evidence, and staff review available.
- Revert the hosted release to the last verified provider boundary.
- Revoke or rotate the provider credential if its scope or logging is uncertain.
- Preserve original official and replay records. A correction creates a new linked response and never rewrites released facts.
- Reconcile timed-out operations by operation ID and readback before retry.

## Evidence record

| Evidence | Status | Artifact or readback | Verified by/date |
|---|---|---|---|
| Deterministic authored routing and five consequence classes | Local automated proof passed | `packages/truth-engine/test/truth-engine.test.ts`; focused Issue 04 suite 40/40 tests | Codex, 2026-09-04 |
| Capture-provider prompt minimization | Local canary proof passed | Focused Issue 04 suite, 40/40 tests | Codex, 2026-09-04 |
| Provider failure, exact-segment output, deadline, authorization, and input-bound idempotency | Local adversarial proof passed | Focused Issue 04 suite, 40/40 tests | Codex, 2026-09-04 |
| Replay immutability and permission boundary | Local automated proof passed | Original and replay records retained; truth and evaluation marker unchanged; read-only grant denied | Codex, 2026-09-04 |
| Pinned model availability | Blocked by hosted HTTP 401 | `[model retrieval readback]` | `[reviewer/date]` |
| Cross-model authoritative-fact consistency | Local capture providers agree; hosted proof blocked | Both pinned configurations produced the same route, facts, evidence, prompt digest, and provenance in synthetic fixtures | Codex, 2026-09-04 |
| Retention/data-control review | Pending; hosted enablement blocker | `[review receipt]` | `[owner/date]` |

## Completion gate

The local-only Issue 04 increment is shippable when the current full-workspace verification remains green: focused prompt capture, hostile-output, deadline, state-transition, replay, permission, and idempotency proofs pass against synthetic capture/mock providers. Arbitrary generated paraphrasing is intentionally not enabled because this package does not claim a complete semantic entailment verifier; only exact authored segments can be displayed. The hosted Issue 04 boundary remains blocked until durable persistence with a locked authorization recheck is connected, a valid credential is supplied, exact model availability and provider controls are recorded, and both real-model readbacks pass. This local result is not AC-03 or hosted provider proof.
