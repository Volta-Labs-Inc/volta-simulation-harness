# Delivery Contract: Simulation Harness Internal Pilot

## Scope authority

- **Scope basis:** Approved Volta product contract artifact. No Linear record has been created or authorized for this work.
- **Scope artifact:** `d894a094-02c3-489e-a2df-81daa16d7aea`
- **Approved digest:** `7a7162ea36a4acef5be8b28f4339a4b2282e9e4a23278ffaa971b6416ebe1f94`
- **Approval evidence:** Matt approved the low-fidelity experience and bound decisions on 2026-09-04.
- **Delivery tier:** Full epic with seven independently shippable child issues.
- **Named milestone:** End-to-end simulation harness internal pilot.
- **Completes the original outcome:** No. It proves the reusable core before production hardening, real-student rollout, and a multi-case library.

## Outcome

Matt can author and approve one fictional customer-support-routing case, Rishabh can complete Attempt 1 blind from a private assignment repository and a tool-neutral CLI, and Matt can evaluate and reopen that attempt from a staff dashboard. The proof must show that official facts remain stable across configured models, protected material never reaches the student, multiple conclusions can be defensible, and every submission and evaluation remains reproducible.

## Scope concordance

- **Original requested outcome:** A reusable harness for realistic student problems that tests problem viability, evidence judgment, proportionate response, and objective success and failure criteria.
- **Approved experience:** Student CLI, staff dashboard, visible completeness but hidden quality, text-only personas, non-blocking review suggestions, immutable submission, and reopening.
- **Primary journey preserved:** Students continue working in a private Git repository with their own coding agent and implementation stack. Staff retains human judgment using the AI Lab and Volta Intelligence methodology.
- **Decisions preserved:** Original and sanitized-reference authoring are equal entry paths; official facts come only from the frozen case; sandbox work remains available after risk guidance; the harness never grades private AI use; Attempt 1 is blind for Rishabh.
- **Deviations from approved scope or experience:** None.

## Reduced pilot boundary

The smallest complete pilot is deliberately narrow:

- One public Apache-2.0 repository contains the reusable software, case contract, validators, migrations, tests, documentation, and synthetic non-assessed material.
- One dedicated private Supabase project holds active case packages, protected truth, assignments, official events, submissions, evaluations, and credentials.
- One Netlify pilot environment hosts the staff dashboard and authenticated service routes. The same application runs locally against a local Supabase stack.
- Case authors upload schema-validated JSON or YAML. The dashboard validates, previews, approves, publishes, and shows version history; it is not a rich visual editor.
- Pilot evidence is bounded to UTF-8 text, Markdown, JSON, and CSV. Binary evidence is deferred.
- The initial stakeholder-model catalog is OpenAI `gpt-5-mini-2025-08-07` and `gpt-4.1-mini-2025-04-14` through one Responses API adapter. Students cannot provide provider endpoints or keys. The models are pinned to dated snapshots so a case does not change silently.
- Repository provisioning is synchronous, idempotent, and staff-retriable. There are no queues, webhooks, or background workers.
- Staff activity uses polling and manual refresh. There are no notifications or realtime subscriptions.
- A submitted build is preserved from an explicitly selected, bounded set of supported text files at a verified Git commit. The harness never uploads or executes the rest of the workspace.

This reduction preserves every approved product requirement. It removes only operational hardening and richer authoring or media capabilities that are unnecessary for the two-person internal pilot.

## Current-system findings

- The repository now contains the public operating documents plus an initial TypeScript foundation for case contracts, canonical digests, authored routing, access decisions, submissions, evaluations, and focused tests. Round-one adversarial review found that the first foundation did not yet satisfy the complete case, blindness, or immutable-submission contract; Issue 1 owns those corrections instead of rebuilding the foundation.
- The public repository boundary is already explicit in [AGENTS.md](../AGENTS.md): active case truth, credentials, and private student activity belong only in the private service.
- [context-map.md](../context-map.md) names the private service and private assignment repositories as separate systems of record. AI Lab and Volta Intelligence are authoring references, not runtime dependencies.
- Existing Volta applications establish Next.js, Supabase-backed identity and data, Netlify hosting, TypeScript validation, browser testing, and local database testing as supportable patterns. They are evidence of feasibility, not proof that this harness exists.
- Current Volta database history includes prior repairs for anonymous grants, view execution context, and elevated database functions. This pilot therefore starts deny-by-default and proves both allowed and denied access before hosted use.
- Live read-only GitHub inspection found `MattVOLTA` as the only current `Volta-Labs-Inc` organization member and no current outside collaborator for Rishabh. Invitation acceptance is an assignment-readiness dependency.
- The approved source artifact contains stale pre-approval prose in two sealed files, while its manifest records Matt's approval and binds the digest above. The sealed files must remain unchanged; the manifest is the approval receipt.

