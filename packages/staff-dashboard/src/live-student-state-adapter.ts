import {
  mockReviewRequestId,
  readMockStudentServiceState,
  reopenMockAttempt,
  resolveMockReviewRequest,
  withMockStudentStateLock,
  type MockStudentServiceState,
} from "@volta-sim/student-cli";
import { verifySubmissionRecord } from "@volta-sim/core";

import type {
  StaffAssignmentBundle,
  StaffDashboardAdapter,
  StaffDashboardSnapshot,
  StaffOfficialTimelineEvent,
  StaffSubmissionPacket,
} from "./adapter.js";
import {
  acceptedSubmissionProjectionDigest,
  createHumanEvaluation,
  createReviewResponse,
  reopenEvaluatedAttempt,
  type AcceptedSubmissionProjection,
  type BaselineKind,
  type EvaluationDraft,
  type ResponseMode,
  type ReviewResponseRecord,
  type StaffEvaluationRecord,
} from "./domain.js";

interface StoredReplayRecord {
  readonly operationId: string;
  readonly comparison: unknown;
}

interface StoredReopenRecord {
  readonly operationId: string;
  readonly result: ReturnType<typeof reopenEvaluatedAttempt>;
}

export interface StaffOperationsState {
  readonly revision: number;
  readonly reviewResponses: Readonly<Record<string, ReviewResponseRecord>>;
  readonly evaluations: Readonly<Record<string, StaffEvaluationRecord>>;
  readonly replays: Readonly<Record<string, StoredReplayRecord>>;
  readonly reopens: Readonly<Record<string, StoredReopenRecord>>;
  readonly operationHistory: {
    readonly reviewResponses: Readonly<Record<string, readonly ReviewResponseRecord[]>>;
    readonly evaluations: Readonly<Record<string, readonly StaffEvaluationRecord[]>>;
    readonly reopens: Readonly<Record<string, readonly StoredReopenRecord[]>>;
  };
}

export interface StaffOperationsStore {
  read(): Promise<StaffOperationsState>;
  recordReviewResponse(
    assignmentId: string,
    record: ReviewResponseRecord,
  ): Promise<unknown>;
  recordEvaluation(
    assignmentId: string,
    record: StaffEvaluationRecord,
  ): Promise<unknown>;
  recordReplay(assignmentId: string, record: StoredReplayRecord): Promise<unknown>;
  recordReopen(assignmentId: string, record: StoredReopenRecord): Promise<unknown>;
}

export interface LiveStudentStateDashboardOptions {
  readonly serviceStateRoot: string;
  readonly statePath: string;
  readonly operationsStore: StaffOperationsStore;
  readonly staffGithubUserId: string;
  readonly now?: () => Date;
}

type VerifiedSubmission = ReturnType<typeof verifySubmissionRecord>;

function sha256(value: string): `sha256:${string}` {
  if (!/^sha256:[a-f0-9]{64}$/u.test(value)) {
    throw new Error("The connected student state contains an invalid SHA-256 digest");
  }
  return value as `sha256:${string}`;
}

function baselineFor(submission: VerifiedSubmission): {
  readonly kind: BaselineKind;
  readonly detail: string;
} {
  const hasPlan = submission.successCriteria.some(({ baselinePlan }) => baselinePlan !== undefined);
  const kind: BaselineKind = hasPlan ? "credible-baseline-plan" : "measured-baseline";
  const detail = submission.successCriteria
    .map((criterion) =>
      `${criterion.metric}: ${criterion.baseline ?? criterion.baselinePlan ?? "No baseline recorded"}`,
    )
    .join("\n");
  return { kind, detail };
}

function acceptedProjection(submission: VerifiedSubmission): AcceptedSubmissionProjection {
  const baseline = baselineFor(submission);
  const projection = {
    assignmentId: submission.assignmentId,
    attemptNumber: submission.attemptNumber,
    caseVersionDigest: sha256(submission.caseVersionDigest),
    submissionId: submission.submissionId,
    submissionDigest: sha256(submission.submissionDigest),
    responseMode: submission.responsePlan.mode as ResponseMode,
    responseSummary: submission.responsePlan.rationale,
    baselineKind: baseline.kind,
    baselineDetail: baseline.detail,
    source: "accepted-submission-readback" as const,
  };
  return {
    ...projection,
    projectionDigest: acceptedSubmissionProjectionDigest(projection),
  };
}

