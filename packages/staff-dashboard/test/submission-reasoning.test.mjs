import { describe, expect, it } from "vitest";
import { makeCompleteExampleSubmission } from "../../core/examples/non-assessed-library-routing.ts";
import { submissionReasoningSections } from "../web/submission-reasoning.js";

describe("staff readable accepted reasoning", () => {
  it("retains student rationale, numerical assumptions, provenance, and citations in the rendered sections", () => {
    const draft = makeCompleteExampleSubmission(`sha256:${"a".repeat(64)}`);
    const hostileText = "<img src=x onerror=alert(1)> & <script>globalThis.attacked=true</script>";
    draft.economicRationale = hostileText;
    const sections = submissionReasoningSections(draft);
    const displayed = sections.flatMap(({ items }) => items).join("\n");
    expect(sections.find(({ title }) => title === "Economic reasoning").items).toEqual([hostileText]);
    for (const expected of [draft.decision.rationale, draft.decision.supportingEvidenceIds[0], draft.decision.expectedEvidence[0].decisionUse, draft.decision.pivotOrStopConditions[0].rationale, draft.estimates[0].assumptions[0], draft.calculations[0].rationale, draft.calculations[0].inputs[0].source, draft.responsePlan.feasibility, draft.responsePlan.risks[0], draft.requirementAssessments[0].rationale, draft.competencyClaims[0].rationale, draft.evidence[0].sourceEventId, draft.evidence[0].provenance, draft.successCriteria[0].baseline]) {
      expect(displayed).toContain(expected);
    }
  });
});