## Architecture and operating behavior

### Public software and private operations

The public repository may contain all reusable service and dashboard code. A separate private source repository would not protect runtime data and would add synchronization work. Privacy comes from the dedicated hosted service, server-held credentials, explicit data access, and generated private assignment repositories.

At publication, the service freezes two canonical packages:

1. The **student bundle** contains the brief, rubric, pinned requirements, visible personas, and initially released evidence.
2. The **protected package** contains hidden truth, unreleased evidence, persona knowledge and incentives, collection consequences, defensible outcome families, calibration submissions, and evaluation anchors.

Each package receives a content digest. An assignment points to the exact published version. Any material edit creates a new draft version and requires new calibration and approval.

### Identity and authorization

GitHub sign-in and repository provisioning use separate registrations:

- A GitHub OAuth application, connected through Supabase, signs people in. Authorization binds to GitHub's immutable numeric provider identity, not editable profile metadata.
- A GitHub App creates repositories from the public template and invites the assigned student. Its installation is limited to selected repositories and the repositories it creates; it does not need access to other Volta repositories.

A blind-case denial overrides ordinary staff authority. Until Rishabh submits Attempt 1, every protected case operation treats him only as the assigned student. Browser routes, service routes, database access, and elevated server operations must all reach the same decision.

CLI login opens a browser and uses a short-lived, one-time pairing code. The CLI receives an opaque, assignment-scoped, revocable token; only its hash is stored server-side. Every request rechecks identity, assignment, attempt state, and revocation.

### Assignment repositories

Publication and assignment create a private repository from the public template at a recorded commit, add only the approved student bundle and workspace material, then invite the resolved GitHub login with push access. The assignment moves through `provisioning`, `repository_created`, `invitation_pending`, and `ready`. Retrying resumes the last confirmed state and never creates a duplicate repository.

The assignment is not ready until repository visibility, template commit, collaborator state, and student-bundle digest are read back. A canary scan must inspect the working tree, all refs, and every reachable Git object for protected material.

### Persona, evidence, and provider truth

Each authored persona or evidence route declares matching cues, prerequisites, eligible authoritative fact IDs, consequence IDs, time effects, and a no-match result. The service selects the route, then deterministically derives the facts allowed by the assignment's current state. Requests that match the same authored cue contract and state must resolve to the same official facts; the harness does not claim open-ended semantic equivalence for unauthored paraphrases. A configured model receives only the current persona material and selected facts needed to render that response. It cannot select facts, create evidence, or advance state.

The student sees authoritative fact IDs and provenance separately from generated wording. Out-of-universe requests return an explicit unavailable result. A flawed collection plan can release its authored biased or partial result without warning the student that it is flawed.

Provider timeout, refusal, or invalid output releases no facts and advances neither time nor state. Each action carries a client operation ID so retries are safe. Replay creates a linked response while preserving the original and never automatically penalizes the student.

### Submission and evaluation

A submission freezes the case digest, event cutoff, released-evidence snapshot, evidence ledger, decisions, missing-data plan, response and buy-versus-build reasoning, server-recomputed calculations, success and failure criteria, estimates, risk choices, provider provenance, CLI version, and explicitly selected supported artifacts. Uploaded or fetched content is treated as hostile and is never executed.

Matt records one human judgment for each of the four competencies. Overall effective is available only when all four are effective. Reopening creates Attempt 2 with its own submission and evaluation; Attempt 1 remains unchanged.

## Seven independently shippable issues

Each issue is a separately reviewable pull request with its own local proof. Closing a child issue does not complete the pilot; the epic closes only after the hosted blind run and all acceptance evidence exist.