function submissionPacket(submission: VerifiedSubmission): StaffSubmissionPacket {
  const baseline = baselineFor(submission);
  const ledger = (kind: "fact" | "assumption" | "contradiction" | "unknown") =>
    submission.ledger.filter((entry) => entry.kind === kind);
  return {
    submissionId: submission.submissionId,
    submissionDigest: sha256(submission.submissionDigest),
    responseMode: submission.responsePlan.mode as ResponseMode,
    responseSummary: submission.responsePlan.rationale,
    baselineKind: baseline.kind,
    baselineDetail: baseline.detail,
    facts: ledger("fact").map((entry) => ({ id: entry.id, claim: entry.statement })),
    assumptions: ledger("assumption").map(({ statement }) => statement),
    contradictions: ledger("contradiction").map(({ statement }) => statement),
    unknowns: ledger("unknown").map(({ statement }) => statement),
    missingDataPlan: submission.missingDataPlan,
    successCriteria: submission.successCriteria.map(
      (criterion) =>
        `${criterion.metric} — ${criterion.target} by ${criterion.targetDate}; stop or pivot at ${criterion.failureThreshold}`,
    ),
    reasoning: {
      ledger: submission.ledger,
      evidence: submission.evidence,
      decision: submission.decision,
      estimates: submission.estimates,
      requirementAssessments: submission.requirementAssessments,
      competencyClaims: submission.competencyClaims,
      successCriteria: submission.successCriteria,
      calculations: submission.calculations,
      economicRationale: submission.economicRationale,
      responsePlan: submission.responsePlan,
    },
  };
}

function eventTitle(eventType: string): string {
  const titles: Readonly<Record<string, string>> = {
    talk: "Persona response recorded",
    evidence: "Evidence response recorded",
    collect: "Collection action recorded",
    advance: "Simulation time advanced",
  };
  return titles[eventType] ?? "Official action recorded";
}

function timelineFor(state: MockStudentServiceState): StaffOfficialTimelineEvent[] {
  return state.events.map((event) => ({
    assignmentId: state.assignmentId,
    attemptNumber: state.attempt.attemptNumber,
    caseVersionDigest: state.attempt.caseVersionDigest,
    sequence: event.sequence,
    eventId: event.eventId,
    kind: "action",
    occurredAt: event.simulatedAt,
    actorLabel: "Student service",
    title: eventTitle(event.eventType),
    detail: event.message,
    officialFactIds: [...event.officialFactIds],
    releasedEvidenceIds: [],
    source: "file-backed-mock-student-service",
  }));
}

function releasedEvidenceFor(state: MockStudentServiceState) {
  const releasedFactIds = new Set(state.events.flatMap(({ officialFactIds }) => officialFactIds));
  const factById = new Map(
    state.submissionContext.publishedCase.source.protected.facts.map((fact) => [fact.id, fact]),
  );
  return [...releasedFactIds].flatMap((factId) => {
    const fact = factById.get(factId);
    if (fact === undefined) return [];
    const event = state.events.find(({ officialFactIds }) => officialFactIds.includes(factId));
    return [
      {
        evidenceId: `released-${factId}`,
        title: `Released official fact: ${factId}`,
        detail: "The exact released claim and provenance recorded by the student service.",
        source: "FILE-BACKED MOCK STUDENT SERVICE" as const,
        contentType: "text/markdown" as const,
        relativePath: `official-facts/${factId}.md`,
        supportsOfficialFactIds: [factId],
        content: [
          `Official fact ID: ${factId}`,
          `Claim: ${fact.claim}`,
          `Provenance: ${fact.provenance}`,
          `Released by event: ${event?.eventId ?? "unknown"}`,
        ].join("\n"),
      },
    ];
  });
}

