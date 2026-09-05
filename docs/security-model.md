# Security Model: Simulation Harness Internal Pilot

## Status and scope

This document defines the minimum security properties for the Matt/Rishabh internal pilot. It covers the public harness repository, private hosted service, staff dashboard, student CLI, configured model providers, and private GitHub assignment repositories.

No control described here is implemented merely because it is documented. Each property requires the automated and hosted evidence named below before the pilot can be considered proven.

Production student rollout, real-client data, long-term retention, high availability, and public student deployments are outside this model. They require a later risk decision and must not inherit a pilot approval automatically.

## Protected assets

| Data class | Examples | Permitted locations | Must never appear in |
|---|---|---|---|
| Public reusable material | Software, schemas, validators, docs, synthetic non-assessed demo | Public repository, local development, hosted service | N/A |
| Assigned student material | Brief, rubric, applicable requirements, visible personas, released evidence, student's own official events and submitted artifacts | Assigned student's private repository and assignment-scoped service data | Public repository, another assignment, an uninvited account |
| Protected case truth | Unreleased facts, persona knowledge and incentives, refusal and contradiction rules, evidence consequences, outcome families | Private hosted service and approved staff authoring session | Public or student repositories, browser bundles, CLI cache, general logs, unrelated provider prompts |
| Assessment material | Calibration submissions, evaluation anchors, human judgments before release | Private hosted service; approved staff only | Public or student repositories, blind assignee, configured provider prompts |
| Operational secrets | Supabase elevated credential, GitHub App private key, OAuth secret, provider keys, CLI token hashes | Server-held secret store and private service records where applicable | Browser, CLI responses, repositories, logs, model prompts, submissions |
| Private work-agent activity | Claude Code, Codex, Cursor, or other agent conversations; shell history; environment; process list | Student's own machine and chosen tool | Harness telemetry, dashboard, evaluation packet, provider prompts |

The student bundle and released evidence are assessed material, but they are intentionally visible to the assigned student and may enter that student's private repository. “Keep assessed data out of Git” is therefore not a valid control. The enforceable rule is that protected truth, unreleased evidence, calibrations, evaluation anchors, credentials, and other assignments never enter any student repository.

## Actors and trust boundaries

- **Anonymous or uninvited person:** May read only the public repository and public non-assessed material. Receives no active case, assignment, event, or evaluation listing.
- **Assigned student:** May read the visible bundle, released evidence, their own official activity, completeness state, and released feedback. May append allowed actions and submissions for the active attempt.
- **Wrong or former student:** Has no access to another assignment. Loss of assignment access or token revocation takes effect on the next request.
- **Ordinary Volta staff:** May author, approve, assign, observe official activity, answer review requests, evaluate, replay, and reopen according to case state.
- **Blind staff assignee:** Is treated only as the assigned student for that case until Attempt 1 is submitted. Ordinary staff membership grants no protected case access during that period.
- **Hosted service:** May perform narrow privileged operations only after repeating the actor, assignment, attempt, and blind-role decision. Possession of an elevated database credential is not authorization.
- **GitHub:** Authenticates people and hosts the public template plus private assignment repositories. GitHub repository membership does not grant private service access by itself.
- **Configured model provider:** Receives only the minimum current-interaction context selected by the service. It is not trusted to select facts, authorize state changes, or preserve the system of record.
- **Student workspace and submitted content:** Fully attacker-controlled, even during an internal pilot.

## Security invariants

### Identity binding

1. Human identity is bound to the immutable numeric GitHub provider identity returned through the authenticated identity record.
2. Editable profile metadata, email address, display name, and GitHub login are never authorization inputs.
3. The current GitHub login is resolved from the immutable identity immediately before a collaborator invitation because GitHub's invitation operation accepts a login.
4. The invitation result and repository permission are read back before an assignment becomes ready.
5. GitHub sign-in and GitHub repository provisioning use separate applications and separate credentials.
6. CLI pairing uses a short-lived, single-use code. The exchanged token is random, assignment-scoped, expiring, revocable, and stored server-side only as a hash.
7. Every CLI request rechecks the token, actor, assignment, attempt state, and revocation. A previously valid token cannot retain access after assignment removal or role change.
8. Student credentials may request allowed actions but have no direct insert, update, or delete authority over official events, released facts, submissions, or evaluations. Only the service appends those records after validating the request against trusted state.

### Blind-role override at API and database boundaries

The effective-role decision is case-specific:

```text
if actor is assigned to a blind attempt and Attempt 1 is not submitted:
    effective role for that case = assigned student only
else:
    use ordinary case and staff membership
```