| Issue | Independently shippable result | Scope covered | Depends on | Estimate |
|---|---|---|---|---|
| 1. Case contract and authoring | Authors can import blank or sanitized-reference material, see validation failures, preview a case, and produce a version-ready canonical package. | SR-01, SR-02, SR-03, SR-19; AC-01, AC-10 | None | 1.5-2 days |
| 2. Identity and private access | GitHub identities, staff/student membership, blind overrides, and CLI pairing deny every unassigned or blind-protected read. | SR-05, SR-12, SR-15, SR-18; AC-02, AC-09 | Issue 1 | 2.5-3 days |
| 3. Publication and assignment | Approval atomically freezes both package digests; assignment provisions one private repository and reconciles invitations safely. | SR-03, SR-04, SR-18; AC-01, AC-02 | Issues 1-2 | 2-3 days |
| 4. Truth and provider engine | Authored routes release deterministic facts, model rendering remains prompt-local, collection consequences advance safely, and replay preserves both records. | SR-06, SR-07, SR-08, SR-09, SR-11, SR-17; AC-03, AC-04, AC-05 | Issues 1-2 | 2.5-3.5 days |
| 5. Student CLI | A student can resume, investigate, collect, record decisions and estimates, request review, work locally, and submit without workspace surveillance. | SR-05, SR-09, SR-10, SR-11, SR-13, SR-14; AC-05, AC-09 | Issues 3-4 | 2-2.5 days |
| 6. Staff evaluation and reopening | Staff can poll official activity, respond without blocking, evaluate four competencies, replay, and reopen without overwriting history. | SR-12, SR-14, SR-15, SR-16, SR-17; AC-06, AC-07, AC-08, AC-09 | Issues 3-5 | 2-3 days |
| 7. Reference pilot and hosted proof | The fictional case, three calibrations, sanitized fixture, real private repository, two-model proof, blind Attempt 1, evaluation, reopen, and evidence packet satisfy AC-01 through AC-10. | SR-01 through SR-19; AC-01 through AC-10 | Issues 1-6 | 2.5-4 engineering days plus human run time |

Sequential engineering work totals roughly 15-21 days. A 12-15-day software-ready target is plausible only when issues 3 and 4 overlap, issues 5 and 6 overlap where safe, reference content begins after issue 1, credentials and platform approvals exist on day one, and integration rework stays small. Calibration, the blind run, evaluation, and pilot-discovered fixes add elapsed time and remain part of the milestone definition of done.