function currentReview(state: MockStudentServiceState) {
  const index = state.reviewRequests.findIndex(({ status }) => status === "pending");
  if (index < 0) return undefined;
  const review = state.reviewRequests[index]!;
  return {
    request: {
      reviewRequestId: mockReviewRequestId(state, index),
      assignmentId: state.assignmentId,
      attemptNumber: state.attempt.attemptNumber,
      status: "open" as const,
      studentSandboxAvailable: true,
    },
    prompt: review.topic,
  };
}

function lifecycleFor(state: MockStudentServiceState) {
  if (state.attempt.status === "submitted") return "submitted" as const;
  if (state.reviewRequests.some(({ status }) => status === "pending")) {
    return "review-requested" as const;
  }
  if (state.reopenedFromAttempt !== undefined) return "reopened" as const;
  return "active" as const;
}

function reviewHistoryFor(state: MockStudentServiceState) {
  return state.reviewRequests.map((review, index) => ({
    reviewRequestId: mockReviewRequestId(state, index),
    topic: review.topic,
    studentChoice: review.studentChoice,
    createdAt: review.createdAt,
    status: review.status,
    ...(review.response === undefined ? {} : { response: review.response }),
    ...(review.resolvedAt === undefined ? {} : { resolvedAt: review.resolvedAt }),
  }));
}

function bundleFor(
  state: MockStudentServiceState,
  operations: StaffOperationsState,
): StaffAssignmentBundle {
  const visible = state.submissionContext.publishedCase.source.visible;
  const review = currentReview(state);
  const submission =
    state.attempt.status === "submitted" && state.attempt.submission !== undefined
      ? verifySubmissionRecord(state.attempt.submission)
      : undefined;
  return {
    assignment: {
      assignmentId: state.assignmentId,
      caseId: visible.caseId,
      caseTitle: visible.title,
      studentLabel: `GitHub user ${state.studentGithubUserId}`,
      caseVersionDigest: state.attempt.caseVersionDigest,
      attemptNumber: state.attempt.attemptNumber,
      lifecycleState: lifecycleFor(state),
      repositoryReadback: "ready",
      stateAuthority: "file-backed-mock-student-service",
      timeline: timelineFor(state),
    },
    ...(review === undefined
      ? {}
      : { reviewRequest: review.request, reviewPrompt: review.prompt }),
    ...(submission === undefined
      ? {}
      : {
          submission: submissionPacket(submission),
          acceptedSubmission: acceptedProjection(submission),
        }),
    releasedEvidence: releasedEvidenceFor(state),
    reviewHistory: reviewHistoryFor(state),
    replayUnavailableReason:
      "Replay is unavailable because the file-backed student state does not record independently receipt-backed replay text and provenance.",
    attemptHistory: state.attemptHistory.flatMap(({ attempt, events, reviewRequests }) => {
      if (attempt.status !== "submitted" || attempt.submission === undefined) return [];
      const historicalSubmission = verifySubmissionRecord(attempt.submission);
      const reviewResponses = operations.operationHistory.reviewResponses[state.assignmentId]?.filter(
        ({ attemptNumber }) => attemptNumber === attempt.attemptNumber,
      ) ?? [];
      const reviewResponse = reviewResponses.at(-1);
      const evaluation = operations.operationHistory.evaluations[state.assignmentId]?.find(
        ({ attemptNumber }) => attemptNumber === attempt.attemptNumber,
      );
      const reopen = operations.operationHistory.reopens[state.assignmentId]?.find(
        ({ result }) => result.previous.attemptNumber === attempt.attemptNumber,
      );
      return [
        {
          attemptNumber: attempt.attemptNumber,
          status: "submitted" as const,
          submissionId: historicalSubmission.submissionId,
          submissionDigest: historicalSubmission.submissionDigest,
          eventCount: events.length,
          submission: submissionPacket(historicalSubmission),
          reviewResponses,
          reviewHistory: reviewHistoryFor({ ...state, attempt, reviewRequests: [...reviewRequests] }),
          ...(reviewResponse === undefined ? {} : { reviewResponse }),
          ...(evaluation === undefined ? {} : { evaluation }),
          ...(reopen === undefined ? {} : { reopen }),
        },
      ];
    }),
  };
}

function snapshotRevision(state: MockStudentServiceState, operationRevision: number): number {
  return (
    state.attempt.attemptNumber * 1_000_000_000 +
    state.events.length * 1_000_000 +
    state.reviewRequests.length * 1_000 +
    (state.attempt.status === "submitted" ? 100 : 0) +
    operationRevision
  );
}

