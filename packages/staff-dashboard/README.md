# Staff evaluation workbench

This local-only package proves the Issue 06 staff journey against synthetic public fixtures. It separates persisted case and assignment state from browser presentation, projects an allowlisted official timeline, records non-blocking review responses, and requires four human competency judgments before deriving an overall result.

A polished artifact cannot compensate for a missing baseline. Evidence sufficiency and objective criteria cannot be marked effective until the evaluator identifies either a measured baseline or a credible plan to establish one. A well-supported no-build decision can still be effective; the workbench never compares a submission with a canonical answer and never asks a model to grade it.

Provider replay accepts only independently receipt-backed original and replay records bound to the same assignment, attempt, case version, and official event. It preserves selected truth, released evidence, and the existing evaluation. Reopening verifies the evaluation against every accepted-attempt identifier and digest, then preserves it as immutable history while creating the safely numbered next attempt.

HTML, SVG, Markdown, JSON, and CSV artifacts display only when a separate immutable submission receipt matches the exact path, type, byte length, digest, and displayed bytes. Unsafe path forms are rejected. The local server adds a restrictive content security policy, and evaluation CSV output neutralizes formula-leading cells.

## Local use

```sh
npx tsc -b packages/staff-dashboard
node packages/staff-dashboard/scripts/serve.mjs
```

Then open `http://127.0.0.1:4176`.

The fixture server keeps staff review responses, evaluations, replay links, and reopen records in an atomic local JSON store so browser reloads do not erase staff work. By default that file is `${TMPDIR}/volta-simulation-harness/staff-dashboard-store.json`; set `STAFF_DASHBOARD_STORE_FILE` to an isolated path for a test run. Set `STAFF_DASHBOARD_PORT` to use a port other than `4176`.

## Connected local student state

The root command creates a fresh public assignment and starts this connected mode automatically:

```sh
npm run pilot:local
```

For focused adapter development, the workbench can also read an existing file-backed state directly. Use the assignment's service-state directory and its relative state filename:

```sh
npm run build
STAFF_DASHBOARD_STUDENT_STATE_ROOT="/absolute/path/to/student-service-state" \
STAFF_DASHBOARD_STUDENT_STATE_PATH="mock-service.json" \
STAFF_DASHBOARD_STORE_FILE="/absolute/path/to/staff-operations.json" \
npm --workspace @volta-sim/staff-dashboard run serve
```

Both student-state variables are required together. Connected mode discovers the current assignment and attempt, published case, official actions, released facts, exact pending review, and accepted submission from the student service file. A staff response resolves that exact pending review in the same file, so the student's next `resume` shows it. Evaluation remains in the staff operation store but is bound to the verified accepted submission. Reopen uses the existing mock student-service boundary, preserves the submitted attempt in its history, and creates the next active attempt.

Students can ask multiple review questions within the same attempt. Each question receives its own preserved response, and an unanswered follow-up remains visible even after earlier guidance. Repeating the exact response operation is safe; changing its question or text is rejected. Existing version 1 and version 2 staff stores retain their previous responses when another question is answered.

The accepted decision packet includes the student's economic reasoning, estimates and assumptions, calculations and sources, requirement assessments, competency reasoning, feasibility, risks, decision conditions, and evidence citations. Prior accepted attempts retain their complete packets and review history. All submitted content displays as text; student-authored markup cannot run in the workbench. A fixture without detailed reasoning is explicitly labeled as missing from the fixture rather than attributed to the student.

Provider replay is deliberately disabled in connected mode. The current file-backed state records provider routing metadata but not an independent receipt-backed replay result, so the workbench will explain that limitation instead of manufacturing a comparison.

## Live-service adapter contract

The browser knows only the versioned staff adapter in `web/adapter.js`; it does not import fixture records. A live service can replace the local server when it implements the same boundary:

- `GET /api/staff-dashboard` returns the complete staff-authorized snapshot with `adapterVersion: "staff-dashboard-v1"`, an environment label, a monotonic revision, case records, assignment bundles, and the staff operations recorded for each assignment.
- `POST /api/staff-dashboard/review-responses` accepts `assignmentId`, a caller-generated `operationId`, the exact pending `reviewRequestId`, and `responseText`.
- `POST /api/staff-dashboard/evaluations` accepts `assignmentId`, a caller-generated `operationId`, and the four-competency evaluation `draft`.
- `POST /api/staff-dashboard/replays` and `POST /api/staff-dashboard/reopens` accept `assignmentId` and a caller-generated `operationId`.
- Every successful mutation returns the same complete snapshot shape. Repeating an `operationId` must return the previously recorded result rather than create a second record.
- The service, not the browser, supplies timestamps and viewer identity, authorizes the assignment, validates accepted-submission and provider receipts, keeps mutations append-only, and projects only official timeline events and released evidence that the staff viewer may inspect.

The TypeScript contract is exported from `src/adapter.ts`. Connected student and staff operations share an assignment lock across local processes. This prevents overlapping actions from replacing each other's work. The student and staff stores remain separate local files, without a crash-safe transaction spanning both files. A hosted connection still needs the Issue 03 service/database boundary, staff and blind-role authorization, authoritative assignment discovery across students, and the same endpoint contract backed by service records.
