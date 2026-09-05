import fs from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { FileBackedMockStudentService } from "../../student-cli/src/mock-service.ts";
import { createStudentFixture } from "../../student-cli/test/fixture.ts";
import { createLocalFixtureStore } from "../scripts/local-fixture-store.mjs";
import { createLiveStudentStateDashboard } from "../src/live-student-state-adapter.ts";

const roots = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function evaluationDraft() {
  return {
    competencies: {
      "problem-viability": {
        rating: "partially-effective",
        rationale: "The delay is visible, but its cost and relationship to accuracy remain uncertain.",
      },
      "evidence-sufficiency": {
        rating: "effective",
        rationale: "The accepted response separates the measured wait from the missing accuracy evidence.",
      },
      "response-feasibility": {
        rating: "effective",
        rationale: "A bounded observation is proportionate and does not require a real-world change.",
      },
      "objective-success-criteria": {
        rating: "effective",
        rationale: "The accepted response records a baseline, target, date, and explicit stop threshold.",
      },
    },
    overallRationale: "The accepted no-build response is appropriately cautious while viability remains unresolved.",
  };
}

describe("connected local student-state staff journey", () => {
  it("preserves concurrent student work and accepts only one staff response to the exact question", async () => {
    const value = createStudentFixture();
    roots.push(value.root, value.serviceRoot);
    const student = new FileBackedMockStudentService(value.serviceRoot, value.statePath);
    const login = await student.execute({ kind: "login", operationId: "login-concurrent-staff" });
    await student.execute({ kind: "review-request", operationId: "question-concurrent", topic: "Can I continue the observation?", studentChoice: "continue" }, login.token);
    const makeDashboard = () => createLiveStudentStateDashboard({ serviceStateRoot: value.serviceRoot, statePath: value.statePath, operationsStore: createLocalFixtureStore({ filePath: join(value.serviceRoot, "staff.json"), assignmentIds: ["assignment-1"] }), staffGithubUserId: "99101" });
    const pending = await makeDashboard().loadDashboard();
    const reviewRequestId = pending.assignments[0].reviewRequest.reviewRequestId;
    const results = await Promise.allSettled([
      ...[1, 2].map((number) => makeDashboard().recordReviewResponse({ assignmentId: "assignment-1", operationId: `concurrent-response-${number}`, reviewRequestId, responseText: `Guidance ${number}` })),
      ...[1, 2, 3, 4, 5].map((number) => student.execute({ kind: "ledger", operationId: `concurrent-entry-${number}`, entry: { kind: "unknown", statement: `Preserved student question ${number}`, officialFactIds: [] } }, login.token)),
    ]);
    expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(6);
    expect(results.filter(({ status }) => status === "rejected")).toHaveLength(1);
    const snapshot = await makeDashboard().loadDashboard();
    expect(snapshot.operations.history.reviewResponses["assignment-1"]).toHaveLength(1);
    const saved = JSON.parse(fs.readFileSync(join(value.serviceRoot, value.statePath), "utf8"));
    expect(saved.workingDraft.ledger).toHaveLength(5);
    expect(saved.reviewRequests[0].status).toBe("resolved");
  });

  it("answers two separate requests in one attempt and preserves exact request history", async () => {
    const value = createStudentFixture();
    roots.push(value.root, value.serviceRoot);
    const student = new FileBackedMockStudentService(value.serviceRoot, value.statePath);
    const login = await student.execute({ kind: "login", operationId: "login-followup" });
    const store = createLocalFixtureStore({ filePath: join(value.serviceRoot, "staff.json"), assignmentIds: ["assignment-1"] });
    const dashboard = createLiveStudentStateDashboard({ serviceStateRoot: value.serviceRoot, statePath: value.statePath, operationsStore: store, staffGithubUserId: "99101" });
    const replies = [];
    for (const number of [1, 2]) {
      await student.execute({ kind: "review-request", operationId: `question-${number}`, topic: `Question ${number}`, studentChoice: "continue" }, login.token);
      const pending = await dashboard.loadDashboard();
      const request = pending.assignments[0].reviewRequest;
      expect(request).toBeDefined();
      expect(pending.operations.reviewResponses["assignment-1"]?.reviewRequestId).not.toBe(request.reviewRequestId);
      const input = { assignmentId: "assignment-1", operationId: `answer-${number}`, reviewRequestId: request.reviewRequestId, responseText: `Answer ${number}` };
      replies.push(input);
      await dashboard.recordReviewResponse(input);
      await dashboard.recordReviewResponse(input);
    }
    const snapshot = await dashboard.loadDashboard();
    expect(snapshot.operations.history.reviewResponses["assignment-1"].map(({ responseText }) => responseText)).toEqual(["Answer 1", "Answer 2"]);
    expect(snapshot.operations.reviewResponses["assignment-1"].responseText).toBe("Answer 2");
    expect(snapshot.assignments[0].reviewHistory.map(({ topic, response }) => ({ topic, response }))).toEqual([
      { topic: "Question 1", response: "Answer 1" }, { topic: "Question 2", response: "Answer 2" },
    ]);
    const resumed = await student.execute({ kind: "resume" }, login.token);
    expect(resumed.view.reviewUpdates.map(({ response }) => response)).toEqual(["Answer 1", "Answer 2"]);
    await expect(dashboard.recordReviewResponse({ ...replies[0], operationId: "replace-answer" })).rejects.toThrow(/already.*request/i);
    await expect(dashboard.recordReviewResponse({ ...replies[1], operationId: replies[0].operationId })).rejects.toThrow(/reused/i);
    expect((await store.read()).revision).toBe(2);
  });

  it("projects every accepted reasoning section and evidence reference without unreleased case material", async () => {
    const value = createStudentFixture();
    roots.push(value.root, value.serviceRoot);
    const student = new FileBackedMockStudentService(value.serviceRoot, value.statePath);
    const login = await student.execute({ kind: "login", operationId: "login-reasoning" });
    value.draft.economicRationale = "<img src=x onerror=alert(1)> Economic explanation retained as inert text.";
    await student.execute({ kind: "submit", operationId: "submit-reasoning", draft: value.draft, artifacts: [], repository: { repositorySlug: value.state.expectedRepository.slug, commitSha: value.commitSha, sessionIgnoreBlobId: value.sessionIgnoreBlobId, selectedBlobs: [] }, mode: "no-build" }, login.token);
    const store = createLocalFixtureStore({ filePath: join(value.serviceRoot, "staff.json"), assignmentIds: ["assignment-1"] });
    const dashboard = createLiveStudentStateDashboard({ serviceStateRoot: value.serviceRoot, statePath: value.statePath, operationsStore: store, staffGithubUserId: "99101" });
    const snapshot = await dashboard.loadDashboard();
    const { submission } = snapshot.assignments[0];
    for (const key of ["ledger", "evidence", "decision", "estimates", "requirementAssessments", "competencyClaims", "calculations", "economicRationale", "responsePlan"]) {
      expect(submission.reasoning?.[key], `accepted ${key} must reach the evaluator intact`).toEqual(value.draft[key]);
    }
    expect(submission.reasoning.successCriteria).toEqual(value.draft.successCriteria);
    expect(JSON.stringify(snapshot)).not.toContain("PROTECTED-SERVICE-TRUTH-CANARY");
  });

  it("preserves attempt-scoped staff work across repeated review, evaluation, and reopen cycles", async () => {
    const value = createStudentFixture();
    roots.push(value.root, value.serviceRoot);
    let currentTime = "2026-09-04T17:00:00.000Z";
    const now = () => new Date(currentTime);
    const student = new FileBackedMockStudentService(value.serviceRoot, value.statePath, { now });
    const login = await student.execute({ kind: "login", operationId: "login-live-journey" });
    if (login.kind !== "login") throw new Error("student login failed");

    await student.execute(
      {
        kind: "review-request",
        operationId: "review-live-journey",
        topic: "Should I keep the accuracy observation offline?",
        studentChoice: "continue",
      },
      login.token,
    );

    const staffStorePath = join(value.serviceRoot, "staff-operations.json");
    const store = createLocalFixtureStore({
      filePath: staffStorePath,
      assignmentIds: [value.state.assignmentId],
    });
    const makeDashboard = () =>
      createLiveStudentStateDashboard({
        serviceStateRoot: value.serviceRoot,
        statePath: value.statePath,
        operationsStore: store,
        staffGithubUserId: "99101",
        now,
      });

    const beforeResponse = await makeDashboard().loadDashboard();
    expect(beforeResponse.environment).toEqual({
      kind: "connected-local-student-state",
      label: "CONNECTED LOCAL STUDENT STATE",
    });
    expect(beforeResponse.assignments).toHaveLength(1);
    expect(beforeResponse.assignments[0]).toMatchObject({
      assignment: {
        assignmentId: "assignment-1",
        attemptNumber: 1,
        lifecycleState: "review-requested",
      },
      reviewPrompt: "Should I keep the accuracy observation offline?",
      reviewRequest: { status: "open", attemptNumber: 1 },
      replayUnavailableReason: expect.stringMatching(/does not record/i),
    });
    expect(beforeResponse.assignments[0].assignment.timeline).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ eventId: "event-8", officialFactIds: ["median-wait"] }),
      ]),
    );
    expect(beforeResponse.assignments[0].releasedEvidence?.[0]).toMatchObject({
      supportsOfficialFactIds: ["median-wait"],
      content: expect.stringContaining("Frozen public example desk log, rows 1-20"),
    });

    const reviewRequestId = beforeResponse.assignments[0].reviewRequest.reviewRequestId;
    await expect(
      makeDashboard().recordReviewResponse({
        assignmentId: "assignment-1",
        operationId: "staff-review-wrong-request",
        reviewRequestId: "review-some-other-request",
        responseText: "This must not resolve a different pending request.",
      }),
    ).rejects.toThrow(/no longer available/i);
    await expect(student.execute({ kind: "resume" }, login.token)).resolves.toMatchObject({
      kind: "view",
      view: { pendingReview: true },
    });
    const firstReviewResponse = await makeDashboard().recordReviewResponse({
      assignmentId: "assignment-1",
      operationId: "staff-review-live-journey",
      reviewRequestId,
      responseText: "Keep the observation offline and report both speed and accuracy.",
    });
    const idempotentReviewResponse = await makeDashboard().recordReviewResponse({
      assignmentId: "assignment-1",
      operationId: "staff-review-live-journey",
      reviewRequestId,
      responseText: "Keep the observation offline and report both speed and accuracy.",
    });
    expect(idempotentReviewResponse.revision).toBe(firstReviewResponse.revision);
    await expect(
      makeDashboard().recordReviewResponse({
        assignmentId: "assignment-1",
        operationId: "staff-review-conflict-same-attempt",
        reviewRequestId,
        responseText: "A second response must not replace the recorded guidance.",
      }),
    ).rejects.toThrow(/already recorded for this request/i);

    const afterStaffResponse = await student.execute({ kind: "resume" }, login.token);
    expect(afterStaffResponse).toMatchObject({
      kind: "view",
      view: {
        pendingReview: false,
        reviewUpdates: [
          {
            topic: "Should I keep the accuracy observation offline?",
            status: "resolved",
            response: "Keep the observation offline and report both speed and accuracy.",
          },
        ],
      },
    });

    await student.execute(
      {
        kind: "submit",
        operationId: "submit-live-journey",
        draft: value.draft,
        artifacts: [],
        repository: {
          repositorySlug: value.state.expectedRepository.slug,
          commitSha: value.commitSha,
          sessionIgnoreBlobId: value.sessionIgnoreBlobId,
          selectedBlobs: [],
        },
        mode: "no-build",
      },
      login.token,
    );

    const afterSubmission = await makeDashboard().loadDashboard();
    expect(afterSubmission.assignments[0]).toMatchObject({
      assignment: { attemptNumber: 1, lifecycleState: "submitted" },
      acceptedSubmission: {
        submissionId: value.draft.submissionId,
        submissionDigest: expect.stringMatching(/^sha256:/u),
        responseMode: "no-build",
        baselineKind: "measured-baseline",
      },
      submission: {
        responseSummary: value.draft.responsePlan.rationale,
        facts: [{ claim: "The median first response time is 18 minutes." }],
      },
    });

    await makeDashboard().recordEvaluation({
      assignmentId: "assignment-1",
      operationId: "staff-evaluation-live-journey",
      draft: evaluationDraft(),
    });
    const afterReload = await makeDashboard().loadDashboard();
    expect(afterReload.operations.evaluations["assignment-1"]).toMatchObject({
      attemptNumber: 1,
      submissionId: value.draft.submissionId,
      overallRating: "partially-effective",
    });
    const idempotentEvaluation = await makeDashboard().recordEvaluation({
      assignmentId: "assignment-1",
      operationId: "staff-evaluation-live-journey",
      draft: evaluationDraft(),
    });
    expect(idempotentEvaluation.revision).toBe(afterReload.revision);
    await expect(
      makeDashboard().recordEvaluation({
        assignmentId: "assignment-1",
        operationId: "staff-evaluation-live-journey",
        draft: {
          ...evaluationDraft(),
          overallRationale: "This conflicts with the recorded operation input.",
        },
      }),
    ).rejects.toThrow(/cannot be reused across attempts or inputs/i);
    await expect(
      makeDashboard().recordEvaluation({
        assignmentId: "assignment-1",
        operationId: "staff-evaluation-conflict-same-attempt",
        draft: evaluationDraft(),
      }),
    ).rejects.toThrow(/already recorded for this attempt/i);
    await expect(
      makeDashboard().createReplay({
        assignmentId: "assignment-1",
        operationId: "staff-replay-live-journey",
      }),
    ).rejects.toThrow(/provenance/i);

    await makeDashboard().reopenAttempt({
      assignmentId: "assignment-1",
      operationId: "staff-reopen-live-journey",
    });
    const attemptTwoLogin = await student.execute({
      kind: "login",
      operationId: "login-live-journey-attempt-2",
    });
    if (attemptTwoLogin.kind !== "login") throw new Error("Attempt 2 login failed");
    const reopened = await student.execute({ kind: "resume" }, attemptTwoLogin.token);
    expect(reopened).toMatchObject({
      kind: "view",
      view: {
        attemptNumber: 2,
        attemptStatus: "active",
        reopenedFromAttempt: 1,
        attemptHistory: [
          {
            attemptNumber: 1,
            status: "submitted",
            submissionDigest: expect.stringMatching(/^sha256:/u),
          },
        ],
      },
    });
    const staffAfterReopen = await makeDashboard().loadDashboard();
    expect(staffAfterReopen.assignments[0]).toMatchObject({
      assignment: { attemptNumber: 2, lifecycleState: "reopened" },
      attemptHistory: [{ attemptNumber: 1, status: "submitted" }],
    });
    expect(staffAfterReopen.operations.reopens["assignment-1"]).toMatchObject({
      result: { previous: { attemptNumber: 1 }, next: { attemptNumber: 2 } },
    });

    await student.execute(
      {
        kind: "review-request",
        operationId: "review-live-journey-attempt-2",
        topic: "Should Attempt 2 retain the same offline boundary?",
        studentChoice: "continue",
      },
      attemptTwoLogin.token,
    );
    const attemptTwoReview = await makeDashboard().loadDashboard();
    await expect(
      makeDashboard().recordReviewResponse({
        assignmentId: "assignment-1",
        operationId: "staff-review-live-journey",
        reviewRequestId: attemptTwoReview.assignments[0].reviewRequest.reviewRequestId,
        responseText: "This old operation must not resolve Attempt 2.",
      }),
    ).rejects.toThrow(/cannot be reused across attempts or inputs/i);
    await expect(student.execute({ kind: "resume" }, attemptTwoLogin.token)).resolves.toMatchObject({
      kind: "view",
      view: { pendingReview: true },
    });
    await makeDashboard().recordReviewResponse({
      assignmentId: "assignment-1",
      operationId: "staff-review-live-journey-attempt-2",
      reviewRequestId: attemptTwoReview.assignments[0].reviewRequest.reviewRequestId,
      responseText: "Keep the boundary and make the new attempt's evidence explicit.",
    });
    await student.execute(
      {
        kind: "talk",
        operationId: "talk-live-journey-attempt-2",
        personaId: "library-manager",
        question: "What is the wait time for this attempt?",
      },
      attemptTwoLogin.token,
    );
    const attemptTwoDraft = JSON.parse(JSON.stringify(value.draft));
    attemptTwoDraft.submissionId = "submission-attempt-2";
    attemptTwoDraft.attemptNumber = 2;
    attemptTwoDraft.evidence = attemptTwoDraft.evidence.map((evidence) => ({
      ...evidence,
      attemptNumber: 2,
      sourceEventId: "event-1",
    }));
    await student.execute(
      {
        kind: "submit",
        operationId: "submit-live-journey-attempt-2",
        draft: attemptTwoDraft,
        artifacts: [],
        repository: {
          repositorySlug: value.state.expectedRepository.slug,
          commitSha: value.commitSha,
          sessionIgnoreBlobId: value.sessionIgnoreBlobId,
          selectedBlobs: [],
        },
        mode: "no-build",
      },
      attemptTwoLogin.token,
    );
    await expect(
      makeDashboard().recordEvaluation({
        assignmentId: "assignment-1",
        operationId: "staff-evaluation-live-journey",
        draft: evaluationDraft(),
      }),
    ).rejects.toThrow(/cannot be reused across attempts or inputs/i);
    await makeDashboard().recordEvaluation({
      assignmentId: "assignment-1",
      operationId: "staff-evaluation-live-journey-attempt-2",
      draft: evaluationDraft(),
    });
    const afterAttemptTwoEvaluation = await makeDashboard().loadDashboard();
    expect(afterAttemptTwoEvaluation.operations.evaluations["assignment-1"]).toMatchObject({
      attemptNumber: 2,
      submissionId: "submission-attempt-2",
    });
    expect(afterAttemptTwoEvaluation.operations.history.reviewResponses["assignment-1"]).toHaveLength(2);
    expect(afterAttemptTwoEvaluation.operations.history.evaluations["assignment-1"]).toHaveLength(2);
    expect(afterAttemptTwoEvaluation.operations.history.reopens["assignment-1"]).toHaveLength(1);
    expect(afterAttemptTwoEvaluation.assignments[0].attemptHistory[0]).toMatchObject({
      attemptNumber: 1,
      reviewResponse: { operationId: "staff-review-live-journey" },
      evaluation: { operationId: "staff-evaluation-live-journey" },
      reopen: { operationId: "staff-reopen-live-journey" },
    });

    const repeatedAttemptOneReopen = await makeDashboard().reopenAttempt({
      assignmentId: "assignment-1",
      operationId: "staff-reopen-live-journey",
    });
    expect(repeatedAttemptOneReopen.assignments[0].assignment.attemptNumber).toBe(2);
    currentTime = "2026-09-04T18:00:00.000Z";
    await makeDashboard().reopenAttempt({
      assignmentId: "assignment-1",
      operationId: "staff-reopen-live-journey-attempt-2",
    });
    const idempotentAttemptTwoReopen = await makeDashboard().reopenAttempt({
      assignmentId: "assignment-1",
      operationId: "staff-reopen-live-journey-attempt-2",
    });
    expect(idempotentAttemptTwoReopen.assignments[0].assignment.attemptNumber).toBe(3);
    await expect(
      makeDashboard().reopenAttempt({
        assignmentId: "assignment-1",
        operationId: "staff-reopen-live-journey",
      }),
    ).rejects.toThrow(/cannot be reused across attempts/i);
    const attemptThreeLogin = await student.execute({
      kind: "login",
      operationId: "login-live-journey-attempt-3",
    });
    if (attemptThreeLogin.kind !== "login") throw new Error("Attempt 3 login failed");
    await expect(student.execute({ kind: "resume" }, attemptThreeLogin.token)).resolves.toMatchObject({
      kind: "view",
      view: {
        attemptNumber: 3,
        attemptHistory: [
          { attemptNumber: 1, submissionDigest: expect.stringMatching(/^sha256:/u) },
          { attemptNumber: 2, submissionDigest: expect.stringMatching(/^sha256:/u) },
        ],
      },
    });
    const attemptThreeStaff = await makeDashboard().loadDashboard();
    expect(attemptThreeStaff.operations.history.reviewResponses["assignment-1"]).toHaveLength(2);
    expect(attemptThreeStaff.operations.history.evaluations["assignment-1"]).toHaveLength(2);
    expect(attemptThreeStaff.operations.history.reopens["assignment-1"]).toHaveLength(2);
    expect(attemptThreeStaff.operations.reviewResponses).not.toHaveProperty("assignment-1");
    expect(attemptThreeStaff.operations.evaluations).not.toHaveProperty("assignment-1");
    expect(attemptThreeStaff.operations.reopens["assignment-1"]).toMatchObject({
      operationId: "staff-reopen-live-journey-attempt-2",
      result: { previous: { attemptNumber: 2 }, next: { attemptNumber: 3 } },
    });
    expect(attemptThreeStaff.assignments[0].attemptHistory).toEqual([
      expect.objectContaining({
        attemptNumber: 1,
        evaluation: expect.objectContaining({ submissionId: value.draft.submissionId }),
      }),
      expect.objectContaining({
        attemptNumber: 2,
        evaluation: expect.objectContaining({ submissionId: "submission-attempt-2" }),
      }),
    ]);
  });
});
