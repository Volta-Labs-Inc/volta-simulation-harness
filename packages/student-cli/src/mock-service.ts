import { createHash } from "node:crypto";

import {
  DecisionRecordSchema,
  EvidenceRecordSchema,
  EstimateRecordSchema,
  LedgerEntrySchema,
  CalculationRecordSchema,
  SuccessCriterionSchema,
  SubmissionDraftSchema,
  type ArtifactSnapshot,
  type CalculationRecord,
  type SubmissionDraft,
} from "@volta-sim/contracts";
import {
  acceptSubmission,
  checkSubmissionCompleteness,
  reopenAttempt,
  calculationIntegrityIssue,
  resolveAuthoredRequest,
  type SubmissionCompletenessContext,
} from "@volta-sim/core";

import { readControlJson, writeControlJson } from "./control-files.js";
import { withMockStudentStateLock } from "./state-lock.js";
import type { RepositoryProof } from "./repository.js";
import type {
  MockOfficialEvent,
  MockStudentServiceState,
  OfficialActionEvent,
  StudentAssignmentView,
  StudentSuccessCriterion,
  StudentServiceClient,
  StudentServiceErrorCode,
  StudentServiceRequest,
  StudentServiceResponse,
} from "./types.js";

const CHECKPOINT_PROMPTS = [
  "What changed in your view, and which evidence caused the change?",
  "What estimate would you make now, and which assumptions drive its range?",
  "What result would cause you to stop or pivot?",
] as const;

/** Reflection prompts belong to meaningful events, not to every bookkeeping reply. */
const NO_PROMPTS: readonly string[] = [];

const REVIEW_NEXT_STEP =
  "Optional: run review-request --topic <what you want checked> --choice continue (keep working while staff reply), wait, or decline. Nothing blocks you either way.";

function reviewSuggestion(reason: string) {
  return { reviewSuggested: true as const, reviewSuggestion: { reason, nextStep: REVIEW_NEXT_STEP } };
}

const STAGES = {
  discovery: "discovery",
  decision: "decision",
  response: "response",
  submitted: "submitted",
} as const;

export class MockServiceError extends Error {
  constructor(
    message: string,
    readonly code: StudentServiceErrorCode = "INVALID_INPUT",
  ) {
    super(message);
    this.name = "MockServiceError";
  }
}

