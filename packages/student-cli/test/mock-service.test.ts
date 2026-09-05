import fs from "node:fs";
import { afterEach, describe, expect, it } from "vitest";

import {
  FileBackedMockStudentService,
  reopenMockAttempt,
  resolveMockReview,
} from "../src/mock-service.js";
import type { MockStudentServiceState, StudentServiceRequest } from "../src/types.js";
import { artifactFor, createStudentFixture, type StudentFixture } from "./fixture.js";

const roots: string[] = [];

function fixture(): StudentFixture {
  const value = createStudentFixture();
  roots.push(value.root, value.serviceRoot);
  return value;
}

async function login(service: FileBackedMockStudentService, operationId = "login-1") {
  const response = await service.execute({ kind: "login", operationId });
  if (response.kind !== "login") throw new Error("login fixture failed");
  return response.token;
}

function interruptCases(value: StudentFixture): readonly [string, StudentServiceRequest][] {
  return [
    ["login", { kind: "login", operationId: "interrupt-login" }],
    [
      "talk",
      {
        kind: "talk",
        operationId: "interrupt-talk",
        personaId: "library-manager",
        question: "What is the wait time?",
      },
    ],
    [
      "evidence",
      {
        kind: "evidence",
        operationId: "interrupt-evidence",
        evidenceSourceId: "desk-log",
        question: "What response time is recorded?",
      },
    ],
    [
      "collect",
      {
        kind: "collect",
        operationId: "interrupt-collect",
        methodId: "sample-audit",
        plan: "Review the bounded sample.",
      },
    ],
    [
      "advance",
      { kind: "advance", operationId: "interrupt-advance", days: 1, reason: "Wait." },
    ],
    [
      "ledger",
      {
        kind: "ledger",
        operationId: "interrupt-ledger",
        entry: {
          kind: "fact",
          statement: "The median response time is 18 minutes.",
          officialFactIds: ["median-wait"],
        },
      },
    ],
    [
      "decision",
      {
        kind: "decision",
        operationId: "interrupt-decision",
        decision: {
          choice: "continue",
          rationale: "Continue measuring.",
          supportingEvidenceIds: [],
          expectedEvidence: [
            {
              description: "Accuracy observations",
              sourceOrMethod: "Bounded sample",
              decisionUse: "Decide whether to continue",
            },
          ],
          pivotOrStopConditions: [
            { action: "stop", condition: "Accuracy declines", rationale: "Protect answer quality" },
          ],
        },
      },
    ],
    [
      "estimate",
      {
        kind: "estimate",
        operationId: "interrupt-estimate",
        estimate: {
          subject: "Observation time",
          low: 2,
          high: 4,
          unit: "hours",
          assumptions: ["The log is available"],
          confidence: 0.6,
        },
      },
    ],
    [
      "requirement",
      {
        kind: "requirement",
        operationId: "interrupt-requirement",
        requirementId: "patron-wait",
        status: "addressed",
        rationale: "The released baseline addresses it.",
        evidenceIds: [],
      },
    ],
    [
      "claim",
      {
        kind: "claim",
        operationId: "interrupt-claim",
        competencyId: "problem-viability",
        rationale: "The delay is established but its cost is unknown.",
        evidenceIds: [],
      },
    ],
    [
      "draft",
      {
        kind: "draft",
        operationId: "interrupt-draft",
        mode: "no-build",
        rationale: "Measure first.",
        feasibility: "The observation is bounded.",
        risks: ["The sample is small."],
        missingDataPlan: "Measure accuracy.",
        economicRationale: "Limit staff time.",
      },
    ],
    [
      "criterion",
      {
        kind: "criterion",
        operationId: "interrupt-criterion",
        criterion: {
          metric: "Wait time",
          baselinePlan: "Measure the next sample.",
          target: "At most 12 minutes",
          targetDate: "2026-09-18T14:00:00.000Z",
          failureThreshold: "Stop above 18 minutes",
        },
      },
    ],
    [
      "calculation",
      {
        kind: "calculation",
        operationId: "interrupt-calculation",
        calculation: {
          name: "Records",
          inputs: [{ name: "records", value: 20, unit: "records", source: "desk-log" }],
          formula: { operation: "sum", inputNames: ["records"] },
          result: { value: 20, unit: "records" },
          rationale: "Expose the sample size.",
        },
      },
    ],
    [
      "review request",
      {
        kind: "review-request",
        operationId: "interrupt-review",
        topic: "Review the bounded observation.",
        studentChoice: "continue",
      },
    ],
    [
      "submit",
      {
        kind: "submit",
        operationId: "interrupt-submit",
        draft: value.draft,
        artifacts: [],
        repository: {
          repositorySlug: "Volta-Labs-Inc/assignment-1",
          commitSha: value.commitSha,
          sessionIgnoreBlobId: value.sessionIgnoreBlobId,
          selectedBlobs: [],
        },
        mode: "no-build",
      },
    ],
    ["logout", { kind: "logout", operationId: "interrupt-logout" }],
  ];
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("deterministic local student service", () => {
  it("replays every mutating command after a committed response is interrupted", async () => {
    const seed = fixture();
    for (const [label] of interruptCases(seed)) {
      const current = createStudentFixture();
      roots.push(current.root, current.serviceRoot);
      const matchingRequest = interruptCases(current).find(([name]) => name === label)?.[1];
      if (matchingRequest === undefined || !("operationId" in matchingRequest)) throw new Error(label);
      const service = new FileBackedMockStudentService(current.serviceRoot, current.statePath, {
        now: () => new Date("2026-09-04T16:00:00.000Z"),
        interruptAfterCommit: new Set([matchingRequest.operationId]),
      });
      const token =
        matchingRequest.kind === "login"
          ? undefined
          : await login(service, `auth-${label.replaceAll(" ", "-")}`);
      await expect(service.execute(matchingRequest, token)).rejects.toThrow(/interrupted/i);
      const retried = await service.execute(matchingRequest, token);
      if (retried.kind !== "login") expect(retried).toMatchObject({ replayed: true });
      const saved = JSON.parse(
        fs.readFileSync(`${current.serviceRoot}/${current.statePath}`, "utf8"),
      ) as MockStudentServiceState;
      if (matchingRequest.kind === "login") {
        expect(Object.keys(saved.loginOperations)).toContain(matchingRequest.operationId);
      } else {
        expect(Object.keys(saved.operations).filter((id) => id === matchingRequest.operationId)).toHaveLength(1);
      }
    }
  });

  it("shows only student-visible status without a quality judgment or protected anchor", async () => {
    const value = fixture();
    const service = new FileBackedMockStudentService(value.serviceRoot, value.statePath, {
      now: () => new Date("2026-09-04T15:00:00.000Z"),
    });
    const token = await login(service);
    const response = await service.execute({ kind: "status" }, token);
    expect(response.kind).toBe("view");
    const serialized = JSON.stringify(response).toLowerCase();
    expect(serialized).not.toMatch(/rating|score|quality|calibrationanchor|expected answer/);
    expect(serialized).not.toContain("warrantingconditions");
    expect(serialized).not.toContain("disqualifyingconditions");
  });

  it("persists one official result when the response is interrupted and rejects operation reuse", async () => {
    const value = fixture();
    const service = new FileBackedMockStudentService(value.serviceRoot, value.statePath, {
      now: () => new Date("2026-09-04T15:00:00.000Z"),
      interruptAfterCommit: new Set(["talk-1"]),
    });
    const token = await login(service);
    const request = {
      kind: "talk" as const,
      operationId: "talk-1",
      personaId: "library-manager",
      question: "What is the wait time?",
    };
    await expect(service.execute(request, token)).rejects.toThrow(/interrupted/i);
    const retry = await service.execute(request, token);
    expect(retry).toMatchObject({ kind: "action", replayed: true });
    const saved = JSON.parse(
      fs.readFileSync(`${value.serviceRoot}/${value.statePath}`, "utf8"),
    ) as MockStudentServiceState;
    expect(saved.events.filter(({ eventId }) => eventId === "event-9")).toHaveLength(1);
    await expect(
      service.execute({ ...request, question: "Use the same ID differently" }, token),
    ).rejects.toThrow(/already used/i);
  });

  it("requires the student's own rationale for not applicable", async () => {
    const value = fixture();
    const service = new FileBackedMockStudentService(value.serviceRoot, value.statePath, {
      now: () => new Date("2026-09-04T15:00:00.000Z"),
    });
    const token = await login(service);
    await expect(
      service.execute(
        {
          kind: "requirement",
          operationId: "requirement-1",
          requirementId: "patron-wait",
          status: "not-applicable",
          rationale: "  ",
          evidenceIds: [],
        },
        token,
      ),
    ).rejects.toThrow(/own rationale/i);
    await expect(
      service.execute(
        {
          kind: "requirement",
          operationId: "requirement-2",
          requirementId: "patron-wait",
          status: "not-applicable",
          rationale: "I believe the requirement does not apply because this is only a timing study.",
          evidenceIds: [],
        },
        token,
      ),
    ).resolves.toMatchObject({ kind: "action" });
  });

  it("reports every malformed packet and wrong-assignment provenance without submitting Attempt 1", async () => {
    const value = fixture();
    const service = new FileBackedMockStudentService(value.serviceRoot, value.statePath, {
      now: () => new Date("2026-09-04T16:00:00.000Z"),
    });
    const token = await login(service);
    const requiredFields = [
      "submissionId",
      "assignmentId",
      "studentGithubUserId",
      "attemptNumber",
      "caseVersionDigest",
      "gitCommitSha",
      "ledger",
      "evidence",
      "decision",
      "estimates",
      "missingDataPlan",
      "requirementAssessments",
      "competencyClaims",
      "successCriteria",
      "calculations",
      "economicRationale",
      "responsePlan",
    ] as const;
    for (const field of requiredFields) {
      const malformed = structuredClone(value.draft) as unknown as Record<string, unknown>;
      delete malformed[field];
      const response = await service.execute(
        {
          kind: "submit",
          operationId: `missing-${field}`,
          draft: malformed,
          artifacts: [],
          repository: {
            repositorySlug: "Volta-Labs-Inc/assignment-1",
            commitSha: value.commitSha,
            sessionIgnoreBlobId: value.sessionIgnoreBlobId,
            selectedBlobs: [],
          },
          mode: "no-build",
        } as unknown as StudentServiceRequest,
        token,
      );
      expect(response).toMatchObject({ kind: "submission", accepted: false, attemptNumber: 1 });
    }

    const wrongAssignment = structuredClone(value.draft);
    wrongAssignment.assignmentId = "assignment-2";
    const wrongResponse = await service.execute(
      {
        kind: "submit",
        operationId: "wrong-assignment",
        draft: wrongAssignment,
        artifacts: [],
        repository: {
          repositorySlug: "Volta-Labs-Inc/assignment-1",
          commitSha: value.commitSha,
          sessionIgnoreBlobId: value.sessionIgnoreBlobId,
          selectedBlobs: [],
        },
        mode: "no-build",
      },
      token,
    );
    expect(wrongResponse).toMatchObject({ kind: "submission", accepted: false, attemptNumber: 1 });

    const staleEvidence = structuredClone(value.draft);
    staleEvidence.evidence[0]!.attemptNumber = 2;
    const staleResponse = await service.execute(
      {
        kind: "submit",
        operationId: "stale-evidence",
        draft: staleEvidence,
        artifacts: [],
        repository: {
          repositorySlug: "Volta-Labs-Inc/assignment-1",
          commitSha: value.commitSha,
          sessionIgnoreBlobId: value.sessionIgnoreBlobId,
          selectedBlobs: [],
        },
        mode: "no-build",
      },
      token,
    );
    expect(staleResponse).toMatchObject({ kind: "submission", accepted: false, attemptNumber: 1 });
    await expect(service.execute({ kind: "status" }, token)).resolves.toMatchObject({
      kind: "view",
      view: { attemptStatus: "active", attemptNumber: 1 },
    });
  });

  it("expires, revokes, reuses, and replaces assignment tokens without losing state", async () => {
    const value = fixture();
    let now = new Date("2026-09-04T15:00:00.000Z");
    const service = new FileBackedMockStudentService(value.serviceRoot, value.statePath, {
      now: () => now,
    });
    const first = await login(service);
    const replayedLogin = await login(service);
    expect(replayedLogin).toBe(first);
    const second = await login(service, "login-2");
    expect(second).not.toBe(first);
    await expect(service.execute({ kind: "status" }, first)).rejects.toThrow(/sign in again/i);
    await service.execute({ kind: "logout", operationId: "logout-1" }, second);
    await expect(service.execute({ kind: "status" }, second)).rejects.toThrow(/sign in again/i);
    const third = await login(service, "login-3");
    now = new Date("2026-09-04T15:16:00.000Z");
    await expect(service.execute({ kind: "status" }, third)).rejects.toThrow(/sign in again/i);
    expect(fs.readFileSync(`${value.serviceRoot}/${value.statePath}`, "utf8")).not.toContain(third);
  });

  it("does not create a pending review when declined and exposes only a resolved staff response", async () => {
    const value = fixture();
    const service = new FileBackedMockStudentService(value.serviceRoot, value.statePath, {
      now: () => new Date("2026-09-04T16:00:00.000Z"),
    });
    const token = await login(service);
    await service.execute(
      {
        kind: "review-request",
        operationId: "review-decline",
        topic: "Declined topic",
        studentChoice: "decline",
      },
      token,
    );
    await expect(service.execute({ kind: "status" }, token)).resolves.toMatchObject({
      kind: "view",
      view: { pendingReview: false, reviewUpdates: [] },
    });

    await service.execute(
      {
        kind: "review-request",
        operationId: "review-requested",
        topic: "Review my bounded pilot",
        studentChoice: "continue",
      },
      token,
    );
    await expect(service.execute({ kind: "status" }, token)).resolves.toMatchObject({
      kind: "view",
      view: {
        pendingReview: true,
        reviewUpdates: [{ topic: "Review my bounded pilot", status: "pending" }],
      },
    });
    await resolveMockReview(
      value.serviceRoot,
      value.statePath,
      "Review my bounded pilot",
      "Proceed only with the bounded fictional sample.",
      "2026-09-04T17:00:00.000Z",
    );
    const resolved = await service.execute({ kind: "status" }, token);
    expect(resolved).toMatchObject({
      kind: "view",
      view: {
        pendingReview: false,
        reviewUpdates: [
          {
            topic: "Review my bounded pilot",
            status: "resolved",
            response: "Proceed only with the bounded fictional sample.",
            resolvedAt: "2026-09-04T17:00:00.000Z",
          },
        ],
      },
    });
    expect(JSON.stringify(resolved)).not.toContain("PROTECTED-SERVICE-TRUTH-CANARY");
  });

  it("accepts a complete no-build packet and resumes a reopened attempt", async () => {
    const value = fixture();
    const service = new FileBackedMockStudentService(value.serviceRoot, value.statePath, {
      now: () => new Date("2026-09-04T16:00:00.000Z"),
    });
    const token = await login(service);
    const response = await service.execute(
      {
        kind: "submit",
        operationId: "submit-no-build",
        draft: value.draft,
        artifacts: [],
        repository: {
          repositorySlug: "Volta-Labs-Inc/assignment-1",
          commitSha: value.commitSha,
          sessionIgnoreBlobId: value.sessionIgnoreBlobId,
          selectedBlobs: [],
        },
        mode: "no-build",
      },
      token,
    );
    expect(response).toMatchObject({ kind: "submission", accepted: true, attemptNumber: 1 });
    const submittedState = JSON.parse(
      fs.readFileSync(`${value.serviceRoot}/${value.statePath}`, "utf8"),
    ) as MockStudentServiceState;
    await reopenMockAttempt(value.serviceRoot, value.statePath, "2026-09-05T13:00:00.000Z");
    const reopenedState = JSON.parse(
      fs.readFileSync(`${value.serviceRoot}/${value.statePath}`, "utf8"),
    ) as MockStudentServiceState;
    expect(reopenedState.attemptHistory).toHaveLength(1);
    expect(reopenedState.attemptHistory[0]?.attempt).toEqual(submittedState.attempt);
    expect(reopenedState.attemptHistory[0]?.events).toEqual(submittedState.events);
    expect(reopenedState.attemptHistory[0]?.providerProvenance).toEqual(
      submittedState.providerProvenance,
    );
    expect(reopenedState.attemptHistory[0]?.operations["submit-no-build"]).toEqual(
      submittedState.operations["submit-no-build"],
    );
    expect(reopenedState.operations).toEqual({});
    const reopened = new FileBackedMockStudentService(value.serviceRoot, value.statePath, {
      now: () => new Date("2026-09-05T13:00:00.000Z"),
    });
    const nextToken = await login(reopened, "login-reopened");
    await expect(reopened.execute({ kind: "resume" }, nextToken)).resolves.toMatchObject({
      kind: "view",
      view: {
        attemptNumber: 2,
        reopenedFromAttempt: 1,
        attemptStatus: "active",
        attemptHistory: [
          {
            attemptNumber: 1,
            status: "submitted",
            eventCount: 1,
            citedOfficialFactIds: ["median-wait"],
          },
        ],
      },
    });
    const preservedHistory = structuredClone(reopenedState.attemptHistory[0]);
    await reopened.execute(
      {
        kind: "talk",
        operationId: "attempt-2-talk",
        personaId: "library-manager",
        question: "What should I verify on the new attempt?",
      },
      nextToken,
    );
    const changedAttempt2 = JSON.parse(
      fs.readFileSync(`${value.serviceRoot}/${value.statePath}`, "utf8"),
    ) as MockStudentServiceState;
    expect(changedAttempt2.attemptHistory[0]).toEqual(preservedHistory);
  });

  it("accepts selected build bytes only when the repository proof and pinned blob agree", async () => {
    const value = fixture();
    const service = new FileBackedMockStudentService(value.serviceRoot, value.statePath, {
      now: () => new Date("2026-09-04T16:00:00.000Z"),
    });
    const token = await login(service);
    const artifact = artifactFor("# Proposed observation\n");
    const buildDraft = structuredClone(value.draft);
    buildDraft.responsePlan.mode = "build";
    buildDraft.responsePlan.artifactSnapshots = [artifact];
    const request = {
      kind: "submit" as const,
      operationId: "submit-build",
      draft: buildDraft,
      artifacts: [artifact],
      repository: {
        repositorySlug: "Volta-Labs-Inc/assignment-1",
        commitSha: value.commitSha,
        sessionIgnoreBlobId: value.sessionIgnoreBlobId,
        selectedBlobs: [{ path: "results/answer.md", objectId: value.blobId }],
      },
      mode: "build" as const,
    };
    await expect(
      service.execute(
        {
          ...request,
          repository: {
            ...request.repository,
            selectedBlobs: [{ path: "results/answer.md", objectId: "b".repeat(40) }],
          },
        },
        token,
      ),
    ).rejects.toThrow(/repository commit/i);
    const stillActive = await service.execute({ kind: "status" }, token);
    expect(stillActive).toMatchObject({ kind: "view", view: { attemptStatus: "active" } });
    await expect(service.execute(request, token)).resolves.toMatchObject({
      kind: "submission",
      accepted: true,
    });
  });
});
