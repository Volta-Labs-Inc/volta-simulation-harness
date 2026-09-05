import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import * as publicCore from "@volta-sim/core";
import {
  CaseVersionSourceSchema,
  HumanEvaluationSchema,
  SubmissionRecordSchema,
} from "@volta-sim/contracts";
import {
  decideAssignmentAccess,
  type AssignmentAccessContext,
  type CaseStaffAuthorization,
} from "../src/access.js";
import { canonicalSerialize, sha256Digest } from "../src/canonical.js";
import { assertCaseVersionDigest, createCaseVersionDigests } from "../src/case-version.js";
import {
  deriveOverallHumanRating,
  validateHumanEvaluationConsistency,
} from "../src/evaluation.js";
import {
  publishCase,
  verifyPublishedCase,
  type PublishedCase,
} from "../src/published-case.js";
import {
  factIdsEligibleForRelease,
  resolveAuthoredRequest,
  ROUTE_TIE_BREAK_POLICY,
} from "../src/route-engine.js";
import {
  acceptSubmission,
  checkSubmissionCompleteness,
  readAttempt,
  reopenAttempt,
  verifySubmissionRecord,
  type SubmissionAcceptanceMetadata,
} from "../src/submission.js";
import type { TrustedReleasedState } from "../src/trusted-state.js";
import {
  makeCompleteExampleSubmission,
  nonAssessedLibraryRoutingCase,
} from "../examples/non-assessed-library-routing.js";

function receiptFor(source: typeof nonAssessedLibraryRoutingCase) {
  const sourceDigests = createCaseVersionDigests(source);
  const receiptContent = {
    kind: "validated-case-import" as const,
    source,
    recordedVisibleBundleDigest: sourceDigests.visibleBundleDigest,
    recordedProtectedPackageDigest: sourceDigests.protectedPackageDigest,
  };
  return { ...receiptContent, validationDigest: sha256Digest(receiptContent) };
}

const publishedCase = publishCase(receiptFor(nonAssessedLibraryRoutingCase));
const digests = publishedCase.digests;

function trustedState(overrides: Partial<TrustedReleasedState> = {}): TrustedReleasedState {
  const caseVersionDigest = overrides.caseVersionDigest ?? digests.caseVersionDigest;
  return {
    assignmentId: "assignment-1",
    attemptNumber: 1,
    caseVersionDigest,
    currentEventSequence: 12,
    events: [
      {
        eventId: "event-8",
        assignmentId: "assignment-1",
        attemptNumber: 1,
        caseVersionDigest,
        sequence: 8,
        officialFactIds: ["median-wait"],
        providerInteractionId: "interaction-1",
      },
    ],
    ...overrides,
  };
}

function acceptanceMetadata(
  overrides: Partial<SubmissionAcceptanceMetadata> = {},
): SubmissionAcceptanceMetadata {
  return {
    acceptedAt: "2026-09-04T16:00:00.000Z",
    cliVersion: "0.1.0",
    providerProvenance: [
      {
        interactionId: "interaction-1",
        eventId: "event-8",
        providerId: "mock-provider",
        modelId: "deterministic-capture",
        calibration: "passed",
        renderedAt: "2026-09-04T15:00:00.000Z",
      },
    ],
    ...overrides,
  };
}

function activeAttempt() {
  return {
    assignmentId: "assignment-1",
    studentGithubUserId: "12345",
    caseVersionDigest: digests.caseVersionDigest,
    attemptNumber: 1,
    openedAt: "2026-09-04T13:00:00.000Z",
    status: "active" as const,
  };
}

function staffAuthorization(
  allowedActions: CaseStaffAuthorization["allowedActions"] = ["staff-read-protected-case"],
): CaseStaffAuthorization {
  return {
    authorizationId: "staff-grant-1",
    githubUserId: "12345",
    caseId: publishedCase.source.visible.caseId,
    caseVersionDigest: digests.caseVersionDigest,
    allowedActions,
  };
}