function digest(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function fingerprint(request: StudentServiceRequest): string {
  return digest(JSON.stringify(request));
}

function mutationOperationId(request: StudentServiceRequest): string | undefined {
  return "operationId" in request ? request.operationId : undefined;
}

function assertOperationId(request: StudentServiceRequest): void {
  const operationId = mutationOperationId(request);
  if (
    operationId !== undefined &&
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(operationId)
  ) {
    throw new MockServiceError("The operation id is invalid. Create a new bounded id, then retry");
  }
}

function withReplay(response: Exclude<StudentServiceResponse, { kind: "login" }>) {
  if (response.kind === "action" || response.kind === "submission" || response.kind === "logout") {
    return { ...response, replayed: true };
  }
  return response;
}

function releasedContext(state: MockStudentServiceState): SubmissionCompletenessContext {
  return {
    publishedCase: state.submissionContext.publishedCase,
    trustedReleasedState: {
      assignmentId: state.assignmentId,
      attemptNumber: state.attempt.attemptNumber,
      caseVersionDigest: state.attempt.caseVersionDigest,
      currentEventSequence: Math.max(0, ...state.events.map(({ sequence }) => sequence)),
      events: state.events.map((event) => ({
        eventId: event.eventId,
        assignmentId: state.assignmentId,
        attemptNumber: state.attempt.attemptNumber,
        caseVersionDigest: state.attempt.caseVersionDigest,
        sequence: event.sequence,
        officialFactIds: event.officialFactIds,
        ...(event.releasedEvidenceIds === undefined ? {} : { releasedEvidenceIds: event.releasedEvidenceIds }),
        ...(event.providerInteractionId === undefined
          ? {}
          : { providerInteractionId: event.providerInteractionId }),
      })),
    },
  };
}

function submissionCandidate(state: MockStudentServiceState): {
  readonly candidate: Record<string, unknown>;
  readonly requestedMode:
    | "build"
    | "pilot"
    | "buy"
    | "no-build"
    | "data-collection";
} {
  const rawPlan =
    typeof state.workingDraft.responsePlan === "object" &&
    state.workingDraft.responsePlan !== null
      ? (state.workingDraft.responsePlan as Record<string, unknown>)
      : {};
  const requestedMode = ["build", "pilot", "buy", "no-build", "data-collection"].includes(
    String(rawPlan.mode),
  )
    ? (rawPlan.mode as "build" | "pilot" | "buy" | "no-build" | "data-collection")
    : "no-build";
  return {
    requestedMode,
    candidate: {
      ...state.workingDraft,
      submissionId: `submission-${state.assignmentId}-attempt-${state.attempt.attemptNumber}`,
      assignmentId: state.assignmentId,
      studentGithubUserId: state.studentGithubUserId,
      attemptNumber: state.attempt.attemptNumber,
      caseVersionDigest: state.attempt.caseVersionDigest,
      gitCommitSha: state.expectedRepository.commitSha,
      responsePlan:
        Object.keys(rawPlan).length === 0
          ? undefined
          : { ...rawPlan, mode: "no-build", artifactSnapshots: [] },
    },
  };
}

function preparationFor(
  state: MockStudentServiceState,
): Extract<StudentServiceResponse, { kind: "preparation" }> {
  const context = releasedContext(state);
  const { candidate, requestedMode } = submissionCandidate(state);
  const baseReport = checkSubmissionCompleteness(candidate, context);
  const parsed = SubmissionDraftSchema.safeParse(candidate);
  const baseReady = baseReport.complete && parsed.success;
  const requiresArtifact = requestedMode === "build" || requestedMode === "pilot";
  const artifactRequirement = {
    required: requiresArtifact,
    satisfied: !requiresArtifact,
    minimumCount: requiresArtifact ? (1 as const) : (0 as const),
  };
  const report = requiresArtifact
    ? {
        ...baseReport,
        complete: false,
        missing: [
          ...baseReport.missing,
          {
            path: "responsePlan.artifactSnapshots",
            message: "Select at least one tracked artifact when you submit a build or pilot.",
          },
        ],
      }
    : baseReport;
  return {
    kind: "preparation",
    ready: baseReady && !requiresArtifact,
    baseReady,
    ...(parsed.success ? { submissionBase: parsed.data, requestedMode } : {}),
    baseReport,
    report,
    artifactRequirement,
  };
}

function criterionReasoningHistory(state: MockStudentServiceState) {
  return state.reasoningHistory ?? [];
}

function copyCriterion(value: {
  readonly metric: string;
  readonly baseline?: string | undefined;
  readonly baselinePlan?: string | undefined;
  readonly target: string;
  readonly targetDate: string;
  readonly failureThreshold: string;
}): StudentSuccessCriterion {
  return {
    metric: value.metric,
    ...(value.baseline === undefined ? {} : { baseline: value.baseline }),
    ...(value.baselinePlan === undefined ? {} : { baselinePlan: value.baselinePlan }),
    target: value.target,
    targetDate: value.targetDate,
    failureThreshold: value.failureThreshold,
  };
}

function preparationMode(
  preparation: Extract<StudentServiceResponse, { kind: "preparation" }>,
) {
  return {
    baseReadiness: preparation.baseReport,
    readiness: preparation.report,
    artifactRequirement: preparation.artifactRequirement,
  };
}

function criterionIdsFor(state: MockStudentServiceState, count: number): string[] {
  return Array.from(
    { length: count },
    (_item, index) => state.successCriterionIds?.[index] ?? `criterion-${index + 1}`,
  );
}

function viewFor(state: MockStudentServiceState): StudentAssignmentView {
  const view = activeViewFor(state);
  return state.attempt.status === "submitted" ? withSubmittedOverlay(state, view) : view;
}

/**
 * After acceptance the working draft no longer describes the attempt; the frozen
 * submission does. Readiness, the artifact rule, and history must say so.
 */
function withSubmittedOverlay(
  state: MockStudentServiceState,
  view: StudentAssignmentView,
): StudentAssignmentView {
  const submission = state.attempt.submission as
    | {
        submissionDigest: string;
        evidence: readonly { officialFactId: string }[];
        requirementAssessments: readonly { requirementId: string; status: "addressed" | "not-yet" | "not-applicable" }[];
        responsePlan: { mode: string };
      }
    | undefined;
  if (submission === undefined) return view;
  const statusByRequirement = new Map(
    submission.requirementAssessments.map(({ requirementId, status }) => [requirementId, status]),
  );
  const report = {
    complete: true,
    missing: [],
    requirements: view.requirements.map(({ id }) => ({
      requirementId: id,
      status: statusByRequirement.get(id) ?? ("missing" as const),
    })),
    provenance: {
      citedOfficialFactCount: new Set(submission.evidence.map(({ officialFactId }) => officialFactId)).size,
      unreleasedFactIds: [],
    },
  };
  const requiresArtifact = submission.responsePlan.mode === "build" || submission.responsePlan.mode === "pilot";
  return {
    ...view,
    requirements: view.requirements.map((requirement) => ({
      ...requirement,
      status: statusByRequirement.get(requirement.id) ?? requirement.status,
    })),
    completeness: { complete: true, missingPaths: [] },
    baseReadiness: report,
    readiness: report,
    artifactRequirement: {
      required: requiresArtifact,
      satisfied: true,
      minimumCount: requiresArtifact ? (1 as const) : (0 as const),
    },
    attemptHistory: [
      ...view.attemptHistory,
      {
        attemptNumber: state.attempt.attemptNumber,
        status: "submitted" as const,
        submissionDigest: submission.submissionDigest,
        eventCount: state.events.length,
        operationReceiptCount: Object.keys(state.operations ?? {}).length,
        reasoningHistory: structuredClone(state.reasoningHistory ?? []),
        calculationHistory: structuredClone(state.calculationHistory ?? []),
        citedOfficialFactIds: [...new Set(submission.evidence.map(({ officialFactId }) => officialFactId))].sort(),
      },
    ],
  };
}

function activeViewFor(state: MockStudentServiceState): StudentAssignmentView {
  const context = releasedContext(state);
  const preparation = preparationFor(state);
  const report = preparation.report;
  const visible = context.publishedCase.source.visible;
  const requirementStatusById = new Map(
    report.requirements.map(({ requirementId, status }) => [requirementId, status]),
  );
  const factById = new Map(
    context.publishedCase.source.protected.facts.map((fact) => [fact.id, fact]),
  );
  // A fact re-released by a later similar question is still one fact; keep its first release.
  const seenFactIds = new Set<string>();
  const releasedEvidence = state.events.flatMap((event) =>
    event.officialFactIds.flatMap((factId) => {
      const fact = factById.get(factId);
      if (fact === undefined || seenFactIds.has(factId)) return [];
      seenFactIds.add(factId);
      return [{ factId, claim: fact.claim, provenance: fact.provenance, eventId: event.eventId }];
    }),
  );
  const capturedLedger = (
    Array.isArray(state.workingDraft.ledger) ? state.workingDraft.ledger : []
  ).flatMap((entry) => {
    const parsed = LedgerEntrySchema.safeParse(entry);
    return parsed.success ? [parsed.data] : [];
  });
  const capturedEvidence = (
    Array.isArray(state.workingDraft.evidence) ? state.workingDraft.evidence : []
  ).flatMap((evidence) => {
    const parsed = EvidenceRecordSchema.safeParse(evidence);
    return parsed.success ? [parsed.data] : [];
  });
  const rawCriteria = Array.isArray(state.workingDraft.successCriteria)
    ? state.workingDraft.successCriteria
    : [];
  const currentCriterionIds = criterionIdsFor(state, rawCriteria.length);
  const successCriteria = rawCriteria.flatMap((criterion, index) => {
    if (typeof criterion !== "object" || criterion === null) return [];
    const value = criterion as Record<string, unknown>;
    if (
      typeof value.metric !== "string" ||
      typeof value.target !== "string" ||
      typeof value.targetDate !== "string" ||
      typeof value.failureThreshold !== "string"
    ) {
      return [];
    }
    return [
      {
        criterionId: currentCriterionIds[index]!,
        metric: value.metric,
        ...(typeof value.baseline === "string" ? { baseline: value.baseline } : {}),
        ...(typeof value.baselinePlan === "string" ? { baselinePlan: value.baselinePlan } : {}),
        target: value.target,
        targetDate: value.targetDate,
        failureThreshold: value.failureThreshold,
        valid: SuccessCriterionSchema.safeParse(value).success,
      },
    ];
  });
  const availableCollectionMethods = state.useAuthoredRoutes
    ? visible.evidenceSources.filter(({ kind }) => kind === "collection-opportunity")
      .map(({ id, studentBrief }) => ({ id, description: studentBrief }))
    : [
    ...new Set(
      state.scriptedActions
        .filter(({ action }) => action === "collect")
        .map(({ targetId }) => targetId),
    ),
  ].map((id) => ({ id, description: "Available authored collection method" }));
  return {
    assignmentId: state.assignmentId,
    attemptNumber: state.attempt.attemptNumber,
    attemptStatus: state.attempt.status,
    ...(state.reopenedFromAttempt === undefined
      ? {}
      : { reopenedFromAttempt: state.reopenedFromAttempt }),
    caseVersionDigest: state.attempt.caseVersionDigest,
    repository: {
      slug: state.expectedRepository.slug,
      commitSha: state.expectedRepository.commitSha,
      sessionIgnoreBlobId: state.expectedRepository.sessionIgnoreBlobId,
    },
    brief: visible.brief,
    constraints: visible.constraints,
    unacceptableOutcomes: visible.unacceptableOutcomes,
    responseFamilies: visible.nonExhaustiveResponseFamilies,
    difficulty: visible.difficulty,
    rubric: visible.competencies.map(({ id, studentPrompt }) => ({ id, prompt: studentPrompt })),
    requirements: visible.requirements.map(({ id, title }) => ({
      id,
      title,
      status: requirementStatusById.get(id) ?? "missing",
    })),
    completeness: { complete: report.complete, missingPaths: report.missing.map(({ path }) => path) },
    ...preparationMode(preparation),
    availablePersonas: visible.personas.map(({ id, name, role, studentBrief }) => ({
      id,
      name,
      role,
      brief: studentBrief,
      description: `${name}, ${role}`,
    })),
    availableEvidence: visible.evidenceSources.map(({ id, title, kind, studentBrief }) => ({
      id,
      title,
      kind,
      brief: studentBrief,
      description: title,
    })),
    availableCollectionMethods,
    capturedLedger,
    capturedEvidence,
    successCriteria,
    reasoningHistory: structuredClone(criterionReasoningHistory(state)),
    calculations: structuredClone((state.workingDraft.calculations ?? []) as CalculationRecord[]),
    calculationHistory: structuredClone(state.calculationHistory ?? []),
    releasedEvidence,
    recentEvents: state.events.slice(-10).map(({ eventId, eventType, message }) => ({
      eventId,
      eventType,
      message,
    })),
    stage: state.stage,
    simulatedAt: state.simulatedAt,
    pendingReview: state.reviewRequests.some(({ status }) => status === "pending"),
    reviewUpdates: state.reviewRequests.map(({ topic, status, response, resolvedAt }) => ({
      topic,
      status,
      ...(response === undefined ? {} : { response }),
      ...(resolvedAt === undefined ? {} : { resolvedAt }),
    })),
    attemptHistory: state.attemptHistory.map(({ attempt, events, operations, reasoningHistory, calculationHistory }) => {
      const submission = attempt.submission as {
        submissionDigest: string;
        evidence: readonly { officialFactId: string }[];
      };
      return {
        attemptNumber: attempt.attemptNumber,
        status: "submitted" as const,
        submissionDigest: submission.submissionDigest,
        eventCount: events.length,
        operationReceiptCount: Object.keys(operations ?? {}).length,
        reasoningHistory: structuredClone(reasoningHistory ?? []),
        calculationHistory: structuredClone(calculationHistory ?? []),
        citedOfficialFactIds: [
          ...new Set(submission.evidence.map(({ officialFactId }) => officialFactId)),
        ].sort(),
      };
    }),
  };
}

function nextEvent(
  state: MockStudentServiceState,
  eventType: string,
  message: string,
  officialFactIds: readonly string[] = [],
  providerInteractionId?: string,
): MockOfficialEvent {
  const sequence = Math.max(0, ...state.events.map((event) => event.sequence)) + 1;
  const factById = new Map(
    state.submissionContext.publishedCase.source.protected.facts.map((fact) => [fact.id, fact]),
  );
  return {
    eventId: `event-${sequence}`,
    sequence,
    eventType,
    message,
    officialFactIds,
    provenance: officialFactIds.flatMap((factId) => {
      const fact = factById.get(factId);
      return fact === undefined ? [] : [{ factId, source: fact.provenance }];
    }),
    simulatedAt: state.simulatedAt,
    ...(providerInteractionId === undefined ? {} : { providerInteractionId }),
  };
}

function assertActive(state: MockStudentServiceState): void {
  if (state.attempt.status !== "active") {
    throw new MockServiceError(
      "This attempt is submitted. Resume the reopened attempt to continue",
      "ATTEMPT_SUBMITTED",
    );
  }
}

function proofIssue(
  state: MockStudentServiceState,
  draft: SubmissionDraft,
  artifacts: readonly ArtifactSnapshot[],
  request: Extract<StudentServiceRequest, { kind: "submit" }>,
  trustedProof?: RepositoryProof,
): boolean {
  if (
    request.repository.repositorySlug.toLowerCase() !== state.expectedRepository.slug.toLowerCase() ||
    request.repository.commitSha !== (trustedProof?.commitSha ?? state.expectedRepository.commitSha) ||
    request.repository.sessionIgnoreBlobId !== state.expectedRepository.sessionIgnoreBlobId ||
    draft.gitCommitSha !== request.repository.commitSha ||
    draft.responsePlan.mode !== request.mode ||
    JSON.stringify(draft.responsePlan.artifactSnapshots) !== JSON.stringify(artifacts)
  ) {
    return true;
  }
  const proofByPath = new Map(request.repository.selectedBlobs.map((blob) => [blob.path, blob.objectId]));
  if (
    proofByPath.size !== request.repository.selectedBlobs.length ||
    proofByPath.size !== artifacts.length
  ) {
    return true;
  }
  return artifacts.some((artifact) => {
    const objectId = proofByPath.get(artifact.path);
    const expected = trustedProof === undefined ? state.expectedRepository.selectedBlobs[artifact.path] : trustedProof.selectedBlobs.find(({ path }) => path === artifact.path)?.objectId;
    if (objectId === undefined || expected === undefined || objectId !== expected) return true;
    const bytes = Buffer.from(artifact.content, "utf8");
    const algorithm = objectId.length === 64 ? "sha256" : "sha1";
    const computed = createHash(algorithm)
      .update(`blob ${bytes.byteLength}\0`, "utf8")
      .update(bytes)
      .digest("hex");
    return computed !== objectId;
  });
}

export interface FileBackedMockStudentServiceOptions {
  readonly now?: () => Date;
  readonly interruptAfterCommit?: ReadonlySet<string>;
  readonly verifySubmissionRepository?: (
    expected: MockStudentServiceState["expectedRepository"],
    request: Extract<StudentServiceRequest, { kind: "submit" }>,
  ) => Promise<RepositoryProof>;
}

export class FileBackedMockStudentService implements StudentServiceClient {
  readonly #now: () => Date;
  readonly #interrupted = new Set<string>();

  constructor(
    private readonly serviceStateRoot: string,
    private readonly statePath: string,
    private readonly options: FileBackedMockStudentServiceOptions = {},
  ) {
    this.#now = options.now ?? (() => new Date());
  }

  async #load(): Promise<MockStudentServiceState> {
    return readMockStudentServiceState(this.serviceStateRoot, this.statePath);
  }

  async #save(state: MockStudentServiceState): Promise<void> {
    await writeControlJson(this.serviceStateRoot, this.statePath, state);
  }

  #assertAuthorized(
    state: MockStudentServiceState,
    request: StudentServiceRequest,
    token: string | undefined,
  ): void {
    const operationId = mutationOperationId(request);
    const replayingLogout =
      request.kind === "logout" &&
      operationId !== undefined &&
      state.operations[operationId]?.fingerprint === fingerprint(request);
    if (
      token === undefined ||
      digest(token) !== state.activeTokenDigest ||
      (!replayingLogout && state.tokenRevokedAt !== undefined) ||
      state.tokenExpiresAt === undefined ||
      this.#now().getTime() >= Date.parse(state.tokenExpiresAt)
    ) {
      throw new MockServiceError(
        "Your session is unavailable. Sign in again, then retry",
        "SESSION_UNAVAILABLE",
      );
    }
  }

  async #persistOperation(
    state: MockStudentServiceState,
    operationId: string,
    requestFingerprint: string,
    response: Exclude<StudentServiceResponse, { kind: "login" }>,
  ): Promise<StudentServiceResponse> {
    state.operations[operationId] = {
      attemptNumber: state.attempt.attemptNumber,
      fingerprint: requestFingerprint,
      response,
    };
    await this.#save(state);
    if (
      this.options.interruptAfterCommit?.has(operationId) === true &&
      !this.#interrupted.has(operationId)
    ) {
      this.#interrupted.add(operationId);
      throw new MockServiceError(
        "The response was interrupted. Retry with the same operation id",
        "RETRY_SAME_OPERATION",
      );
    }
    return response;
  }

  async execute(request: StudentServiceRequest, token?: string): Promise<StudentServiceResponse> {
    return withMockStudentStateLock(this.serviceStateRoot, this.statePath, () => this.#executeLocked(request, token));
  }

  async #executeLocked(request: StudentServiceRequest, token?: string): Promise<StudentServiceResponse> {
    assertOperationId(request);
    const state = await this.#load();
    const requestFingerprint = fingerprint(request);

    if (request.kind === "login") {
      const existing = state.loginOperations[request.operationId];
      if (existing !== undefined && existing.fingerprint !== requestFingerprint) {
        throw new MockServiceError(
          "That operation id was already used for a different action",
          "OPERATION_ID_CONFLICT",
        );
      }
      const issuedToken = `mock_${digest(`${state.assignmentId}:${request.operationId}:local-only`)}`;
      const tokenDigest = digest(issuedToken);
      if (existing !== undefined) {
        const replayIsActive =
          existing.tokenDigest === state.activeTokenDigest &&
          state.tokenRevokedAt === undefined &&
          state.tokenExpiresAt !== undefined &&
          this.#now().getTime() < Date.parse(state.tokenExpiresAt);
        if (!replayIsActive) {
          throw new MockServiceError(
            "That login can no longer be replayed. Sign in with a new operation id",
            "LOGIN_REPLAY_UNAVAILABLE",
          );
        }
      } else {
        state.loginOperations[request.operationId] = { fingerprint: requestFingerprint, tokenDigest };
        state.activeTokenDigest = tokenDigest;
        state.tokenExpiresAt = new Date(this.#now().getTime() + 15 * 60_000).toISOString();
        delete state.tokenRevokedAt;
        await this.#save(state);
        if (
          this.options.interruptAfterCommit?.has(request.operationId) === true &&
          !this.#interrupted.has(request.operationId)
        ) {
          this.#interrupted.add(request.operationId);
          throw new MockServiceError(
            "The response was interrupted. Retry with the same operation id",
            "RETRY_SAME_OPERATION",
          );
        }
      }
      return {
        kind: "login",
        token: issuedToken,
        assignmentId: state.assignmentId,
        repository: {
          slug: state.expectedRepository.slug,
          commitSha: state.expectedRepository.commitSha,
          sessionIgnoreBlobId: state.expectedRepository.sessionIgnoreBlobId,
        },
      };
    }

    this.#assertAuthorized(state, request, token);
    const operationId = mutationOperationId(request);
    if (operationId !== undefined) {
      const existing = state.operations[operationId];
      if (existing !== undefined) {
        if (existing.fingerprint !== requestFingerprint) {
          throw new MockServiceError(
            "That operation id was already used for a different action",
            "OPERATION_ID_CONFLICT",
          );
        }
        return withReplay(existing.response);
      }
    }

    if (request.kind === "resume" || request.kind === "status") {
      return { kind: "view", view: viewFor(state) };
    }
    if (request.kind === "checkpoint") {
      return { kind: "checkpoint", prompts: CHECKPOINT_PROMPTS };
    }
    if (request.kind === "logout") {
      state.tokenRevokedAt = this.#now().toISOString();
      return this.#persistOperation(
        state,
        request.operationId,
        requestFingerprint,
        { kind: "logout", replayed: false },
      );
    }

    assertActive(state);
    if (request.kind === "prepare-submission") return preparationFor(state);
    let response: Exclude<StudentServiceResponse, { kind: "login" }>;
    if (request.kind === "talk" || request.kind === "evidence" || request.kind === "collect") {
      const targetId =
        request.kind === "talk"
          ? request.personaId
          : request.kind === "evidence"
            ? request.evidenceSourceId
            : request.methodId;
      if (state.useAuthoredRoutes) {
        const visible = state.submissionContext.publishedCase.source.visible;
        const known = request.kind === "talk" ? visible.personas.some(({ id }) => id === targetId)
          : request.kind === "evidence" ? visible.evidenceSources.some(({ id }) => id === targetId)
          : visible.evidenceSources.some(({ id, kind }) => id === targetId && kind === "collection-opportunity");
        if (!known) throw new MockServiceError("That action is unavailable", "ACTION_UNAVAILABLE");
        const resolution = resolveAuthoredRequest(state.submissionContext.publishedCase, {
          assignmentId: state.assignmentId, attemptNumber: state.attempt.attemptNumber,
          channel: request.kind === "talk" ? "persona" : request.kind === "evidence" ? "evidence" : "collection",
          targetId, question: request.kind === "collect" ? request.plan : request.question,
        }, releasedContext(state).trustedReleasedState);
        let simulatedTime: { advancedBy: { amount: number; unit: "minutes" | "hours" | "days" }; now: string } | undefined;
        if (resolution.status === "matched") {
          const time = resolution.consequence.time;
          const minutes = time.amount * (time.unit === "days" ? 1440 : time.unit === "hours" ? 60 : 1);
          state.simulatedAt = new Date(Date.parse(state.simulatedAt) + minutes * 60_000).toISOString();
          if (time.amount > 0) simulatedTime = { advancedBy: { ...time }, now: state.simulatedAt };
        }
        const alreadyReleased = new Set(state.events.flatMap(({ officialFactIds }) => officialFactIds));
        const event = {
          ...nextEvent(state, request.kind, resolution.studentMessage, resolution.officialFacts.map(({ id }) => id)),
          releasedEvidenceIds: resolution.releasedEvidenceIds,
        };
        state.events.push(event);
        const releasedSomething = resolution.officialFacts.length > 0;
        const newFactIds = resolution.officialFacts.map(({ id }) => id).filter((id) => !alreadyReleased.has(id));
        const guidance = !releasedSomething
          ? "No official fact was released, so nothing in this reply can be cited by ID. If it matters to your decision, record it with ledger --kind unknown."
          : newFactIds.length === 0
            ? `You already had ${resolution.officialFacts.map(({ id }) => id).join(", ")}; asking again released nothing new but still cost simulated time.`
            : `Released fact ID${newFactIds.length === 1 ? "" : "s"} ${newFactIds.join(", ")}. Cite with ledger --kind fact --statement <your words> --fact-id <id>; the ledger reply then prints the evidence ID to use in decision, requirement, and claim.`;
        return this.#persistOperation(state, request.operationId, requestFingerprint, {
          kind: "action", message: resolution.studentMessage, event,
          checkpointPrompts: releasedSomething ? CHECKPOINT_PROMPTS : NO_PROMPTS,
          ...(resolution.status === "ambiguous"
            ? reviewSuggestion("Your question matched more than one authored answer, so nothing was released. Rephrase it, or ask staff which reading you meant.")
            : { reviewSuggested: false }),
          ...(simulatedTime === undefined ? {} : { simulatedTime }),
          guidance,
          sandboxWorkBlocked: false, replayed: false,
        });
      }
      const scripted = state.scriptedActions.find(
        (action) => action.action === request.kind && action.targetId === targetId,
      );
      if (scripted === undefined) {
        throw new MockServiceError(
          "That official action is unavailable. Check status, then retry",
          "ACTION_UNAVAILABLE",
        );
      }
      const providerInteractionId =
        scripted.provider === undefined ? undefined : `interaction-${request.operationId}`;
      const event = nextEvent(
        state,
        request.kind,
        scripted.message,
        scripted.officialFactIds,
        providerInteractionId,
      );
      state.events.push(event);
      if (scripted.provider !== undefined && providerInteractionId !== undefined) {
        state.providerProvenance.push({
          ...scripted.provider,
          interactionId: providerInteractionId,
          eventId: event.eventId,
          renderedAt: state.simulatedAt,
        });
      }
      if (scripted.simulatedDays !== undefined) {
        state.simulatedAt = new Date(
          Date.parse(state.simulatedAt) + scripted.simulatedDays * 86_400_000,
        ).toISOString();
      }
      response = {
        kind: "action",
        message: scripted.message,
        event: event as OfficialActionEvent,
        checkpointPrompts: CHECKPOINT_PROMPTS,
        reviewSuggested: scripted.reviewSuggested ?? false,
        sandboxWorkBlocked: false,
        replayed: false,
      };
    } else if (request.kind === "advance") {
      state.simulatedAt = new Date(
        Date.parse(state.simulatedAt) + request.days * 86_400_000,
      ).toISOString();
      const event = nextEvent(state, "advance", `Advanced ${request.days} simulated day(s).`);
      state.events.push(event);
      response = {
        kind: "action",
        message: event.message,
        event,
        checkpointPrompts: CHECKPOINT_PROMPTS,
        reviewSuggested: false,
        sandboxWorkBlocked: false,
        replayed: false,
      };
    } else if (request.kind === "ledger") {
      const entry = LedgerEntrySchema.parse({
        ...request.entry,
        id: `ledger-${request.operationId}`,
        createdAt: state.simulatedAt,
      });
      const released = new Set(state.events.flatMap(({ officialFactIds }) => officialFactIds));
      if (entry.officialFactIds.some((factId) => !released.has(factId))) {
        throw new MockServiceError(
          "A fact can cite only evidence released in this attempt",
          "INVALID_EVIDENCE_REFERENCE",
        );
      }
      const ledger = Array.isArray(state.workingDraft.ledger) ? state.workingDraft.ledger : [];
      state.workingDraft.ledger = [...ledger, entry];
      const evidence = Array.isArray(state.workingDraft.evidence) ? state.workingDraft.evidence : [];
      const eventByFact = new Map<string, MockOfficialEvent>();
      for (const event of state.events) {
        for (const factId of event.officialFactIds) eventByFact.set(factId, event);
      }
      state.workingDraft.evidence = [
        ...evidence,
        ...entry.officialFactIds.map((factId) => {
          const event = eventByFact.get(factId)!;
          return {
            id: `evidence-${request.operationId}-${factId}`,
            assignmentId: state.assignmentId,
            attemptNumber: state.attempt.attemptNumber,
            officialFactId: factId,
            sourceEventId: event.eventId,
            capturedAt: state.simulatedAt,
            provenance: event.provenance.find((item) => item.factId === factId)?.source ?? "Official release",
          };
        }),
      ];
      const evidenceIds = entry.officialFactIds.map(
        (factId) => `evidence-${request.operationId}-${factId}`,
      );
      response = {
        kind: "action",
        message: "Reasoning entry recorded.",
        guidance:
          evidenceIds.length > 0
            ? `Evidence ID${evidenceIds.length === 1 ? "" : "s"} for citing in decision, requirement, and claim: ${evidenceIds.join(", ")}.`
            : "This entry is saved and shown to reviewers, but only fact entries get an evidence ID. Refer to it in your rationale text.",
        checkpointPrompts: NO_PROMPTS,
        reviewSuggested: false,
        sandboxWorkBlocked: false,
        replayed: false,
        recorded: {
          kind: "ledger",
          ledgerEntryId: entry.id,
          evidenceIds,
        },
      };
    } else if (request.kind === "decision") {
      const decisionId = `decision-${request.operationId}`;
      state.workingDraft.decision = DecisionRecordSchema.parse({
        ...request.decision,
        id: decisionId,
        createdAt: state.simulatedAt,
      });
      if (state.stage === STAGES.discovery) state.stage = STAGES.decision;
      response = {
        kind: "action",
        message: "Decision recorded. Recording a new decision replaces this one in the working draft.",
        checkpointPrompts: CHECKPOINT_PROMPTS,
        ...reviewSuggestion("A recorded decision is a natural point for a staff sanity check before you commit further work to it."),
        sandboxWorkBlocked: false,
        replayed: false,
        recorded: { kind: "decision", decisionId },
      };
    } else if (request.kind === "estimate") {
      const estimate = EstimateRecordSchema.parse({
        ...request.estimate,
        id: `estimate-${request.operationId}`,
        createdAt: state.simulatedAt,
      });
      const estimates = Array.isArray(state.workingDraft.estimates) ? state.workingDraft.estimates : [];
      state.workingDraft.estimates = [...estimates, estimate];
      response = {
        kind: "action",
        message: "Estimate recorded.",
        checkpointPrompts: NO_PROMPTS,
        reviewSuggested: false,
        sandboxWorkBlocked: false,
        replayed: false,
        recorded: { kind: "estimate", estimateId: estimate.id },
      };
    } else if (request.kind === "requirement") {
      if (request.rationale.trim() === "") {
        throw new MockServiceError("Add your own rationale before recording this requirement status");
      }
      const known = state.submissionContext.publishedCase.source.visible.requirements.some(
        ({ id }) => id === request.requirementId,
      );
      if (!known) throw new MockServiceError("That requirement is not part of this assignment");
      const current = Array.isArray(state.workingDraft.requirementAssessments)
        ? (state.workingDraft.requirementAssessments as { requirementId?: string }[])
        : [];
      state.workingDraft.requirementAssessments = [
        ...current.filter(({ requirementId }) => requirementId !== request.requirementId),
        {
          requirementId: request.requirementId,
          status: request.status,
          rationale: request.rationale,
          evidenceIds: [...request.evidenceIds],
        },
      ];
      response = {
        kind: "action",
        message: "Requirement status recorded. Recording the same requirement again replaces this assessment.",
        checkpointPrompts: NO_PROMPTS,
        reviewSuggested: false,
        sandboxWorkBlocked: false,
        replayed: false,
        recorded: { kind: "requirement", requirementId: request.requirementId },
      };
    } else if (request.kind === "claim") {
      if (request.rationale.trim() === "") {
        throw new MockServiceError("Add your own rationale before recording this competency claim");
      }
      const known = state.submissionContext.publishedCase.source.visible.competencies.some(
        ({ id }) => id === request.competencyId,
      );
      if (!known) throw new MockServiceError("That competency is not part of this assignment");
      const current = Array.isArray(state.workingDraft.competencyClaims)
        ? (state.workingDraft.competencyClaims as { competencyId?: string }[])
        : [];
      state.workingDraft.competencyClaims = [
        ...current.filter(({ competencyId }) => competencyId !== request.competencyId),
        {
          competencyId: request.competencyId,
          rationale: request.rationale,
          evidenceIds: [...request.evidenceIds],
        },
      ];
      response = {
        kind: "action",
        message: "Competency claim recorded. Recording the same competency again replaces this claim.",
        checkpointPrompts: NO_PROMPTS,
        reviewSuggested: false,
        sandboxWorkBlocked: false,
        replayed: false,
        recorded: { kind: "claim", competencyId: request.competencyId },
      };
    } else if (request.kind === "draft") {
      if (
        request.rationale.trim() === "" ||
        request.feasibility.trim() === "" ||
        request.missingDataPlan.trim() === "" ||
        request.economicRationale.trim() === "" ||
        request.risks.length === 0 ||
        request.risks.some((risk) => risk.trim() === "")
      ) {
        throw new MockServiceError("Complete each response field with your own reasoning");
      }
      state.workingDraft.missingDataPlan = request.missingDataPlan;
      state.workingDraft.economicRationale = request.economicRationale;
      state.workingDraft.responsePlan = {
        mode: request.mode,
        rationale: request.rationale,
        feasibility: request.feasibility,
        risks: [...request.risks],
      };
      if (state.stage !== STAGES.submitted) state.stage = STAGES.response;
      const higherRisk = request.mode === "build" || request.mode === "pilot";
      response = {
        kind: "action",
        message: "Response plan recorded. Recording another plan replaces this one; the missing-data plan and economic rationale were saved with it.",
        checkpointPrompts: CHECKPOINT_PROMPTS,
        ...(higherRisk
          ? reviewSuggestion("A build or pilot response carries more risk than measuring or not building, so staff may want to look before you invest in it.")
          : { reviewSuggested: false }),
        sandboxWorkBlocked: false,
        replayed: false,
        recorded: { kind: "draft", mode: request.mode },
      };
    } else if (request.kind === "criterion") {
      const { criterion } = request;
      const parsedCriterion = SuccessCriterionSchema.safeParse(criterion);
      if (!parsedCriterion.success) {
        throw new MockServiceError(
          "Provide a metric, one baseline or baseline plan, a target date shown by criterion --help, and a failure threshold",
        );
      }
      const criteria = Array.isArray(state.workingDraft.successCriteria)
        ? state.workingDraft.successCriteria
        : [];
      const criterionId = `criterion-${request.operationId}`;
      state.workingDraft.successCriteria = [...criteria, parsedCriterion.data];
      state.successCriterionIds = [
        ...criterionIdsFor(state, criteria.length),
        criterionId,
      ];
      state.reasoningHistory = [
        ...criterionReasoningHistory(state),
        {
          kind: "criterion-recorded",
          operationId: request.operationId,
          attemptNumber: state.attempt.attemptNumber,
          recordedAt: state.simulatedAt,
          criterionId,
          criterion: copyCriterion(parsedCriterion.data),
        },
      ];
      response = {
        kind: "action",
        message: "Success criterion recorded.",
        checkpointPrompts: NO_PROMPTS,
        reviewSuggested: false,
        sandboxWorkBlocked: false,
        replayed: false,
        recorded: { kind: "criterion", criterionId },
      };
    } else if (request.kind === "criterion-remove") {
      const criteria = Array.isArray(state.workingDraft.successCriteria)
        ? state.workingDraft.successCriteria
        : [];
      const criterionIds = criterionIdsFor(state, criteria.length);
      const index = criterionIds.indexOf(request.criterionId);
      if (index < 0) {
        throw new MockServiceError(
          "That criterion is not in the working draft. Run status and use an exact criterion id",
          "CRITERION_NOT_FOUND",
        );
      }
      const removedCriterion = copyCriterion(
        criteria[index] as Parameters<typeof copyCriterion>[0],
      );
      state.workingDraft.successCriteria = criteria.filter((_item, itemIndex) => itemIndex !== index);
      state.successCriterionIds = criterionIds.filter((_item, itemIndex) => itemIndex !== index);
      state.reasoningHistory = [
        ...criterionReasoningHistory(state),
        {
          kind: "criterion-removed",
          operationId: request.operationId,
          attemptNumber: state.attempt.attemptNumber,
          recordedAt: state.simulatedAt,
          criterionId: request.criterionId,
          criterion: removedCriterion,
        },
      ];
      response = {
        kind: "action",
        message: "Success criterion removed from the working draft. Its action history is unchanged.",
        checkpointPrompts: NO_PROMPTS,
        reviewSuggested: false,
        sandboxWorkBlocked: false,
        replayed: false,
        recorded: { kind: "criterion-removal", criterionId: request.criterionId },
      };
    } else if (request.kind === "calculation") {
      const calculation = CalculationRecordSchema.parse({
        ...request.calculation,
        id: `calculation-${request.operationId}`,
      });
      const calculationIssue = calculationIntegrityIssue(calculation);
      if (calculationIssue !== undefined) throw new MockServiceError(calculationIssue, "INVALID_CALCULATION");
      const calculations = Array.isArray(state.workingDraft.calculations)
        ? state.workingDraft.calculations
        : [];
      state.workingDraft.calculations = [...calculations, calculation];
      state.calculationHistory = [...(state.calculationHistory ?? []), {
        kind: "calculation-recorded", operationId: request.operationId,
        attemptNumber: state.attempt.attemptNumber, recordedAt: state.simulatedAt, calculation,
      }];
      response = {
        kind: "action",
        message: "Reproducible calculation recorded.",
        recorded: { kind: "calculation", calculationId: calculation.id },
        checkpointPrompts: NO_PROMPTS,
        reviewSuggested: false,
        sandboxWorkBlocked: false,
        replayed: false,
      };
    } else if (request.kind === "calculation-remove") {
      const calculations = (state.workingDraft.calculations ?? []) as CalculationRecord[];
      const calculation = calculations.find(({ id }) => id === request.calculationId);
      if (calculation === undefined) throw new MockServiceError("Calculation unavailable", "CALCULATION_NOT_FOUND");
      state.workingDraft.calculations = calculations.filter(({ id }) => id !== request.calculationId);
      state.calculationHistory = [...(state.calculationHistory ?? []), {
        kind: "calculation-removed", operationId: request.operationId,
        attemptNumber: state.attempt.attemptNumber, recordedAt: state.simulatedAt, calculation: structuredClone(calculation),
      }];
      response = { kind: "action", message: "Calculation removed from the draft; its full history is preserved.",
        recorded: { kind: "calculation-removal", calculationId: request.calculationId },
        checkpointPrompts: NO_PROMPTS, reviewSuggested: false, sandboxWorkBlocked: false, replayed: false };
    } else if (request.kind === "review-request") {
      if (request.studentChoice !== "decline") {
        state.reviewRequests.push({
          reviewRequestId: `review-${request.operationId}`,
          topic: request.topic,
          studentChoice: request.studentChoice,
          createdAt: state.simulatedAt,
          status: "pending",
        });
      }
      response = {
        kind: "action",
        message:
          request.studentChoice === "decline"
            ? "Review suggestion declined. You may continue working."
            : "Staff review requested. You may continue working while it is pending; a reply appears in status under reviewUpdates.",
        checkpointPrompts: NO_PROMPTS,
        reviewSuggested: false,
        sandboxWorkBlocked: false,
        replayed: false,
      };
    } else {
      const draft = SubmissionDraftSchema.safeParse(request.draft);
      let trustedProof: RepositoryProof | undefined;
      if (draft.success && this.options.verifySubmissionRepository !== undefined) {
        try { trustedProof = await this.options.verifySubmissionRepository(state.expectedRepository, request); }
        catch { throw new MockServiceError("The selected files cannot be independently verified", "REPOSITORY_MISMATCH"); }
      }
      if (
        draft.success &&
        proofIssue(state, draft.data, request.artifacts, request, trustedProof)
      ) {
        throw new MockServiceError(
          "The selected files do not match the assigned repository commit. Capture them again, then retry",
          "REPOSITORY_MISMATCH",
        );
      }
      const result = acceptSubmission(
        state.attempt,
        request.draft,
        releasedContext(state),
        {
          acceptedAt: this.#now().toISOString(),
          cliVersion: "0.1.0",
          providerProvenance: state.providerProvenance,
        },
      );
      state.attempt = structuredClone(result.attempt) as MockStudentServiceState["attempt"];
      if (result.accepted) state.stage = STAGES.submitted;
      response = {
        kind: "submission",
        accepted: result.accepted,
        attemptNumber: state.attempt.attemptNumber,
        ...(result.accepted && state.attempt.submission !== undefined
          ? {
              submissionDigest: (state.attempt.submission as { submissionDigest: `sha256:${string}` })
                .submissionDigest,
            }
          : {}),
        report: result.report,
        replayed: false,
      };
    }

    return this.#persistOperation(state, request.operationId, requestFingerprint, response);
  }
}

