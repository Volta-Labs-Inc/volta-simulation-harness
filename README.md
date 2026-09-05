# Volta Simulation Harness

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

## License

Apache-2.0.
