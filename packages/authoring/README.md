# Case authoring importer

Start problem generation with [the persona and buyer authoring requirements](PERSONA-GENERATION.md). Every imported person requires a complete private persona, JTBD, knowledge boundaries, episodes and discoverable routes. Every case must cover Economic, Functional and Technical buyers, including explicit overlap. These are validated requirements, not optional prompting advice.

The importer turns an explicitly allowlisted multi-file case directory into separate student-visible and protected packages. It reads local UTF-8 YAML, Markdown, and CSV files only; it never fetches a URL or contacts an authoring reference system.

Run `npm run case:validate -- <case-directory>` to validate a case and preview deterministic digests. These previews detect changed material; they do not approve, publish, or confer trust on a case. A valid draft remains ineligible for publication until a later trusted service records the approval and binds it to the exact visible and protected material.

Requirements with an authored activation gate or explicitly optional scope remain eligible for `not-applicable` with a student rationale. This is intentional when a defensible stop, pivot, no-build, or collect-more decision means the later activation condition never occurs. Requirements authored as fixed applicable cannot be marked not applicable.

Persona and collection matching is deterministic only for authored cue-equivalent requests. Authors supply the canonical cues, complete cue groups, exclusions, priorities, and prerequisite evidence. If more than one eligible route shares the highest priority, the runtime rejects the request as ambiguous and releases no facts, evidence, time, or resources.

The student-bundle manifest is generated only from `student_bundle.always_copy`. Any traversal, symlink, duplicate source or target, protected document, or forbidden-root reference rejects the import.