async function readMockStudentServiceStateLocked(
  serviceStateRoot: string,
  statePath: string,
): Promise<MockStudentServiceState> {
  const value = await readControlJson(serviceStateRoot, statePath);
  if (
    typeof value !== "object" ||
    value === null ||
    !("version" in value) ||
    value.version !== 1
  ) {
    throw new MockServiceError("The local simulation fixture is invalid");
  }
  return value as MockStudentServiceState;
}

export async function readMockStudentServiceState(root: string, statePath: string): Promise<MockStudentServiceState> {
  return withMockStudentStateLock(root, statePath, () => readMockStudentServiceStateLocked(root, statePath));
}

export function mockReviewRequestId(
  state: MockStudentServiceState,
  index: number,
): string {
  const review = state.reviewRequests[index];
  if (review === undefined) throw new MockServiceError("No matching review request exists");
  return (
    review.reviewRequestId ??
    `review-${state.assignmentId}-attempt-${state.attempt.attemptNumber}-${index + 1}`
  );
}

async function resolveMockReviewRequestLocked(
  serviceStateRoot: string,
  statePath: string,
  input: {
    readonly assignmentId: string;
    readonly attemptNumber: number;
    readonly reviewRequestId: string;
    readonly response: string;
    readonly resolvedAt: string;
  },
): Promise<void> {
  if (
    input.response.trim() === "" ||
    input.response.length > 5_000 ||
    !Number.isFinite(Date.parse(input.resolvedAt))
  ) {
    throw new MockServiceError("The staff response is invalid");
  }
  const state = await readMockStudentServiceState(serviceStateRoot, statePath);
  if (
    state.assignmentId !== input.assignmentId ||
    state.attempt.attemptNumber !== input.attemptNumber
  ) {
    throw new MockServiceError("The pending review does not belong to this exact attempt");
  }
  const index = state.reviewRequests.findIndex(
    (review, reviewIndex) =>
      mockReviewRequestId(state, reviewIndex) === input.reviewRequestId &&
      review.status === "pending",
  );
  if (index < 0) throw new MockServiceError("No matching pending review exists");
  const review = state.reviewRequests[index]!;
  review.status = "resolved";
  review.response = input.response;
  review.resolvedAt = input.resolvedAt;
  await writeControlJson(serviceStateRoot, statePath, state);
}

