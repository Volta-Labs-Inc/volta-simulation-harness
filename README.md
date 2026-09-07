# Volta Simulation Harness

New cases default to small businesses unless the user explicitly requests another setting. Characters and student guidance use conversational, plain English. Buyer-role and JTBD labels belong in teaching notes with simple explanations, rather than in the characters' speech.

Case generation follows the [persona, JTBD and buyer requirements](packages/authoring/PERSONA-GENERATION.md). The authoring importer rejects missing character profiles, incomplete buyer coverage and broken discovery references. Full profiles stay private; students discover roles and motivations through evidence.

Local persona interviews save the exact submitted question, official answer, and evidence references in `.volta-sim/interviews/attempt-N/persona-ID.json` inside the assignment. Use a separate chat for each persona. Repeating an operation does not duplicate its transcript entry. These exports contain simulation interviews only; they do not capture coding-agent conversations.

An evidence-led environment for realistic student problems. Each simulation asks one student to decide whether a problem warrants a build, a smaller experiment, a purchase, more evidence, a pivot, or a stop—and to defend that decision with objective success and failure criteria.

## Current status

The public foundation can validate and freeze authored case versions, release only authored facts, keep blind-pilot access fail-closed, validate reproducible submissions, and preserve human-only effectiveness judgments. The first fictional customer-support-routing case is being validated privately before approval.

This is not yet a hosted pilot. The local database boundaries, deterministic truth engine, guarded assignment-provisioning flow, student CLI, and staff workbench are implemented and tested with synthetic fixtures. Real GitHub OAuth and App behavior, a dedicated hosted database and Data API, configured model credentials, distributed CLI use, second-machine token and privacy probes, and Rishabh's blind run still require hosted runtime proof. See [the delivery contract](docs/delivery-contract.md) and [security model](docs/security-model.md).

## Trust boundary

The public repository contains reusable software, schemas, tests, documentation, and non-assessed examples. Active case truth, unreleased evidence, calibrations, evaluation anchors, credentials, and student activity stay in the private hosted service.

A language model may render an authored response naturally. It never decides which facts are official, changes simulation state, evaluates the student, or gains access to the full case.

The harness records only explicit simulation actions and explicitly selected submission artifacts. It does not inspect a student's Claude Code, Codex, Cursor, shell history, environment, processes, or unrelated files.

## Local verification

Requirements: Node `22.23.2` and npm `10.9.9`.

```bash
npm ci
npm run verify
```

The full pilot also requires hosted database access tests, browser journeys, a real private GitHub assignment, provider prompt capture, and blind-role probes. Passing the local suite is not hosted proof.

## Connected local pilot

After `npm ci`, start a complete public, non-assessed pilot from the repository root:

```bash
npm run pilot:local
```

This one command builds the workspace, creates a new isolated Git assignment under `.private/local-pilots/`, starts the file-backed student service and connected staff workbench on loopback ports, and prints the exact student help, login, status, and staff-browser commands. Attempt 1 starts active with no events, review requests, released evidence, captured reasoning, or submission. Press Ctrl-C once to stop both services cleanly; the isolated checkout and local records remain available for inspection.

The printed student commands use the separate `volta-sim-local` entry point and its generated `.volta-sim/local-pilot.json`. That command accepts no service-origin flag and rejects non-loopback, moved, or altered manifests. The production `volta-sim` command retains its fixed release origin.

To rehearse an authored case locally, run `npm run pilot:local -- --practice-case <private-case-directory>`. This explicit command creates a separate non-assessed practice snapshot; it does not approve or alter the original case for assessment. Only allowlisted starting files enter the assignment. Later evidence appears as inert text in the relevant official reply, and collections retain their authored prerequisites. Replies use frozen authored wording, with no live model calls. Staff truth and the source digest receipt remain in the sibling local service directory. This same-machine practice setup is for the case owner, not a hosted blind-access boundary.

## License

Apache-2.0.