This decision must stop protected access twice:

- **Service boundary:** Every dashboard, API, CLI, publication, replay, evaluation, and elevated server operation checks the effective role before reading or changing data.
- **Database boundary:** Direct row access independently enforces assignment isolation and the blind override. A route bug must not expose protected rows.

The elevated server credential bypasses ordinary database row filtering, so server operations must call the same centralized effective-role decision and request only the records needed for the approved action. No general “staff can read everything” path may precede the blind check.

Blind access ends only after the first submission has been atomically accepted. A failed or incomplete submission does not restore staff rights. Restoration is recorded as an official state transition and is included in access-test evidence.

### Hidden-truth containment

1. Publication creates a strict allowlisted student bundle rather than deriving student visibility by removing known secret fields.
2. The protected package is stored separately from the student bundle and receives a separate digest.
3. Public builds, browser bundles, source maps, CLI packages, fixtures, logs, error payloads, assignment repositories, and their complete history are scanned for protected canaries.
4. Assignment repository creation starts from the public template at a recorded commit and adds only the exact student bundle and workspace material.
5. No private case package is cloned, copied to a temporary student path, or passed through Git history during provisioning.
6. Views and exported records expose only explicitly named student-visible fields. Adding a protected field to the underlying record must not expose it automatically.
7. Error messages identify the failed operation without returning hidden values, raw provider prompts, credentials, or another assignment's identifiers.

### Deterministic fact release

1. The authored case contract defines each route's matching cues, prerequisites, eligible fact IDs, consequence IDs, time effect, and explicit no-match result.
2. The service selects a route and deterministically computes allowed facts from the frozen case version and current assignment state.
3. A language model may render wording only after the authoritative facts are fixed. It cannot choose facts, add facts, change provenance, release evidence, or advance time.
4. Authoritative fact IDs and provenance are displayed separately from generated prose and recorded in the official event.
5. Requests satisfying the same authored cue contract against the same case state release the same authoritative facts even when configured models render different wording. Unauthored paraphrases may return unavailable and can be replayed by staff; the renderer never expands the official fact set.
6. An out-of-universe request returns unavailable and releases zero facts.
7. A collection action releases only its authored complete, biased, partial, unavailable, or unusable result. Hidden labels such as “biased” are not shown to the student unless the authored evidence itself makes that conclusion observable.
8. Provider failure releases zero facts and performs no state or time transition. A retry with the same operation ID cannot duplicate evidence or consequences.

### Provider prompt minimization

1. The provider receives only the selected persona's prompt-local context, the authoritative facts selected for the current response, and the minimum conversational turn needed to render it.
2. The provider never receives the full case package, calibration submissions, evaluation anchors, another assignment, unrelated unreleased evidence, staff notes, or student workspace files.
3. Provider and model choices come from server-side configuration. Students cannot supply a base URL, model endpoint, credential, request header, or arbitrary retrieval destination.
4. Provider requests use Volta-held credentials and bounded timeouts. Responses are schema-validated before any wording is shown.
5. Logs record provider, model, latency, token/cost metadata, status, and an interaction identifier. They do not record credentials, full protected prompts, or full generated content by default.
6. A capture-only provider is used in tests to prove prompt contents. At least one hosted proof runs each of the two configured model choices and compares authoritative fact IDs.
7. Provider retention and data-use settings must be reviewed and recorded before credentials are enabled. A provider whose terms cannot meet the prompt boundary remains disabled.

### CLI explicit-only telemetry

The CLI may transmit only:

- Explicit simulation commands and their typed arguments.
- Official records the student deliberately creates through the CLI.
- The current CLI version and minimal request diagnostics.
- Artifact paths the student explicitly selects at submission and the bounded supported contents returned from those paths.

The CLI must not enumerate, read, or transmit agent configuration, agent transcripts, shell history, environment variables, process lists, credential stores, unrelated workspace files, unselected repository files, or files outside the assignment root. It must not send a GitHub CLI token to the service.

Path handling resolves the assignment root, rejects absolute paths, traversal, symlinks, device files, and unsupported encodings, and enforces per-file and total-size limits before reading content. Network destinations are fixed to the hosted service; proxy and redirect behavior must not permit arbitrary egress.

### Immutable cases, events, submissions, and evaluations

