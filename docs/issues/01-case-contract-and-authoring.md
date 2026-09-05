# Issue 01: Case Contract and Authoring

## Outcome

A Volta author can turn either a blank case or a staff-approved sanitized reference bundle into the same validated, canonical case format. The result clearly separates the student-visible bundle from protected truth, reports publication blockers, and produces stable digests and a safe student-file manifest for later approval and assignment.

This issue is the independently shippable authoring foundation. It does not claim that a hosted approval or dashboard workflow exists.

## Scope ownership

- **Product requirements:** SR-01, SR-02, SR-03, SR-19
- **Acceptance examples:** AC-01, AC-10
- **Estimate:** 1.5-2 focused engineering days for the original issue; the foundation/importer is now implemented locally.
- **Dependencies:** None.
- **Blocks:** Issues 02, 03, and 04. Reference-case work in Issue 07 may begin after this contract is stable.

## Current evidence status

- **Implemented locally:** Strict case and evaluation contracts, deterministic digest previews, separate visible/protected packages, deterministic authored routes, draft/preview blockers, submission/evaluation foundations, a multi-file authoring importer, a validation CLI, an allowlisted student manifest, and a non-assessed sanitized-reference fixture. The supported core package does not expose publication or digest-construction authority.
- **Observed locally on 2026-09-04:** `npm run verify` passed 68 tests across four files. The public synthetic sanitized-reference fixture and a synthetic blank-origin variant both passed the same importer and strict case contract. The ignored private blank-origin reference case also validated twice with identical previews while remaining a draft. Focused tests proved protected canaries stay out of validation-preview JSON, visible case output, the student manifest, normal validation errors, and student files materialized from the allowlist. Independent visible and protected edits changed only their corresponding package digest while both changed the overall preview digest.
- **Not yet proved:** The complete fictional assessed case, trusted approval persistence, material-change invalidation in the private database, staff-dashboard upload/preview, hosted behavior, or AC-01/AC-10 end to end.
- **Completion state:** The local Issue 01 increment has passed adversarial review. Hosted integration, authenticated approval, and AC-01/AC-10 remain explicitly open in Issues 03, 06, and 07.

## In scope

- One canonical case format covering all SR-02 authoring dimensions.
- Identical validation and canonicalization for blank and sanitized-reference-assisted inputs.
- File-based authoring from explicitly declared UTF-8 YAML, Markdown, and CSV material only.
- Separate student-visible and protected packages with independent digests plus a version digest.
- An allowlisted student-bundle manifest that rejects traversal, aliases, duplicate targets, symlinks, protected roots, unsupported files, and undeclared assets.
- Validation of exactly three distinct calibration classes for assessed cases: effective, partially effective, and not yet effective.
- Authored route validation, including cue groups, exclusions, prerequisites, stable priority, ambiguous-match failure, fixed fact/evidence references, and an explicit unavailable fallback.
- Private authoring provenance that records `blank` or `sanitized-reference-assisted` without exposing raw source material to students.
- A deterministic validation/preview result that later staff UI and persistence work can consume without redefining the case.
- A non-assessed public fixture and focused failure fixtures. Active assessed case truth remains outside the public repository.

## Out of scope and handoff boundary

- **Trusted approval and publication persistence:** This issue may validate approval-shaped fields and prove that drafts cannot publish. Issue 03 authenticates the approver, atomically persists approval and both frozen package digests, rejects later mutation, and makes a version assignable.
- **Staff dashboard persistence:** This issue produces validation and preview data. Issue 06 presents those results in the staff dashboard; Issue 03 owns durable approval/publication state. Issue 01 does not create a temporary competing store.
- GitHub identity, database roles, CLI pairing, and assignment access: Issue 02.
- Private repository creation and collaborator invitation: Issue 03.
- Model rendering and hosted interaction events: Issue 04.
- Student CLI journey: Issue 05.
- Complete fictional assessed case, live sanitized fixture proof, and blind pilot: Issue 07.

## Exact behaviors

1. The importer reads only files explicitly named by the case assembly and refuses network access or a live AI Lab dependency.
2. Blank and sanitized-reference-assisted cases become the same canonical case shape and pass the same validations.
3. Every case declares competencies, experience level, difficulty, company constraints, methodology and requirement snapshots, personas, facts, evidence availability, collection consequences, economics, defensible outcome families, evaluation anchors, and calibrations.
4. Student-visible material is generated from an allowlist. Protected material is never copied and cannot become visible merely because a new protected field is added later.
5. Repeating an unchanged import produces identical packages, file manifests, and digests.
6. Reordering keys does not change a digest. Changing visible or protected meaning changes the appropriate package digest and the overall case-version digest.
7. An assessed case without three distinct, non-placeholder calibration artifacts cannot become approval-ready.
8. Missing or cross-referenced persona, fact, evidence, collection, calibration, methodology, or asset identifiers fail validation with an actionable path.
9. Equal highest-priority routes fail closed as ambiguous and release no fact, evidence, time, or resource consequence.
10. An out-of-universe route releases no facts and returns the authored unavailable result.
11. A valid but unapproved case remains a draft and lists explicit publication blockers.
12. The preview exposes the student bundle and its manifest separately from staff-only protected material. It never renders protected content into a student-facing result.
13. Sanitized-reference provenance stays staff-only, confirms raw material is absent, and does not require the source system at validation time.
14. A requirement with an authored activation gate may be marked not applicable with rationale when the student's defensible decision is to stop, pivot, choose no build, or collect more evidence. A fixed applicable requirement may not.
15. Validation digests are previews, not approval evidence. The supported `@volta-sim/core` package surface exposes no helper that creates or blesses a publication; Issue 03 owns that authenticated persisted boundary.

