# Volta Simulation Harness

This repository is the public, reusable engine for evidence-led student simulations. Active case truth, unreleased evidence, calibrations, evaluation anchors, credentials, and student activity belong only in the private hosted service.

## Product rules

- A simulation joins discovery and a proportionate build or experiment in one case.
- The student may conclude continue, pivot, buy, collect more evidence, or stop.
- Official facts come only from the frozen case universe. A language model may render those facts but may never choose, add, or alter them.
- The harness reports completeness, provenance, and reproducibility. Matt or Rishabh judges effectiveness across problem viability, evidence sufficiency, response feasibility, and objective success criteria.
- Do not inspect or upload private coding-agent conversations, shell history, environment variables, processes, credentials, or unrelated workspace files.
- Risky simulated actions suggest asynchronous Volta review but do not block sandbox work. The harness must never perform a real client or production action.
- Published case versions, official events, submissions, and evaluations are append-only. Reopening creates a new attempt.
- Attempt 1 of the reference pilot is blind for Rishabh even if he otherwise has staff access.

## Engineering rules

- Use Node.js 22 or later and pinned dependencies with a committed lockfile.
- Keep active secrets out of this repository and every generated student repository, including history and build artifacts.
- Treat all student and model-authored content as hostile data. Never execute it; render Markdown, HTML, and SVG inertly.
- Every exposed database table must use explicit grants and row-level access tests. Elevated server credentials must repeat the same authorization checks.
- Prefer deterministic, idempotent operations with readback over background infrastructure for the pilot.
- Use `apply_patch` for manual edits. Preserve unrelated work.
- Explain behavior and evidence, not framework structure.

## Verification

Run the smallest relevant checks while developing, then run the full workspace checks before declaring an increment verified. Security-sensitive changes require both allowed and denied access tests.