1. Drafts are mutable. Publication atomically freezes canonical student and protected packages, their digests, calibration bindings, methodology snapshot, and approval identity.
2. A material edit creates a new version and clears approval. An assignment never silently follows a newer version.
3. Official events are append-only and carry a unique client operation ID plus an assignment sequence or state version.
4. A submission atomically freezes the case digest, attempt, official-event cutoff, released-evidence IDs and digests, ledger, decisions, calculations, provider provenance, CLI version, and selected artifact manifest and contents.
5. Calculations use bounded named inputs and supported formulas and are recomputed by the service. Student-supplied results are not accepted as reproducibility proof.
6. Published versions, official events, submissions, and evaluations cannot be updated or deleted through browser, CLI, service, or ordinary database roles.
7. Corrections, replay, reopening, and reevaluation create linked new records. Earlier records and their digests remain recoverable.
8. Overall effective is allowed only when the human evaluator marks all four competencies effective. No model or completeness check creates the qualitative judgment.

### Hostile artifact handling

1. Student and model-authored Markdown, HTML, SVG, JSON, and CSV are untrusted data.
2. Supported text artifacts are stored as bounded bytes with content type, digest, original relative path, verified Git commit, and capture time.
3. The service never executes student code, runs repository scripts, installs student dependencies, imports active content, evaluates formulas as code, or renders active HTML/SVG.
4. Dashboard display uses inert text or sandboxed rendering that cannot run script, load remote resources, navigate the parent page, access session credentials, or issue authenticated requests.
5. CSV and spreadsheet-oriented exports neutralize formula prefixes. Markdown links and images do not trigger server-side retrieval or authenticated browser requests.
6. Archive expansion and binary parsing are absent from the pilot. Unsupported content is rejected rather than inspected by a permissive fallback.
7. Artifact fetches accept only explicitly selected paths at the assignment's verified repository and commit. The fetcher does not follow submodules, symbolic links, or alternate repositories.

### GitHub provisioning and retries

1. The GitHub App is installed on the organization with the minimum repository administration and content permissions needed to create from the template, seed approved visible material, invite the student, and read back state.
2. The app installation is limited to the public template and repositories it creates. It does not receive access to unrelated private repositories.
3. Each assignment reserves one deterministic repository identity before making the external request.
4. Every provisioning step stores its provider object ID and readback before the next step. A timeout is reconciled by reading GitHub, not by repeating creation blindly.
5. `repository_created` with a failed invitation is recoverable. Retry resolves the current login and repeats only the missing invitation/readback step.
6. The assignment remains unavailable until repository privacy, template commit, student-bundle digest, collaborator permission, and invitation acceptance are confirmed.
7. Provisioning never includes protected package data. The generated repository is scanned across the working tree, all refs, and all reachable objects before the pilot invitation is treated as safe.
8. Rollback disables new provisioning and preserves the recorded repository. It does not automatically delete, rename, or recreate repositories.

## Authorization matrix

| Action or data | Anonymous | Assigned student | Other student | Ordinary staff | Blind staff assignee before Attempt 1 submission | Hosted service |
|---|---:|---:|---:|---:|---:|---:|
| Public engine and demo | Allow | Allow | Allow | Allow | Allow | Allow |
| Active case listing | Deny | Assigned case only | Deny | Authorized staff cases | Assigned case visible only as student bundle | Narrow operation only |
| Student bundle and released evidence | Deny | Own assignment | Deny | Authorized staff cases | Own assignment | Narrow operation only |
| Protected truth and unreleased evidence | Deny | Deny | Deny | Allow where authorized | Deny | Only after effective-role check |
| Calibration and evaluation anchors | Deny | Deny | Deny | Allow where authorized | Deny | Only after effective-role check |
| Own official events and submission | Deny | Read; may request allowed actions | Deny | Read | Read; may request allowed student actions | Sole append path after validation |
| Other assignment activity | Deny | Deny | Deny | Authorized staff cases | Deny | Only after effective-role check |
| Approve, publish, replay, evaluate, reopen | Deny | Deny | Deny | Allow where state permits | Deny before first submission | Only on behalf of authorized actor |
| Provision assignment repository | Deny | Deny | Deny | Authorized staff only | Deny | GitHub App after authorized request |

“Hosted service” is not an independent human role. It must always act for a validated operation and return no broader data than the initiating actor is allowed to receive.

## Negative-test matrix