function accessContext(overrides: Partial<AssignmentAccessContext> = {}): AssignmentAccessContext {
  const requiredBlindPolicy = {
    policyId: "blind-policy-1",
    policyVersion: 1,
    assignmentId: "assignment-1",
    caseId: publishedCase.source.visible.caseId,
    caseVersionDigest: digests.caseVersionDigest,
    mode: "attempt-one" as const,
    blindStudentGithubUserId: "12345",
  };
  return {
    assignmentId: "assignment-1",
    requestedAssignmentId: "assignment-1",
    caseId: publishedCase.source.visible.caseId,
    caseVersionDigest: digests.caseVersionDigest,
    studentGithubUserId: "12345",
    attemptNumber: 1,
    attemptStatus: "active",
    requiredBlindPolicy,
    blindPolicy: requiredBlindPolicy,
    staffAuthorization: staffAuthorization(),
    ...overrides,
  };
}

function request(question: string) {
  return {
    assignmentId: "assignment-1",
    attemptNumber: 1,
    channel: "persona" as const,
    targetId: "library-manager",
    question,
  };
}

function textDigest(content: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(content, "utf8").digest("hex")}`;
}

describe("strict case authoring and immutable publication", () => {
  it("does not expose publication or digest-construction authority from the package root", () => {
    for (const symbol of [
      "canonicalSerialize",
      "sha256Digest",
      "createCaseVersionDigests",
      "assertCaseVersionDigest",
      "CasePublicationReceiptSchema",
      "publishCase",
      "verifyPublishedCase",
    ]) {
      expect(publicCore).not.toHaveProperty(symbol);
    }
  });

  it("rejects a case whose required visible data is missing", () => {
    const broken = structuredClone(nonAssessedLibraryRoutingCase) as Record<string, unknown>;
    delete (broken.visible as Record<string, unknown>).constraints;
    expect(CaseVersionSourceSchema.safeParse(broken).success).toBe(false);
  });

  it("rejects an incomplete calibration set and unknown fact references", () => {
    const broken = structuredClone(nonAssessedLibraryRoutingCase);
    broken.protected.calibrationAnchors[2]!.class = "effective";
    broken.protected.routes[0]!.outcome.factIds = ["invented-fact"];
    const result = CaseVersionSourceSchema.safeParse(broken);
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map(({ message }) => message);
      expect(messages.some((message) => message.includes("three") || message.includes("effective"))).toBe(
        true,
      );
      expect(messages.some((message) => message.includes("Unknown fact reference"))).toBe(true);
    }
  });

  it("rejects authored route cues that normalize to empty", () => {
    const broken = structuredClone(nonAssessedLibraryRoutingCase);
    broken.protected.routes[0]!.match = {
      anyPhrases: ["---"],
      allTerms: [],
      anyTermGroups: [],
      noneTerms: [],
    };
    expect(CaseVersionSourceSchema.safeParse(broken).success).toBe(false);
  });

  it("rejects a route that releases a fact from a different persona or evidence source", () => {
    const broken = structuredClone(nonAssessedLibraryRoutingCase);
    broken.protected.routes[0]!.outcome.factIds = ["log-median-wait"];
    const result = CaseVersionSourceSchema.safeParse(broken);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some(({ message }) => message.includes("declared source"))).toBe(true);
    }
  });

  it("rejects undeclared nested difficulty fields", () => {
    const broken = structuredClone(nonAssessedLibraryRoutingCase) as unknown as {
      visible: { difficulty: Record<string, unknown> };
    };
    broken.visible.difficulty.timeLimit = "two hours";
    expect(CaseVersionSourceSchema.safeParse(broken).success).toBe(false);
  });

  it("uses canonical ordering while invalidating visible and protected material edits", () => {
    expect(canonicalSerialize({ z: 1, a: { d: 2, c: 3 } })).toBe(
      canonicalSerialize({ a: { c: 3, d: 2 }, z: 1 }),
    );
    const reordered = {
      status: nonAssessedLibraryRoutingCase.status,
      protected: nonAssessedLibraryRoutingCase.protected,
      approvedAt: nonAssessedLibraryRoutingCase.approvedAt,
      visible: nonAssessedLibraryRoutingCase.visible,
      approvedBy: nonAssessedLibraryRoutingCase.approvedBy,
      methodologySnapshot: nonAssessedLibraryRoutingCase.methodologySnapshot,
      requirementsSnapshot: nonAssessedLibraryRoutingCase.requirementsSnapshot,
    };
    expect(createCaseVersionDigests(reordered)).toEqual(digests);

    const hiddenEdit = structuredClone(nonAssessedLibraryRoutingCase);
    hiddenEdit.protected.facts[0]!.claim = "The median is now 17 minutes.";
    expect(createCaseVersionDigests(hiddenEdit).protectedPackageDigest).not.toBe(
      digests.protectedPackageDigest,
    );
    expect(() => assertCaseVersionDigest(hiddenEdit, digests.caseVersionDigest)).toThrow(
      /new approved version/,
    );

    const visibleEdit = structuredClone(nonAssessedLibraryRoutingCase);
    visibleEdit.visible.constraints[0] = "The library may add one fictional staff member.";
    expect(createCaseVersionDigests(visibleEdit).visibleBundleDigest).not.toBe(
      digests.visibleBundleDigest,
    );
  });

  it("deep-freezes a digest-bound publication and rejects a forged publication on routing", () => {
    expect(Object.isFrozen(publishedCase)).toBe(true);
    expect(Object.isFrozen(publishedCase.source.protected.facts[0])).toBe(true);
    expect(verifyPublishedCase(publishedCase).digests).toEqual(digests);

    const forged: PublishedCase = {
      source: structuredClone(nonAssessedLibraryRoutingCase),
      digests: { ...publishedCase.digests, caseVersionDigest: `sha256:${"f".repeat(64)}` },
    };
    expect(() => resolveAuthoredRequest(forged, request("What is the wait time?"), trustedState())).toThrow(
      /digest verification failed/,
    );
  });

  it("keeps a validated draft ineligible for publication", () => {
    const draft = {
      ...structuredClone(nonAssessedLibraryRoutingCase),
      status: "draft",
      approvedBy: null,
      approvedAt: null,
    };
    expect(CaseVersionSourceSchema.safeParse(draft).success).toBe(true);
    expect(() => publishCase(draft)).toThrow();
  });

  it("requires matching recorded visible and protected hashes before publication", () => {
    expect(() => publishCase(nonAssessedLibraryRoutingCase)).toThrow();
    const forged = structuredClone(receiptFor(nonAssessedLibraryRoutingCase));
    forged.recordedVisibleBundleDigest = `sha256:${"f".repeat(64)}`;
    expect(() => publishCase(forged)).toThrow(/receipt hashes do not match/i);

    const protectedForgery = structuredClone(receiptFor(nonAssessedLibraryRoutingCase));
    protectedForgery.recordedProtectedPackageDigest = `sha256:${"e".repeat(64)}`;
    expect(() => publishCase(protectedForgery)).toThrow(/receipt hashes do not match/i);
  });
});

describe("deterministic authored fact release", () => {
  it("releases the same official fact for requests satisfying the same authored cues", () => {
    const first = resolveAuthoredRequest(
      publishedCase,
      request("What is the wait time right now?"),
      trustedState(),
    );
    const second = resolveAuthoredRequest(
      publishedCase,
      request("How much time do patrons wait?"),
      trustedState(),
    );
    expect(first.status).toBe("matched");
    expect(second.status).toBe("matched");
    expect(first.officialFacts.map(({ id }) => id)).toEqual(["median-wait"]);
    expect(second.officialFacts.map(({ id }) => id)).toEqual(["median-wait"]);
  });

  it("returns a fixed unavailable result for an out-of-universe question", () => {
    expect(
      resolveAuthoredRequest(
        publishedCase,
        request("What color is the delivery van?"),
        trustedState(),
      ),
    ).toEqual({
      status: "unavailable",
      reason: "out-of-universe",
      studentMessage: "That information is not available in this simulation.",
      officialFacts: [],
      releasedEvidenceIds: [],
    });
  });

  it("releases no facts when the selected provider fails", () => {
    const resolution = resolveAuthoredRequest(
      publishedCase,
      request("What is the wait time?"),
      trustedState(),
    );
    expect(factIdsEligibleForRelease(resolution, false)).toEqual([]);
    expect(factIdsEligibleForRelease(resolution, true)).toEqual(["median-wait"]);
  });

  it("rejects equal top-priority authored matches without releasing facts", () => {
    expect(ROUTE_TIE_BREAK_POLICY).toBe("reject-equal-highest-priority");
    const tiedSource = structuredClone(nonAssessedLibraryRoutingCase);
    const tiedRoute = structuredClone(tiedSource.protected.routes[0]!);
    tiedRoute.id = "aaa-tied-route";
    tiedRoute.consequence.id = "aaa-tied-consequence";
    tiedSource.protected.routes.push(tiedRoute);
    const tiedPublished = publishCase(receiptFor(tiedSource));
    const tied = resolveAuthoredRequest(
      tiedPublished,
      request("wait time"),
      trustedState({ caseVersionDigest: tiedPublished.digests.caseVersionDigest }),
    );
    expect(tied).toMatchObject({
      status: "ambiguous",
      officialFacts: [],
      releasedEvidenceIds: [],
    });

    tiedSource.protected.routes[0]!.priority = 11;
    const priorityPublished = publishCase(receiptFor(tiedSource));
    const priorityWinner = resolveAuthoredRequest(
      priorityPublished,
      request("wait time"),
      trustedState({ caseVersionDigest: priorityPublished.digests.caseVersionDigest }),
    );
    expect(priorityWinner.status === "matched" ? priorityWinner.routeId : undefined).toBe(
      "ask-manager-wait",
    );
  });

  it("respects authored complete cue groups and exclusions", () => {
    const groupedSource = structuredClone(nonAssessedLibraryRoutingCase);
    groupedSource.protected.routes[0]!.match = {
      anyPhrases: [],
      allTerms: [],
      anyTermGroups: [["wait", "time"]],
      noneTerms: ["staff-only"],
    };
    const groupedPublished = publishCase(receiptFor(groupedSource));
    const state = trustedState({ caseVersionDigest: groupedPublished.digests.caseVersionDigest });
    expect(
      resolveAuthoredRequest(groupedPublished, request("wait"), state).status,
    ).toBe("unavailable");
    expect(
      resolveAuthoredRequest(groupedPublished, request("wait time"), state).status,
    ).toBe("matched");
    expect(
      resolveAuthoredRequest(groupedPublished, request("wait time staff-only"), state).status,
    ).toBe("unavailable");
  });

  it("fails closed when released state belongs to another attempt", () => {
    expect(() =>
      resolveAuthoredRequest(
        publishedCase,
        request("wait time"),
        trustedState({ attemptNumber: 2 }),
      ),
    ).toThrow(/trusted assignment attempt/);
  });
});

describe("atomic submission acceptance and immutable reads", () => {
  it("accepts a complete no-build response and assigns server-owned acceptance fields", () => {
    const draft = makeCompleteExampleSubmission(digests.caseVersionDigest);
    const result = acceptSubmission(
      activeAttempt(),
      draft,
      { publishedCase, trustedReleasedState: trustedState() },
      acceptanceMetadata(),
    );
    expect(result.accepted).toBe(true);
    expect(draft.responsePlan.mode).toBe("no-build");
    expect(draft.responsePlan.artifactSnapshots).toEqual([]);
    if (result.accepted) {
      expect(result.attempt.status).toBe("submitted");
      expect(result.attempt.submission).toMatchObject({
        acceptedAt: "2026-09-04T16:00:00.000Z",
        eventCutoffSequence: 12,
        cliVersion: "0.1.0",
      });
    }
  });

  it("leaves Attempt 1 active and blind when a submission is incomplete", () => {
    const original = activeAttempt();
    const result = acceptSubmission(
      original,
      { submissionId: "unfinished" },
      { publishedCase, trustedReleasedState: trustedState() },
      acceptanceMetadata(),
    );
    expect(result.accepted).toBe(false);
    expect(result.attempt).toMatchObject({ attemptNumber: 1, status: "active" });
    expect(original.status).toBe("active");
    expect(
      decideAssignmentAccess(
        { githubUserId: "12345", roles: ["student", "staff"] },
        accessContext({ attemptStatus: result.attempt.status }),
        "staff-read-protected-case",
      ),
    ).toEqual({ allowed: false, reason: "attempt-one-blind-override" });
  });

  it("rejects an invalid submission identity without changing attempt state", () => {
    const draft = makeCompleteExampleSubmission(digests.caseVersionDigest);
    draft.assignmentId = "assignment-2";
    const result = acceptSubmission(
      activeAttempt(),
      draft,
      { publishedCase, trustedReleasedState: trustedState() },
      acceptanceMetadata(),
    );
    expect(result.accepted).toBe(false);
    expect(result.attempt).toMatchObject({ attemptNumber: 1, status: "active" });
    expect(result.report.missing.some(({ path }) => path === "assignmentIdentity")).toBe(true);

    const wrongStudent = makeCompleteExampleSubmission(digests.caseVersionDigest);
    wrongStudent.studentGithubUserId = "999";
    const studentResult = acceptSubmission(
      activeAttempt(),
      wrongStudent,
      { publishedCase, trustedReleasedState: trustedState() },
      acceptanceMetadata(),
    );
    expect(studentResult.accepted).toBe(false);
    expect(studentResult.attempt.status).toBe("active");
    expect(studentResult.report.missing.some(({ path }) => path === "studentGithubUserId")).toBe(
      true,
    );
  });

  it("rejects stale or missing provider provenance without changing attempt state", () => {
    const result = acceptSubmission(
      activeAttempt(),
      makeCompleteExampleSubmission(digests.caseVersionDigest),
      { publishedCase, trustedReleasedState: trustedState() },
      acceptanceMetadata({ providerProvenance: [] }),
    );
    expect(result.accepted).toBe(false);
    expect(result.attempt.status).toBe("active");
    expect(result.report.missing.some(({ path }) => path === "providerProvenance")).toBe(true);
  });

  it("accepts captured CSV text only when its bytes and digest are reproducible", () => {
    const draft = makeCompleteExampleSubmission(digests.caseVersionDigest);
    const content = "route,count\nreference,20\n";
    draft.responsePlan.mode = "build";
    draft.responsePlan.artifactSnapshots = [
      {
        path: "evidence/summary.csv",
        digest: textDigest(content),
        mediaType: "text/csv",
        byteLength: Buffer.byteLength(content, "utf8"),
        content,
      },
    ];
    expect(
      checkSubmissionCompleteness(draft, { publishedCase, trustedReleasedState: trustedState() }),
    ).toMatchObject({ complete: true });

    draft.responsePlan.artifactSnapshots[0]!.content += "tampered,1\n";
    const tampered = checkSubmissionCompleteness(draft, {
      publishedCase,
      trustedReleasedState: trustedState(),
    });
    expect(tampered.complete).toBe(false);
    expect(tampered.missing.some(({ path }) => path.endsWith("digest"))).toBe(true);
  });

  it("rejects every artifact on a no-build response", () => {
    const draft = makeCompleteExampleSubmission(digests.caseVersionDigest);
    const content = "not allowed in no-build\n";
    draft.responsePlan.artifactSnapshots = [
      {
        path: "results/answer.txt",
        digest: textDigest(content),
        mediaType: "text/plain",
        byteLength: Buffer.byteLength(content, "utf8"),
        content,
      },
    ];
    const result = acceptSubmission(
      activeAttempt(),
      draft,
      { publishedCase, trustedReleasedState: trustedState() },
      acceptanceMetadata(),
    );
    expect(result.accepted).toBe(false);
    expect(result.report.missing.some(({ path }) => path.includes("artifactSnapshots"))).toBe(true);
    expect(result.attempt.status).toBe("active");
  });

  it("rejects traversal, dot-control, C0/C1 control, and Unicode separator artifact paths", () => {
    for (const path of [
      "../../private-case.json",
      ".git/config",
      "results/.env",
      "results/control\u001f.txt",
      "results/control\u0085.txt",
      "results/line\u2028break.txt",
      "results/paragraph\u2029break.txt",
    ]) {
      const draft = makeCompleteExampleSubmission(digests.caseVersionDigest);
      draft.responsePlan.mode = "build";
      draft.responsePlan.artifactSnapshots = [
        {
          path,
          digest: textDigest("safe"),
          mediaType: "text/plain",
          byteLength: 4,
          content: "safe",
        },
      ];
      const report = checkSubmissionCompleteness(draft, {
        publishedCase,
        trustedReleasedState: trustedState(),
      });
      expect(report.complete).toBe(false);
      expect(report.missing.some(({ path: issuePath }) => issuePath.endsWith("path"))).toBe(true);
    }
  });

  it("rejects not-applicable for a case requirement fixed as applicable", () => {
    const draft = makeCompleteExampleSubmission(digests.caseVersionDigest);
    draft.requirementAssessments[0]!.status = "not-applicable";
    const report = checkSubmissionCompleteness(draft, {
      publishedCase,
      trustedReleasedState: trustedState(),
    });
    expect(report.complete).toBe(false);
    expect(report.missing.some(({ message }) => message.includes("fixed applicable"))).toBe(true);
  });

  it("allows a gated requirement to be not applicable with rationale after collect-more", () => {
    const gatedSource = structuredClone(nonAssessedLibraryRoutingCase);
    gatedSource.visible.requirements.push({
      id: "experiment-result",
      title: "Experiment result",
      prompt: "Report an experiment result only if the evidence warrants running one.",
      applicability: "student-may-mark-not-applicable",
      stage: "outcome",
      gate: "response-selected",
    });
    const gatedCase = publishCase(receiptFor(gatedSource));
    const draft = makeCompleteExampleSubmission(gatedCase.digests.caseVersionDigest);
    draft.requirementAssessments.push({
      requirementId: "experiment-result",
      status: "not-applicable",
      rationale:
        "The defensible decision is to collect the missing accuracy baseline before selecting an experiment.",
      evidenceIds: [],
    });
    const report = checkSubmissionCompleteness(draft, {
      publishedCase: gatedCase,
      trustedReleasedState: trustedState({
        caseVersionDigest: gatedCase.digests.caseVersionDigest,
      }),
    });
    expect(report.complete).toBe(true);
  });

  it("rejects a calculation result that cannot be reproduced", () => {
    const draft = makeCompleteExampleSubmission(digests.caseVersionDigest);
    draft.calculations[0]!.result.value = 999;
    const report = checkSubmissionCompleteness(draft, {
      publishedCase,
      trustedReleasedState: trustedState(),
    });
    expect(report.complete).toBe(false);
    expect(report.missing.some(({ path }) => path === "calculations.0.result.value")).toBe(true);
  });

  it("rejects evidence outside the trusted event and assignment", () => {
    const draft = makeCompleteExampleSubmission(digests.caseVersionDigest);
    draft.evidence[0]!.attemptNumber = 2;
    const report = checkSubmissionCompleteness(draft, {
      publishedCase,
      trustedReleasedState: trustedState(),
    });
    expect(report.complete).toBe(false);
    expect(report.missing.map(({ message }) => message).some((message) => message.includes("trusted release event"))).toBe(
      true,
    );
  });

  it("detects a changed submission on read and reopen", () => {
    const accepted = acceptSubmission(
      activeAttempt(),
      makeCompleteExampleSubmission(digests.caseVersionDigest),
      { publishedCase, trustedReleasedState: trustedState() },
      acceptanceMetadata(),
    );
    expect(accepted.accepted).toBe(true);
    if (!accepted.accepted) return;
    const tamperedRecord = SubmissionRecordSchema.parse(accepted.attempt.submission!);
    tamperedRecord.economicRationale = "Changed after acceptance";
    expect(() => verifySubmissionRecord(tamperedRecord)).toThrow(/digest verification failed/);
    expect(() =>
      readAttempt({ ...structuredClone(accepted.attempt), submission: tamperedRecord }),
    ).toThrow(/digest verification failed/);
    expect(() =>
      reopenAttempt({ ...structuredClone(accepted.attempt), submission: tamperedRecord }, "2026-09-05T13:00:00.000Z"),
    ).toThrow(/digest verification failed/);
  });

  it("rejects embedded identity changes even when the submission digest is recomputed", () => {
    const accepted = acceptSubmission(
      activeAttempt(),
      makeCompleteExampleSubmission(digests.caseVersionDigest),
      { publishedCase, trustedReleasedState: trustedState() },
      acceptanceMetadata(),
    );
    if (!accepted.accepted) throw new Error("Fixture should be accepted");
    const changed = SubmissionRecordSchema.parse(accepted.attempt.submission!);
    changed.assignmentId = "assignment-2";
    const content = Object.fromEntries(
      Object.entries(changed).filter(([key]) => key !== "submissionDigest"),
    );
    changed.submissionDigest = sha256Digest(content);
    expect(() => readAttempt({ ...structuredClone(accepted.attempt), submission: changed })).toThrow(
      /embedded submission identity/,
    );
  });

  it("keeps the accepted attempt immutable and opens a separate next attempt", () => {
    const draft = makeCompleteExampleSubmission(digests.caseVersionDigest);
    const accepted = acceptSubmission(
      activeAttempt(),
      draft,
      { publishedCase, trustedReleasedState: trustedState() },
      acceptanceMetadata(),
    );
    if (!accepted.accepted) throw new Error("Fixture should be accepted");
    expect(() =>
      acceptSubmission(
        accepted.attempt,
        draft,
        { publishedCase, trustedReleasedState: trustedState() },
        acceptanceMetadata(),
      ),
    ).toThrow(/immutable submission/);
    const originalDigest = accepted.attempt.submission!.submissionDigest;
    const reopened = reopenAttempt(accepted.attempt, "2026-09-05T13:00:00.000Z");
    expect(reopened.previous.submission!.submissionDigest).toBe(originalDigest);
    expect(reopened.next).toMatchObject({ attemptNumber: 2, status: "active" });
    expect(Object.isFrozen(reopened.previous.submission)).toBe(true);
  });

  it("reports completeness and provenance without student-facing quality judgment", () => {
    const report = checkSubmissionCompleteness(
      { submissionId: "unfinished" },
      { publishedCase, trustedReleasedState: trustedState() },
    );
    const keys: string[] = [];
    const visit = (value: unknown): void => {
      if (Array.isArray(value)) value.forEach(visit);
      else if (typeof value === "object" && value !== null) {
        for (const [key, nested] of Object.entries(value)) {
          keys.push(key);
          visit(nested);
        }
      }
    };
    visit(report);
    expect(report.complete).toBe(false);
    expect(keys).not.toContain("rating");
    expect(keys).not.toContain("score");
    expect(keys).not.toContain("quality");
    expect(keys).not.toContain("evaluation");
  });
});

describe("case-scoped authorization and blind policy", () => {
  const staffActor = { githubUserId: "12345", roles: ["student", "staff"] as const };

  it("denies protected access during blind Attempt 1 and restores only after submission", () => {
    expect(decideAssignmentAccess(staffActor, accessContext(), "staff-read-protected-case")).toEqual({
      allowed: false,
      reason: "attempt-one-blind-override",
    });
    expect(
      decideAssignmentAccess(
        staffActor,
        accessContext({ attemptStatus: "submitted" }),
        "staff-read-protected-case",
      ),
    ).toEqual({ allowed: true, reason: "case-scoped-authorization" });
  });

  it("fails closed when the blind policy is missing", () => {
    const missingPolicy = { ...accessContext() };
    delete missingPolicy.blindPolicy;
    expect(
      decideAssignmentAccess(
        { githubUserId: "999", roles: ["staff"] },
        missingPolicy,
        "staff-read-protected-case",
      ),
    ).toEqual({ allowed: false, reason: "missing-blind-policy" });
  });

  it("fails closed when the blind policy is stale", () => {
    const current = accessContext();
    expect(
      decideAssignmentAccess(
        { githubUserId: "999", roles: ["staff"] },
        {
          ...current,
          blindPolicy: { ...current.blindPolicy!, policyVersion: 0 },
        },
        "staff-read-protected-case",
      ),
    ).toEqual({ allowed: false, reason: "stale-blind-policy" });
  });

  it("fails closed when a current-version blind policy changes its assigned mode", () => {
    const current = accessContext();
    expect(
      decideAssignmentAccess(
        { githubUserId: "999", roles: ["staff"] },
        {
          ...current,
          blindPolicy: {
            policyId: current.requiredBlindPolicy.policyId,
            policyVersion: current.requiredBlindPolicy.policyVersion,
            assignmentId: current.assignmentId,
            caseId: current.caseId,
            caseVersionDigest: current.caseVersionDigest,
            mode: "none",
          },
        },
        "staff-read-protected-case",
      ),
    ).toEqual({ allowed: false, reason: "stale-blind-policy" });
  });

  it("denies a generic staff role without a matching case authorization", () => {
    const missingAuthorization = { ...accessContext() };
    delete missingAuthorization.staffAuthorization;
    expect(
      decideAssignmentAccess(
        { githubUserId: "999", roles: ["staff"] },
        missingAuthorization,
        "staff-read-protected-case",
      ),
    ).toEqual({ allowed: false, reason: "case-authorization-required" });
  });

  it("denies cross-assignment access without revealing whether the target exists", () => {
    expect(
      decideAssignmentAccess(
        { githubUserId: "12345", roles: ["student"] },
        accessContext({ requestedAssignmentId: "assignment-2" }),
        "student-read",
      ),
    ).toEqual({ allowed: false, reason: "assignment-not-found" });
  });
});

describe("human evaluation boundary", () => {
  it("allows overall effective only when all four human ratings are effective", () => {
    const ratings = {
      "problem-viability": { rating: "effective" as const, rationale: "Supported" },
      "evidence-sufficiency": { rating: "effective" as const, rationale: "Supported" },
      "response-feasibility": { rating: "effective" as const, rationale: "Supported" },
      "objective-success-criteria": { rating: "partially-effective" as const, rationale: "Weak" },
    };
    expect(deriveOverallHumanRating(ratings)).toBe("partially-effective");
    expect(
      deriveOverallHumanRating({
        ...ratings,
        "objective-success-criteria": { rating: "effective", rationale: "Supported" },
      }),
    ).toBe("effective");
  });

  it("rejects a human overall judgment that contradicts its competency judgments", () => {
    const evaluation = HumanEvaluationSchema.parse({
      evaluationId: "evaluation-1",
      submissionId: "submission-1",
      evaluatorGithubUserId: "999",
      evaluatedAt: "2026-09-04T16:00:00.000Z",
      competencies: {
        "problem-viability": { rating: "effective", rationale: "Supported" },
        "evidence-sufficiency": { rating: "effective", rationale: "Supported" },
        "response-feasibility": { rating: "effective", rationale: "Supported" },
        "objective-success-criteria": {
          rating: "not-yet-effective",
          rationale: "No failure threshold",
        },
      },
      overallRating: "effective",
      overallRationale: "Incorrect aggregate for this test",
    });
    expect(() => validateHumanEvaluationConsistency(evaluation)).toThrow(/partially-effective/);
  });
});
