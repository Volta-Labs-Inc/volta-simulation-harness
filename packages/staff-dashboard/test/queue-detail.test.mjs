import { describe, expect, it } from "vitest";

import { assignmentQueueDetail } from "../web/queue-detail.js";

function activeBundle(overrides = {}) {
  return {
    assignment: {
      assignmentId: "assignment-1",
      attemptNumber: 1,
      lifecycleState: "active",
      repositoryReadback: "ready",
    },
    ...overrides,
  };
}

describe("staff assignment queue detail", () => {
  it("surfaces a new pending request after an earlier response in the same attempt", () => {
    expect(assignmentQueueDetail(activeBundle({ reviewRequest: { reviewRequestId: "question-2", status: "open" } }), { attemptNumber: 1, reviewRequestId: "question-1" }, undefined)).toBe("Review requested · response pending");
  });
  it("keeps submission pending after review response until an accepted submission exists", () => {
    const response = { attemptNumber: 1 };

    expect(assignmentQueueDetail(activeBundle(), response, undefined)).toBe(
      "Review responded · submission pending",
    );
    expect(
      assignmentQueueDetail(
        activeBundle({ acceptedSubmission: { submissionId: "submission-1" } }),
        response,
        undefined,
      ),
    ).toBe("Review responded · evaluation open");
  });
});