| Boundary or attack | Falsifying test | Expected result | Local evidence | Hosted evidence |
|---|---|---|---|---|
| Anonymous active-data access | List, guess IDs, and query case, assignment, event, submission, and evaluation endpoints without a session. | No records, existence leaks, or distinguishing error bodies. | Database and API denial tests. | Direct unauthenticated probes. |
| Wrong-student isolation | Student A requests Student B's IDs and replays A's token against B's routes. | Denied on every read and mutation. | Two-assignment role matrix. | Two real sessions or test identities. |
| Editable identity spoofing | Change display name, email, or metadata to match the invitee. | Authorization remains bound to the immutable provider ID. | Identity fixture tests. | OAuth session readback and failed spoof probe. |
| Renamed GitHub account | Change fixture login while retaining provider ID; resolve before invitation. | Correct current login is invited and immutable identity remains stable. | GitHub adapter contract test. | Provider identity and collaborator readback. |
| Blind staff bypass | Rishabh uses dashboard, direct API, stale staff session, database client, and elevated server route before submission. | Every protected read and staff action is denied; student actions remain available. | Service and database role tests. | Browser and direct API probes against the pilot case. |
| Premature blind restoration | Submit an invalid or interrupted packet, then request staff access. | Staff access remains denied until atomic submission success. | Transaction failure test. | Failed submission followed by access probe. |
| Hidden truth in student repository | Seed canaries into protected package and scan checkout, branches, tags, objects, reflogs where available, and generated outputs. | Zero canaries in the assignment repository. | Generated-repository fixture scan. | Real private test repository scan. |
| Hidden field added to a record | Add a protected fixture field beneath a student-visible record. | Student view remains allowlisted and omits the field. | Serialization and database-view test. | Student API response inspection. |
| Prompt over-sharing | Seed distinct canaries in full truth, other assignment, calibration, and unrelated evidence; capture provider request. | Only current persona and selected facts appear. | Capture-provider test. | Capture endpoint or provider request audit. |
| Model-created fact | Provider returns an unselected fact ID or unsupported factual claim. | Response is rejected or shown only as non-authoritative wording; no fact/event release occurs. | Invalid-provider fixture. | Controlled invalid-response probe where supported. |
| Equivalent inquiry drift | Ask equivalent questions through both configured models from identical state. | Same route, fact IDs, and provenance; wording may differ. | Two-renderer contract test. | Two configured model runs. |
| Out-of-universe request | Ask for unauthored evidence or stakeholder knowledge. | Explicit unavailable result, zero new facts, no hidden state change. | Router no-match test. | CLI request plus event readback. |
| Duplicate operation | Retry the same conversation, collection, submission, and provisioning operation after timeout. | One consequence and one official result; response returns the existing state. | Concurrency and idempotency tests. | Failure injection with readback. |
| Provider timeout or refusal | Interrupt or return invalid provider output. | No facts released, no time advance, safe retry remains available. | Mock provider failures. | Staged timeout/invalid response. |
| CLI workspace surveillance | Place canaries in agent config, transcript, shell history, environment, process arguments, parent paths, and unselected files. | No canary is read or transmitted. | File-access and network-capture tests. | Run from instrumented clean assignment workspace. |
| Path and symlink escape | Select absolute, traversal, symlink, device, submodule, oversized, and unsupported files. | Rejected before content read or upload. | CLI path-boundary tests. | Submission endpoint probes. |
| Stored active content | Submit hostile HTML, SVG, Markdown links/images, CSV formulas, and script-like JSON. | No script, navigation, remote fetch, authenticated request, or spreadsheet formula execution. | Browser security tests and export tests. | Hosted dashboard with network and console observation. |
| Immutable record mutation | Attempt update/delete of published case, event, submission, and evaluation through every ordinary route and database role. | Denied; correction requires a linked new record. | Database and API mutation tests. | Direct API probes and record digest readback. |
| Calculation tampering | Submit a result inconsistent with named inputs or an unsupported formula. | Service recomputes supported results or rejects the packet. | Calculation property tests. | Stored inputs/result readback. |
| Partial GitHub failure | Return success then timeout during create, fail invitation, or delay acceptance. | Reconciliation finds the existing repository and resumes the missing step without duplication. | Stateful GitHub mock. | Real test repository plus staff retry. |
| Unconfigured egress | Supply arbitrary provider URL, evidence URL, redirect, or repository owner. | Request rejected; no outbound connection occurs. | Destination allowlist and redirect tests. | Egress/network log inspection. |
| Secret leakage | Seed non-live credential canaries and exercise builds, errors, logs, CLI output, prompts, submissions, and repository generation. | No canary leaves the server-only boundary. | Build/log/prompt/repository scans. | Hosted log and artifact inspection. |

Every access test must prove both halves: the intended actor succeeds and the actor who must be stopped fails. A successful staff or student request alone is not access evidence.

## Failure handling and audit