export function createLiveStudentStateDashboard(
  options: LiveStudentStateDashboardOptions,
): StaffDashboardAdapter {
  const now = options.now ?? (() => new Date());

  async function stateAndOperations() {
    const [state, operations] = await Promise.all([
      readMockStudentServiceState(options.serviceStateRoot, options.statePath),
      options.operationsStore.read(),
    ]);
    return { state, operations };
  }

  async function loadDashboard(): Promise<StaffDashboardSnapshot> {
    return withMockStudentStateLock(options.serviceStateRoot, options.statePath, async () => {
    const { state, operations } = await stateAndOperations();
    const visible = state.submissionContext.publishedCase.source.visible;
    const reviewResponse = operations.operationHistory.reviewResponses[state.assignmentId]?.filter(
      ({ attemptNumber }) => attemptNumber === state.attempt.attemptNumber,
    ).at(-1);
    const evaluation = operations.operationHistory.evaluations[state.assignmentId]?.find(
      ({ attemptNumber }) => attemptNumber === state.attempt.attemptNumber,
    );
    const reopen = operations.operationHistory.reopens[state.assignmentId]?.find(
      ({ result }) => result.next.attemptNumber === state.attempt.attemptNumber,
    );
    return {
      adapterVersion: "staff-dashboard-v1",
      environment: {
        kind: "connected-local-student-state",
        label: "CONNECTED LOCAL STUDENT STATE",
      },
      revision: snapshotRevision(state, operations.revision),
      cases: [
        {
          caseId: visible.caseId,
          title: visible.title,
          state: "published",
          version: visible.versionLabel,
          detail: visible.brief,
          source: "FILE-BACKED MOCK STUDENT SERVICE",
        },
      ],
      assignments: [bundleFor(state, operations)],
      operations: {
        reviewResponses:
          reviewResponse === undefined ? {} : { [state.assignmentId]: reviewResponse },
        evaluations: evaluation === undefined ? {} : { [state.assignmentId]: evaluation },
        replays: {},
        reopens: reopen === undefined ? {} : { [state.assignmentId]: reopen },
        history: operations.operationHistory,
      },
    };
    });
  }

  return {
    loadDashboard,
    async recordReviewResponse(input) {
      return withMockStudentStateLock(options.serviceStateRoot, options.statePath, async () => {
      const { state, operations } = await stateAndOperations();
      if (state.assignmentId !== input.assignmentId) {
        throw new Error("This staff operation is not available for the selected assignment");
      }
      const history = operations.operationHistory.reviewResponses[input.assignmentId] ?? [];
      const reusedOperation = history.find(({ operationId }) => operationId === input.operationId);
      if (reusedOperation !== undefined) {
        if (
          reusedOperation.attemptNumber === state.attempt.attemptNumber &&
          reusedOperation.reviewRequestId === input.reviewRequestId &&
          reusedOperation.responseText === input.responseText
        ) {
          return loadDashboard();
        }
        throw new Error("A staff review operation id cannot be reused across attempts or inputs");
      }
      if (history.some(({ reviewRequestId }) => reviewRequestId === input.reviewRequestId)) {
        throw new Error("A staff review response is already recorded for this request");
      }
      const review = currentReview(state);
      if (
        review === undefined ||
        input.reviewRequestId === undefined ||
        input.reviewRequestId !== review.request.reviewRequestId
      ) {
        throw new Error("The selected pending review is no longer available");
      }
      const respondedAt = now().toISOString();
      const response = createReviewResponse(
        review.request,
        {
          reviewResponseId: input.operationId,
          operationId: input.operationId,
          assignmentId: state.assignmentId,
          attemptNumber: state.attempt.attemptNumber,
          responderGithubUserId: options.staffGithubUserId,
          responseText: input.responseText,
          respondedAt,
        },
        history,
      );
      await resolveMockReviewRequest(options.serviceStateRoot, options.statePath, {
        assignmentId: state.assignmentId,
        attemptNumber: state.attempt.attemptNumber,
        reviewRequestId: review.request.reviewRequestId,
        response: response.responseText,
        resolvedAt: response.respondedAt,
      });
      await options.operationsStore.recordReviewResponse(state.assignmentId, response);
      return loadDashboard();
      });
    },
    async recordEvaluation(input) {
      return withMockStudentStateLock(options.serviceStateRoot, options.statePath, async () => {
      const { state, operations } = await stateAndOperations();
      if (state.assignmentId !== input.assignmentId) {
        throw new Error("This staff operation is not available for the selected assignment");
      }
      const history = operations.operationHistory.evaluations[input.assignmentId] ?? [];
      const reusedOperation = history.find(({ operationId }) => operationId === input.operationId);
      if (reusedOperation !== undefined) {
        const recordedDraft = {
          competencies: reusedOperation.competencies,
          overallRationale: reusedOperation.overallRationale,
        };
        if (
          reusedOperation.attemptNumber === state.attempt.attemptNumber &&
          JSON.stringify(recordedDraft) === JSON.stringify(input.draft)
        ) {
          return loadDashboard();
        }
        throw new Error("A staff evaluation operation id cannot be reused across attempts or inputs");
      }
      if (history.some(({ attemptNumber }) => attemptNumber === state.attempt.attemptNumber)) {
        throw new Error("A staff evaluation is already recorded for this attempt");
      }
      if (state.attempt.status !== "submitted" || state.attempt.submission === undefined) {
        throw new Error("An accepted student submission is required before evaluation");
      }
      const evaluation = createHumanEvaluation({
        evaluationId: input.operationId,
        operationId: input.operationId,
        evaluatorGithubUserId: options.staffGithubUserId,
        evaluatedAt: now().toISOString(),
        acceptedSubmission: acceptedProjection(verifySubmissionRecord(state.attempt.submission)),
        draft: input.draft as EvaluationDraft,
      });
      await options.operationsStore.recordEvaluation(state.assignmentId, evaluation);
      return loadDashboard();
      });
    },
    async createReplay() {
      throw new Error(
        "Provider replay is disabled because the connected student state has no receipt-backed replay provenance.",
      );
    },
    async reopenAttempt(input) {
      return withMockStudentStateLock(options.serviceStateRoot, options.statePath, async () => {
      const { state, operations } = await stateAndOperations();
      if (state.assignmentId !== input.assignmentId) {
        throw new Error("This staff operation is not available for the selected assignment");
      }
      const reopenHistory = operations.operationHistory.reopens[input.assignmentId] ?? [];
      const reusedOperation = reopenHistory.find(
        ({ operationId }) => operationId === input.operationId,
      );
      if (reusedOperation !== undefined) {
        if (reusedOperation.result.next.attemptNumber === state.attempt.attemptNumber) {
          return loadDashboard();
        }
        throw new Error("A staff reopen operation id cannot be reused across attempts");
      }
      if (
        reopenHistory.some(
          ({ result }) => result.previous.attemptNumber === state.attempt.attemptNumber,
        )
      ) {
        throw new Error("This attempt is already reopened");
      }
      const evaluation = operations.operationHistory.evaluations[input.assignmentId]?.find(
        ({ attemptNumber }) => attemptNumber === state.attempt.attemptNumber,
      );
      if (
        evaluation === undefined ||
        state.attempt.status !== "submitted" ||
        state.attempt.submission === undefined
      ) {
        throw new Error("Record the human evaluation before reopening this attempt");
      }
      const submission = verifySubmissionRecord(state.attempt.submission);
      const openedAt = now().toISOString();
      const result = reopenEvaluatedAttempt(
        {
          assignmentId: state.assignmentId,
          caseVersionDigest: sha256(state.attempt.caseVersionDigest),
          attemptNumber: state.attempt.attemptNumber,
          status: "submitted",
          submissionId: submission.submissionId,
          submissionDigest: sha256(submission.submissionDigest),
          evaluation,
        },
        { operationId: input.operationId, openedAt },
      );
      await reopenMockAttempt(options.serviceStateRoot, options.statePath, openedAt);
      await options.operationsStore.recordReopen(state.assignmentId, { operationId: input.operationId, result });
      return loadDashboard();
      });
    },
  };
}
