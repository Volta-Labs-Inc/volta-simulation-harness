// This returns text only. The workbench places every item in textContent, never HTML.
export function submissionReasoningSections(reasoning) {
  if (!reasoning) return [{ title: "Detailed reasoning", items: ["Detailed reasoning is unavailable in this fixture. Do not infer that the student omitted it."] }];
  const refs = (ids) => ids.length ? ids.join(", ") : "none cited";
  return [
    { title: "Decision and supporting evidence", items: [
      `${reasoning.decision.choice}: ${reasoning.decision.rationale}`,
      `Decision ${reasoning.decision.id} · ${reasoning.decision.createdAt} · Evidence: ${refs(reasoning.decision.supportingEvidenceIds)}`,
      ...reasoning.decision.expectedEvidence.map((item) => `Expected evidence: ${item.description} · Source or method: ${item.sourceOrMethod} · Decision use: ${item.decisionUse}`),
      ...reasoning.decision.pivotOrStopConditions.map((item) => `${item.action}: ${item.condition} · Why: ${item.rationale}`),
    ] },
    { title: "Economic reasoning", items: [reasoning.economicRationale] },
    { title: "Effort and other estimates", items: reasoning.estimates.map((item) =>
      `${item.subject}: ${item.low}–${item.high} ${item.unit} · Confidence: ${item.confidence} · Assumptions: ${item.assumptions.join("; ")} · ${item.id} · ${item.createdAt}`) },
    { title: "Calculations and sources", items: reasoning.calculations.flatMap((item) => [
      `${item.name} (${item.id}): ${item.formula.operation}(${item.formula.inputNames.join(", ")}) = ${item.result.value} ${item.result.unit} · Why: ${item.rationale}`,
      ...item.inputs.map((input) => `${input.name} = ${input.value} ${input.unit} · Source: ${input.source}`),
    ]) },
    { title: "Response feasibility and risks", items: [reasoning.responsePlan.feasibility, ...reasoning.responsePlan.risks] },
    { title: "Requirement assessments", items: reasoning.requirementAssessments.map((item) =>
      `${item.requirementId} · ${item.status}: ${item.rationale} · Evidence: ${refs(item.evidenceIds)}`) },
    { title: "Student competency reasoning", items: reasoning.competencyClaims.map((item) =>
      `${item.competencyId}: ${item.rationale} · Evidence: ${refs(item.evidenceIds)}`) },
    { title: "Success criteria and baselines", items: reasoning.successCriteria.map((item) =>
      `${item.metric} · ${item.baseline !== undefined ? `Measured baseline: ${item.baseline}` : `Baseline plan: ${item.baselinePlan}`} · Target: ${item.target} by ${item.targetDate} · Failure threshold: ${item.failureThreshold}`) },
    { title: "Reasoning ledger and citations", items: reasoning.ledger.map((item) =>
      `${item.id} · ${item.kind}: ${item.statement} · Official facts: ${refs(item.officialFactIds)} · ${item.createdAt}`) },
    { title: "Evidence provenance", items: reasoning.evidence.map((item) =>
      `${item.id} · Official fact: ${item.officialFactId} · Source event: ${item.sourceEventId} · ${item.provenance} · Captured: ${item.capturedAt} · Assignment ${item.assignmentId}, attempt ${item.attemptNumber}`) },
    { title: "Accepted selected artifacts", items: reasoning.responsePlan.artifactSnapshots.length
      ? reasoning.responsePlan.artifactSnapshots.map((item) => `${item.path} · ${item.mediaType} · ${item.byteLength} bytes · ${item.digest}\n${item.content}`)
      : ["No artifacts selected for this response."] },
  ];
}