Issue 4 is currently blocked at its hosted boundary. [Official OpenAI endpoint policy documentation](https://platform.openai.com/docs/models/default-usage-policies-by-endpoint) lists both chosen snapshots for the Responses API, but a 2026-09-04 readback using the existing AI Lab credential returned HTTP 401 before any model request or case-data transfer. Implementation may proceed against the capture/mock adapter; enabling a real provider requires a valid Volta-held project credential, successful model retrieval for both exact IDs, and recorded [retention/data-control](https://openai.com/enterprise-privacy/) review.

## Product requirement-to-proof mapping

| Scope ID | Required behavior | Owning issue | Automated/local proof | Hosted/runtime proof and readback |
|---|---|---|---|---|
| SR-01 | Blank and sanitized-reference authoring reach the same format without AI Lab. | 1, 7 | Import both fixtures with AI Lab unavailable; compare canonical validation. | Publish both paths; capture provenance and prove no outbound AI Lab request. |
| SR-02 | Every required case dimension exists before approval. | 1 | Omit each dimension in turn and require a named validation failure. | Dashboard blocks approval and shows the exact missing dimension. |
| SR-03 | Only validated, calibrated, approved exact versions are assignable. | 1, 3 | Fail publication without three calibration levels; prove material edits clear approval. | Read back both package digests and assignment's version binding. |
| SR-04 | Each student receives isolated state and a private repository with identical version facts. | 3 | Mock two assignments and compare starting digests while denying cross-assignment reads. | Create private test repositories; read back visibility, collaborator, and bundle digest. |
| SR-05 | A GitHub-authenticated student resumes through the CLI with any local work tool. | 2, 5 | Pair, expire, revoke, and resume tokens through CLI subprocess tests. | Sign in from a clean machine/session and resume the same assignment. |
| SR-06 | Persona responses use authored knowledge, uncertainty, incentives, refusal, and contradiction only. | 4 | Authored cue-equivalent route fixtures prove stable fact sets and explicit no-match behavior. | Capture authoritative IDs and provenance for representative conversations. |
| SR-07 | Configured model choice changes wording, not official facts; prompt scope is minimal. | 4, 7 | Run two mock renderers against one route and compare fact IDs; inspect captured prompts. | Run two configured models and verify identical authoritative facts and prompt-local payloads. |
| SR-08 | Existing, partial, biased, unavailable, and unusable collection outcomes advance as authored. | 4 | Exercise every consequence and prove unknown requests add no fact. | Perform representative collection actions; read back time, choice, and released evidence. |
| SR-09 | Sandbox choices continue after risk guidance and never cause a real external effect. | 4, 5 | Elevated-risk fixture suggests review but allows the next sandbox action; outbound destination allowlist rejects others. | Observe review suggestion and continued work; verify no production credential or endpoint is available. |
| SR-10 | Rubric, requirements, rationale, and completeness are visible while quality stays hidden. | 5 | Status output proves completeness changes without qualitative language; not-applicable requires rationale. | Run student journey and inspect CLI output before submission. |
| SR-11 | Checkpoints ask open-ended decision, evidence, estimate, pivot, stop, and confidence questions. | 4, 5 | Event fixtures prove prompts appear after meaningful events and do not supply an estimate. | Capture the CLI checkpoint after conversation, evidence, and decision events. |
| SR-12 | Non-assigned staff sees official activity and handles review; private agent activity remains absent; blind staff is denied. | 2, 6 | Role matrix and event-shape tests deny private telemetry and blind-case access. | Probe as Matt, unassigned staff, Rishabh before submission, and Rishabh after submission. |
| SR-13 | Submission preserves every required decision and evidence component. | 5 | Omit each required field; verify accepted packet is immutable and digest-stable. | Submit a full packet and read back its event cutoff, evidence snapshot, calculations, and artifacts. |
| SR-14 | Completeness, provenance, calculations, and evidence distinctions are verified without automatic judgment. | 5, 6 | Recompute formulas; reject missing provenance; prove no effectiveness field is generated. | Compare dashboard packet with stored canonical packet and human judgment fields. |
| SR-15 | Human evaluation covers four mandatory competencies; blind assignee cannot participate before first submission. | 2, 6 | Deny missing competencies and overall-effective when any is lower; enforce blind override. | Matt evaluates Attempt 1; authorization probes deny Rishabh protected actions beforehand. |
| SR-16 | Reopening preserves the original and creates a separately evaluated attempt. | 6 | Reopen fixture proves Attempt 1 records cannot change and Attempt 2 has its own state. | Reopen the pilot submission and read back both attempts and evaluations. |
| SR-17 | Replay retains original and replacement without automatic penalty. | 4, 6 | Replay creates a linked event and leaves evaluation unchanged. | Staff replays one interaction and reads back both records and provider provenance. |
| SR-18 | Public and student repositories exclude protected material; uninvited people receive no access. | 2, 3, 7 | Seed canaries and scan all files, refs, history objects, build output, and API responses. | Inspect generated repository visibility/history and probe anonymous, wrong-student, and uninvited access. |
| SR-19 | Both authoring paths are proven in the pilot without raw source or live AI Lab. | 1, 7 | Validate fictional case and bounded sanitized fixture through the same checks. | Publish both; inspect stored provenance and scan for raw-source canaries. |

## Acceptance-to-proof mapping

| Scope ID | Falsifiable local proof | Hosted/runtime proof | Required evidence |
|---|---|---|---|
| AC-01 | Approval fails until required truth, personas, consequences, methodology, outcomes, and calibrations exist; approved digest cannot mutate. | Matt approves the fictional case with AI Lab unavailable and assignment binds to that digest. | Validation report, approval event, package digests, assignment readback. |
| AC-02 | Generated repository fixture is scanned across the working tree, all refs, and reachable objects for protected canaries. | Create a real private assignment repository and repeat the exhaustive scan after invitation. | Repository visibility, collaborator state, template and bundle digests, zero-canary report. |
| AC-03 | Requests satisfying the same authored cue contract produce the same route, fact IDs, and provenance through two renderers. | Run two configured models and compare authoritative evidence while allowing wording differences. | Route, authored cues, fact IDs, provider/model, prompt capture, rendered responses. |
| AC-04 | The simple-ticket collection choice advances time and releases only the authored biased dataset without coaching text. | Complete the action through the CLI and inspect the student output and official event. | Choice, consequence, simulated time, dataset digest, absence of advance warning. |
| AC-05 | Elevated-risk action returns review guidance, records the choice, permits later sandbox work, and rejects any non-allowlisted external destination. | Exercise the classifier-routing scenario and verify no real credential, endpoint, or external mutation exists. | Risk event, review choice, following sandbox event, outbound-attempt log. |
| AC-06 | Separate effective-path test fixtures with different defensible outcomes can each receive all-effective human judgments. | Matt evaluates representative no-build and proportionate-change paths without canonical-answer comparison. | Test packets and four competency judgments for each; these do not expand the exactly-three reference-case calibration set. |
| AC-07 | An otherwise strong fixture with no baseline or credible plan cannot be marked overall effective. | Matt evaluates the weak-baseline pilot fixture and the dashboard prevents overall effective. | Four judgments, failed competency, unavailable overall-effective action. |
| AC-08 | Reopening creates a new attempt and database rules reject edits or deletes to the first submission/evaluation. | Reopen Rishabh's Attempt 1, submit Attempt 2, and read back both evidence states and judgments. | Attempt lineage, immutable record checks, both packet digests. |
| AC-09 | CLI privacy canaries prove no scan of agent files, shell history, environment, processes, or unrelated workspace paths. | Matt's timeline and final packet contain only official events and explicitly selected artifacts. | CLI access log, network capture, dashboard packet, absence-of-canary report. |
| AC-10 | Sanitized fixture imports with the source unavailable and uses the same validator as a blank case; raw-source canaries are rejected. | Publish the fixture without AI Lab access and inspect private provenance plus public/student outputs. | Import result, validation digest, provenance readback, zero raw-source canaries. |

## Surface test plan

| Surface | Applies? | Local proof | Hosted and edge proof |
|---|---|---|---|
| Student experience | Yes | CLI subprocess journeys at clean login, resumed login, expired token, unavailable evidence, review request, submission, and reopened attempt. | Rishabh completes the approved student flow from a private repository without dashboard access. |
| Staff experience | Yes | Browser journeys at desktop and narrow viewport for validation, approval, assignment, timeline, evaluation, replay, and reopen. | Matt completes the approved staff flow; polling recovers after session refresh and successive state changes. |
| Business rules | Yes | Case validation, state transitions, routing, consequences, calculations, completeness, calibration, idempotency, and evaluation rules fail before implementation and pass afterward. | Authenticated service calls show the same results under real identity and provider boundaries. |
| Data and access | Yes | Local database tests cover explicit grants, row-level assignment isolation, blind override, immutable records, version reset, and service-route authorization. | Direct probes as anonymous, assigned student, wrong student, ordinary staff, blind staff, and revoked CLI token. |
| External integrations | Yes | Mock GitHub and provider adapters cover success, timeout, refusal, invalid output, duplicate calls, and partial failure. | Real GitHub App repository/invitation smoke and two configured model runs with independent readback. |
| Operations | Yes | Node 22 build, type checks, nonzero test collection, local Supabase reset, and local Netlify journey. | Deployment health, database migration/grant readback, provider/GitHub audit records, disable controls, and rollback rehearsal. |

## Data and access obligations

- Start with a dedicated Supabase project. Do not reuse the Volta Anchor repository's previously linked OutWork project or another application's database.
- Make grants explicit for every exposed object, then prove row-level access separately. A successful intended-role query is not evidence that anonymous or wrong-assignment access is denied.
- Views must preserve the caller's access boundary. Elevated operations must be private, narrowly callable, and repeat the same identity, assignment, and blind-role checks as ordinary requests.
- Do not authorize from editable GitHub names or profile metadata. Persist the immutable provider identity and resolve the current login only for the collaborator invitation.
- The pilot database has no known external consumers because it is new and dedicated. Before the first migration is applied, confirm no other deployment, job, script, or application uses its URL; record that readback in the issue evidence.
- Never expose service-role, GitHub App, or provider credentials to the browser, CLI, public repository, generated repository, logs, or provider prompts.
- Follow [security-model.md](security-model.md) for the complete trust boundary and negative-test matrix.

## Test-first delivery sequence

For each issue:

1. Add the named behavior and denial tests and record that they fail for the missing capability.
2. Deliver only the behavior required by that issue.
3. Run the issue's focused tests, full workspace checks, and nonzero test-count check.
4. Exercise the real local journey and capture readback.
5. Refactor only while the proof remains green.

Hosted evidence is required only when the owning issue reaches its integration boundary. Mock success does not substitute for GitHub, provider, database, or browser readback.

## Rollout, observability, and rollback

### Rollout

1. Create the dedicated private Supabase project and apply additive schema, grants, and access rules. Read them back before deployment.
2. Register the GitHub OAuth application and selected-repository GitHub App, configure server-held credentials, and verify callback and installation ownership.
3. Deploy one internal-pilot Netlify environment with assignment creation and provider actions disabled.
4. Run local and hosted access probes, migration readback, provider prompt capture, and GitHub test-repository provisioning.
5. Publish the fictional case and sanitized fixture only after their exact digests and calibration gates pass.
6. Enable one test assignment, verify repository and invitation state, then enable Rishabh's blind Attempt 1.
7. Keep student rollout disabled until the complete AC-01 through AC-10 evidence packet is reviewed.

### Observability

Record authenticated actor, assignment, case version, attempt, operation ID, action type, outcome, provider/model where applicable, and failure class. Logs must use identifiers and status metadata rather than hidden truth, full prompts, tokens, submitted content, or private workspace data. Staff sees provisioning, provider, and state-transition failures with a safe retry action.

### Rollback

- Disable new assignment creation and provider-backed actions first. Existing immutable records remain readable.
- Revert the Netlify deployment to the last verified version.
- Use additive forward migrations for schema corrections. Do not delete or rewrite published cases, official events, submissions, or evaluations.
- Reconcile partially created GitHub repositories from their recorded state. Do not create replacements automatically or delete a repository as rollback.
- Revoke affected CLI tokens, GitHub App credentials, or provider credentials when their boundary is in doubt.
- A rollback restores safe availability; it does not erase evidence. Any corrected interaction or submission is a linked new record.

## Explicit deferrals

- Voice interaction and mobile applications.
- Real-client cases, raw client data, live AI Lab reads or writes, and automatic sanitization.
- Public student deployment and execution of student code.
- Binary evidence, arbitrary evidence connectors, and generic URL retrieval.
- Automatic qualitative grading, anti-cheating, anomaly detection, and private-agent surveillance.
- Rich collaborative case editing, bulk authoring, a case marketplace, and a large case library.
- Queues, background workers, webhooks, realtime subscriptions, notifications, and email delivery.
- Broad or student-defined provider catalogs, dynamic provider endpoints, and provider routing marketplaces.
- Production retention, post-program repository access, automated repository archival or deletion, and legal hold behavior.
- Multiple hosted environments, automated promotion, high availability, load testing, disaster recovery, on-call operations, penetration testing, SBOM publication, and cryptographic WORM signing.
- Separate microservices or a separate private source repository.

Retention and post-program repository access are deferred only for this Matt/Rishabh pilot. They are a blocking product decision before any real student assignment.

## Decisions and review reconciliation

- **Accepted:** Blindness is a case-level denial that overrides staff access at both API and database boundaries.
- **Accepted:** Publication atomically freezes both visible and protected package digests; hashes without database immutability are insufficient.
- **Accepted:** Submission reproducibility includes an event cutoff, released-evidence snapshot, server-recomputed calculations, and bounded artifact contents.
- **Accepted:** GitHub login and GitHub repository provisioning use separate applications and credential sets.
- **Accepted:** Provisioning uses explicit partial-failure states and idempotent retries.
- **Accepted:** The authored route, not the model, decides which authoritative facts are released.
- **Accepted:** Exhaustive repository scans include all refs and reachable history objects.
- **Accepted:** The initial provider catalog uses the two dated OpenAI snapshots named above; real-provider enablement is blocked until credential and model readback succeed.
- **Reduced:** No rich editor, binary storage, queue, webhook, realtime feed, notification system, or automatic repository synchronization is needed for the pilot.
- **Estimate correction:** 10-15 days is an upper-bound software-ready target under explicit overlap assumptions, not a dependable estimate for the fully proven milestone.

## Completion contract

- [ ] Every SR-01 through SR-19 and AC-01 through AC-10 row has automated, runtime, and readback evidence.
- [ ] The delivery has no deviation from the approved scope digest or experience.
- [ ] Rishabh completes Attempt 1 without protected staff access; Matt authors, approves, observes, evaluates, and reopens it.
- [ ] Official facts and provenance remain identical across the two configured model choices.
- [ ] The student repository and all reachable history contain no protected material.
- [ ] The dashboard and final packet contain no private work-agent activity.
- [ ] All published cases, official events, submissions, and evaluations remain immutable.
- [ ] The fictional case supports more than one defensible outcome and passes all three calibration levels.
- [ ] The sanitized-reference fixture proves the second authoring path without live AI Lab access or raw source material.
- [ ] Repository-native checks collect and pass nonzero tests.
- [ ] Local success is not reported as hosted proof, and hosted pilot proof is not reported as production readiness.
- [ ] No child issue is reported as completing the original outcome.
