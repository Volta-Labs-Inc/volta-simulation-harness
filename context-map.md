# Context map

## Purpose

Provide a reusable environment where one student investigates a simulated operating problem, gathers or plans evidence, proposes a proportionate response, and defines objective success and failure criteria.

## People

- Matt: product owner, reference-case author and approver, first-pilot evaluator.
- Rishabh: first-pilot student for blind Attempt 1; may later resume staff access.
- Students: contractors using their own coding agent and private assignment repository.
- Volta staff: case authors, approvers, reviewers, and human evaluators.

## Systems of record

- The approved product contract is identified by digest `7a7162ea36a4acef5be8b28f4339a4b2282e9e4a23278ffaa971b6416ebe1f94`.
- This GitHub repository is authoritative for delivery behavior and proof.
- The private Supabase service will be authoritative for active case truth, assignments, events, submissions, and evaluations.
- Private student GitHub repositories will hold each student's visible starting bundle, released evidence, and their own work.
- AI Lab and Volta Intelligence are optional authoring references, never runtime dependencies.

## Non-negotiable boundaries

- Public code contains no active assessed truth or credentials.
- Students see the rubric and applicable requirement completeness, but no hidden evaluation anchors or quality judgment during an attempt.
- Only harness-released facts are official evidence.
- Real external effects are outside the harness.
- First-pilot blindness overrides Rishabh's ordinary staff role until Attempt 1 is submitted.

## Current delivery target

A text-only internal pilot with a student CLI, a small staff dashboard, a complete fictional customer-support-routing case, three calibration submissions, two configured model choices, and a hosted proof packet.