## Data and access obligations

- The public repository contains only reusable contracts and clearly non-assessed fixtures.
- Active case packages, assessed calibrations, evaluation anchors, and raw or sanitized private authoring inputs belong in the dedicated private service or approved staff workspace.
- The importer must never persist credentials, fetch URLs, contact AI Lab, or follow a file outside the selected case root.
- Authoring output must keep the student package and protected package separate before any hosted persistence begins.
- Approval fields in a local object are untrusted input. Only Issue 03's authenticated atomic operation may establish a published approval.
- A later database representation must preserve the exact canonical bytes and digests produced here rather than silently rebuilding a different representation.

## Falsifiable local proofs

- [x] Import a public synthetic blank-origin variant and the sanitized-reference fixture through the same entry point; both satisfy the same canonical contract.
- [x] Reimport the unchanged sanitized-reference fixture twice and compare package digests and the student manifest.
- [x] Remove required dimensions and prove validation fails.
- [x] Use incomplete, duplicate, placeholder, and unknown-fact calibrations and prove assessed approval-readiness fails.
- [x] Exercise complete cue groups, exclusions, prerequisites, multi-evidence release, and ambiguous highest-priority routes.
- [x] Attempt traversal, absolute or abnormal paths, protected-root copy, duplicate target, and symlink input; every attempt fails before protected content is read into the student bundle.
- [x] Add canaries to protected truth, calibrations, sanitized input, and evaluation anchors; prove none appears in validation-preview JSON, visible output, the student manifest, normal errors, or student output materialized from the allowlist.
- [x] Confirm a valid unapproved draft cannot publish and reports the missing exact-version approval.
- [x] Change one material visible field and one protected field; confirm each changes only its corresponding package preview digest and both change the overall case preview digest. Authenticated invalidation of persisted approval remains Issue 03.
- [x] Run `npm run verify` with nonzero test collection.
- [x] Complete final fresh-context adversarial QA and remove publication authority from the supported core package surface without expanding this issue into hosted persistence.

## Hosted proofs

Hosted proof is an integration handoff, not evidence that this local issue is already complete:

- [ ] Upload one blank case and one sanitized-reference bundle through the staff authoring entry point once Issue 06 exposes it.
- [ ] Confirm both produce the same persisted canonical format and validation results.
- [ ] Disable or make AI Lab unreachable; validate both paths without any outbound request.
- [ ] Read back private provenance, visible/protected digests, and validation status from the dedicated pilot service.
- [ ] Confirm anonymous, student, wrong-assignment, and blind-staff sessions cannot retrieve draft or protected authoring material.
- [ ] Publish only through Issue 03's authenticated approval boundary; do not treat a successful import as approval evidence.

## Rollback

- Revert the importer/contract release while keeping authored source files unchanged.
- Do not rewrite a persisted published case to match an older importer. Reimport as a new draft and compare digests.
- Disable authoring upload if validation or containment is uncertain. Existing validated output remains evidence but is not promoted automatically.
- Remove a faulty public non-assessed fixture only through a normal corrective change; first verify that no active assessed material was exposed.

## Evidence record

| Evidence | Status | Artifact or readback | Verified by/date |
|---|---|---|---|
| Focused unit and importer tests | Local pass; 68 tests across four files | `npm run verify` output | 2026-09-04 / adversarial agent review |
| Sanitized fixture validation preview | Local pass | Validation CLI JSON with three digests and publication blocker | 2026-09-04 / adversarial agent review |
| Private blank-origin reference validation | Local pass twice; identical draft previews, no publication | `.private/cases/reference-support-routing` validation output | 2026-09-04 / adversarial agent review |
| Blank-origin importer proof | Local pass | Synthetic `original_from_blank` variant in `packages/authoring/test/importer.test.ts` | 2026-09-04 / adversarial agent review |
| Protected-canary bundle scan | Local pass | Truth, calibration, sanitized-input, and anchor canary regression in `packages/authoring/test/importer.test.ts` | 2026-09-04 / adversarial agent review |
| Visible/protected digest isolation | Local pass | Independent visible and protected edit regression in `packages/authoring/test/importer.test.ts` | 2026-09-04 / adversarial agent review |
| Persisted approval invalidation | Pending Issue 03 hosted proof | `[database and digest readback]` | `[reviewer/date]` |
| Final adversarial QA | Local pass | Package-surface correction plus reconciled importer regressions | 2026-09-04 / adversarial agent review |

## Completion gate

The local Issue 01 increment is shippable: its local proofs pass, blank and sanitized paths are represented, adversarial blockers are reconciled, and the authenticated approval and dashboard handoffs are explicit. Closing this increment does not prove trusted publication, hosted AC-01 or AC-10, or completion of the epic.