export async function resolveMockReviewRequest(root: string, statePath: string, input: Parameters<typeof resolveMockReviewRequestLocked>[2]): Promise<void> {
  return withMockStudentStateLock(root, statePath, () => resolveMockReviewRequestLocked(root, statePath, input));
}

async function reopenMockAttemptLocked(
  serviceStateRoot: string,
  statePath: string,
  openedAt: string,
): Promise<void> {
  const state = (await readControlJson(serviceStateRoot, statePath)) as MockStudentServiceState;
  const reopened = reopenAttempt(state.attempt, openedAt);
  state.attemptHistory.push({
    attempt: structuredClone(state.attempt),
    events: structuredClone(state.events),
    providerProvenance: structuredClone(state.providerProvenance),
    reviewRequests: structuredClone(state.reviewRequests),
    operations: structuredClone(state.operations),
    reasoningHistory: structuredClone(criterionReasoningHistory(state)),
    calculationHistory: structuredClone(state.calculationHistory ?? []),
  });
  state.reopenedFromAttempt = reopened.previous.attemptNumber;
  state.attempt = structuredClone(reopened.next) as MockStudentServiceState["attempt"];
  state.events = [];
  state.providerProvenance = [];
  state.workingDraft = {};
  state.successCriterionIds = [];
  state.reasoningHistory = [];
  state.calculationHistory = [];
  state.reviewRequests = [];
  state.operations = {};
  state.tokenRevokedAt = openedAt;
  await writeControlJson(serviceStateRoot, statePath, state);
}

export async function reopenMockAttempt(root: string, statePath: string, openedAt: string): Promise<void> {
  return withMockStudentStateLock(root, statePath, () => reopenMockAttemptLocked(root, statePath, openedAt));
}

async function resolveMockReviewLocked(
  serviceStateRoot: string,
  statePath: string,
  topic: string,
  response: string,
  resolvedAt: string,
): Promise<void> {
  if (
    response.trim() === "" ||
    response.length > 5_000 ||
    !Number.isFinite(Date.parse(resolvedAt))
  ) {
    throw new MockServiceError("The staff response is invalid");
  }
  const state = (await readControlJson(serviceStateRoot, statePath)) as MockStudentServiceState;
  const review = state.reviewRequests.find(
    (item) => item.topic === topic && item.status === "pending",
  );
  if (review === undefined) throw new MockServiceError("No matching pending review exists");
  review.status = "resolved";
  review.response = response;
  review.resolvedAt = resolvedAt;
  await writeControlJson(serviceStateRoot, statePath, state);
}

export async function resolveMockReview(root: string, statePath: string, topic: string, response: string, resolvedAt: string): Promise<void> {
  return withMockStudentStateLock(root, statePath, () => resolveMockReviewLocked(root, statePath, topic, response, resolvedAt));
}