- Mutating operations carry a client operation ID and produce one durable outcome. Timeouts are reconciled by readback before retry.
- Authorization denial is fail-closed and does not reveal whether a protected object exists.
- Provider and GitHub failures are visible to authorized staff with a bounded retry action. Students see only failures relevant to their current action.
- Audit records identify actor, effective role, assignment, case version, attempt, action, result, provider/model where applicable, and linked replay or retry. They exclude secrets, full protected prompts, private workspace data, and unnecessary content.
- Clock and sequence values come from the service. Clients cannot select event order, submission cutoff, publication time, or blind-role restoration time.
- When a control boundary is uncertain, disable new assignment or provider actions, revoke affected tokens or credentials, preserve existing evidence, and investigate from readback. Do not erase or overwrite records to hide a failed run.

## Rollout security gates

Before Rishabh receives the pilot assignment:

- Database grants, row-level access, blind override, immutable-record behavior, and elevated-route authorization pass locally and in the hosted project.
- The GitHub OAuth application and GitHub App use separate credentials; the app installation and selected-repository boundary are read back.
- A real private test assignment repository passes full-history protected-canary scanning and collaborator-state readback.
- The CLI passes explicit-only telemetry, path escape, token expiry, revocation, and successive-session tests.
- The provider capture test proves prompt-local context, and both configured models preserve authoritative facts.
- Hostile artifact tests show no active rendering, execution, remote retrieval, or credential-bearing request.
- Assignment creation and provider actions have independent disable controls.

Pilot completion adds the real blind-role probes before submission, Matt's evaluation, reopening, and readback of both immutable attempts. These prove only the internal pilot boundary, not readiness for real student or client data.

## Reportable findings and severity context

The following are security findings for this pilot:

- Any path that exposes protected truth, calibration, evaluation anchors, another assignment, or credentials to a student, public artifact, provider, or uninvited person.
- Any bypass of the blind-case override, including through stale sessions, direct database access, or elevated server operations.
- Any provider or model influence over authoritative fact selection, provenance, or state transition.
- Any workspace collection beyond explicit student commands and selected supported artifacts.
- Any ability to mutate or delete a frozen case, official event, submission, or evaluation.
- Any execution or active rendering of student/model-authored content.
- Any retry path that duplicates repositories, invitations, evidence, time advancement, submission, or evaluation.
- Any real external effect or exposure of production credentials from a simulated action.

Treat cross-assignment or protected-truth exposure, credential exposure, remote code execution, and blind-role bypass as critical for the pilot because they invalidate the assessment boundary. Treat stored script execution, unauthorized mutation of the evidence record, and real external effects as high unless evidence demonstrates lower reach or impact. Availability and polish issues are lower severity unless they corrupt or expose the evidence record.

## Explicit exclusions and accepted pilot limitations

The following are excluded because the approved pilot does not introduce them:

- Security of a student's chosen coding agent or outside advisory model. The harness does not receive those credentials or conversations.
- Execution security for student code. The harness never runs it.
- Protection of public reusable software and synthetic demo content from being read or forked.
- Voice, mobile clients, binary evidence parsing, arbitrary URL collection, queues, webhooks, realtime delivery, and notifications.
- Production-scale abuse prevention, automated retention/deletion, legal hold, repository archival, high availability, disaster recovery, and multi-region behavior.
- Security of AI Lab or Volta Intelligence. They are not runtime dependencies and receive no writes.

Accepted limitations for the internal pilot:

- Reliable internet and GitHub accounts are assumed.
- Manual staff setup, polling, invitation acceptance, provider configuration, and cleanup are acceptable at two-user scale.
- Only text-oriented evidence and bounded selected artifacts are supported.
- Model wording may vary. Deterministic authoritative facts, replay, calibration, and human evaluation compensate for that variation.
- Retention and post-program repository access are unresolved and block real-student rollout, but not the fictional Matt/Rishabh pilot.

These exclusions are not permission to suppress a finding that crosses an included boundary. A weakness that exposes protected data or enables a real external effect remains reportable even if it uses an excluded component as the route.

## Evidence boundary

- **Source review** establishes intended behavior only.
- **Automated local tests** establish repeatable checks against the local implementation and mocked failures.
- **Local runtime proof** establishes the CLI, dashboard, and local database behavior in one controlled environment.
- **Hosted proof** establishes identity, database rules, GitHub repositories, provider requests, browser behavior, and operational readback in the pilot environment.
- **Blind-run proof** establishes that the complete experience preserves the assessment boundary for Rishabh's Attempt 1.

None of these alone proves production readiness. A merged pull request, passing local suite, successful deploy, screenshot, or GitHub invitation is not a substitute for the hosted negative probes and immutable record readbacks required by this model.
