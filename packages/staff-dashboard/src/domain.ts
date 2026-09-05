import { deriveOverallHumanRating } from "@volta-sim/core";
import { sha256TextDigest } from "./sha256.js";

export const COMPETENCY_IDS = [
  "problem-viability",
  "evidence-sufficiency",
  "response-feasibility",
  "objective-success-criteria",
] as const;

export type CompetencyId = (typeof COMPETENCY_IDS)[number];
export type HumanRating = "effective" | "partially-effective" | "not-yet-effective";
export type OverallEvaluationRating = HumanRating | "unavailable";
export type BaselineKind = "measured-baseline" | "credible-baseline-plan" | "missing";
export type ResponseMode = "build" | "pilot" | "buy" | "data-collection" | "no-build";
export type CaseLifecycleState =
  | "draft"
  | "needs-validation"
  | "needs-calibration"
  | "ready-for-approval"
  | "published";
export type AssignmentLifecycleState =
  | "provisioning"
  | "active"
  | "review-requested"
  | "submitted"
  | "reopened"
  | "closed";

export interface CompetencyJudgment {
  readonly rating: HumanRating;
  readonly rationale: string;
}

export interface EvaluationDraft {
  readonly competencies: Readonly<Record<CompetencyId, CompetencyJudgment>>;
  readonly overallRationale: string;
}

export interface AcceptedSubmissionProjection {
  readonly assignmentId: string;
  readonly attemptNumber: number;
  readonly caseVersionDigest: `sha256:${string}`;
  readonly submissionId: string;
  readonly submissionDigest: `sha256:${string}`;
  readonly responseMode: ResponseMode;
  readonly responseSummary: string;
  readonly baselineKind: BaselineKind;
  readonly baselineDetail: string;
  readonly projectionDigest: `sha256:${string}`;
  readonly source: "accepted-submission-readback";
}

export interface AssignmentAttemptBinding {
  readonly assignmentId: string;
  readonly attemptNumber: number;
  readonly caseVersionDigest: `sha256:${string}`;
}

export interface EvaluationPreview {
  readonly overallRating: OverallEvaluationRating;
  readonly canSave: boolean;
  readonly issues: readonly string[];
  readonly method: "human-four-competency-derivation";
  readonly canonicalAnswerCompared: false;
}

export interface StaffEvaluationRecord extends EvaluationDraft {
  readonly assignmentId: string;
  readonly attemptNumber: number;
  readonly caseVersionDigest: `sha256:${string}`;
  readonly submissionId: string;
  readonly submissionDigest: `sha256:${string}`;
  readonly responseMode: ResponseMode;
  readonly responseSummary: string;
  readonly baselineKind: BaselineKind;
  readonly baselineDetail: string;
  readonly acceptedSubmissionProjectionDigest: `sha256:${string}`;
  readonly evaluationId: string;
  readonly operationId: string;
  readonly evaluatorGithubUserId: string;
  readonly evaluatedAt: string;
  readonly overallRating: HumanRating;
  readonly method: "human-four-competency-derivation";
  readonly canonicalAnswerCompared: false;
}

export interface StaffViewer {
  readonly githubUserId: string | null;
  readonly role: "anonymous" | "student" | "staff";
  readonly authorizedAssignmentIds: readonly string[];
  readonly blindAssignmentIds: readonly string[];
  readonly acceptedAttemptOneAssignmentIds: readonly string[];
}

export interface OfficialTimelineEvent {
  readonly assignmentId: string;
  readonly attemptNumber: number;
  readonly caseVersionDigest: `sha256:${string}`;
  readonly sequence: number;
  readonly eventId: string;
  readonly kind:
    | "action"
    | "evidence-released"
    | "decision"
    | "estimate"
    | "review-request"
    | "review-response"
    | "intervention"
    | "submission"
    | "provider-replay"
    | "reopened"
    | "state-transition";
  readonly occurredAt: string;
  readonly actorLabel: string;
  readonly title: string;
  readonly detail: string;
  readonly officialFactIds: readonly string[];
  readonly releasedEvidenceIds: readonly string[];
  readonly source: "official-event-store";
  readonly officialEventReceiptId: string;
}

export interface TrustedOfficialEventReceipt {
  readonly receiptId: string;
  readonly eventId: string;
  readonly assignmentId: string;
  readonly attemptNumber: number;
  readonly caseVersionDigest: `sha256:${string}`;
  readonly sequence: number;
  readonly eventDigest: `sha256:${string}`;
  readonly source: "official-event-store-readback";
}

export interface StaffAssignmentSource {
  readonly assignmentId: string;
  readonly caseId: string;
  readonly caseTitle: string;
  readonly studentLabel: string;
  readonly caseVersionDigest: string;
  readonly attemptNumber: number;
  readonly lifecycleState: AssignmentLifecycleState;
  readonly repositoryReadback: "pending" | "ready" | "failed";
  readonly timeline: readonly unknown[];
  readonly officialEventReceipts: readonly unknown[];
  readonly hiddenEvaluationAnchor?: string;
  readonly privateAgentTranscript?: string;
}

export type StaffAssignmentView =
  | {
      readonly allowed: false;
      readonly reason: "not-found-or-not-authorized";
    }
  | {
      readonly allowed: true;
      readonly assignment: {
        readonly assignmentId: string;
        readonly caseId: string;
        readonly caseTitle: string;
        readonly studentLabel: string;
        readonly caseVersionDigest: string;
        readonly attemptNumber: number;
        readonly lifecycleState: AssignmentLifecycleState;
        readonly repositoryReadback: "pending" | "ready" | "failed";
        readonly stateAuthority: "persisted-service-and-provider-readback";
        readonly timeline: readonly OfficialTimelineEvent[];
      };
    };

export interface ReviewRequestRecord {
  readonly reviewRequestId: string;
  readonly assignmentId: string;
  readonly attemptNumber: number;
  readonly status: "open" | "closed";
  readonly studentSandboxAvailable: boolean;
}

export interface ReviewResponseRecord {
  readonly reviewResponseId: string;
  readonly operationId: string;
  readonly reviewRequestId: string;
  readonly assignmentId: string;
  readonly attemptNumber: number;
  readonly responderGithubUserId: string;
  readonly responseText: string;
  readonly respondedAt: string;
  readonly blocksSandboxWork: false;
}

export interface ProviderDisplayRecord {
  readonly assignmentId: string;
  readonly attemptNumber: number;
  readonly caseVersionDigest: `sha256:${string}`;
  readonly eventId: string;
  readonly eventSequence: number;
  readonly providerRecordReceiptId: string;
  readonly interactionId: string;
  readonly providerId: string;
  readonly modelId: string;
  readonly routeId: string;
  readonly officialFactIds: readonly string[];
  readonly releasedEvidenceIds: readonly string[];
  readonly renderedText: string;
  readonly renderedTextIsAuthoritative: false;
  readonly replayOfInteractionId?: string;
}

export interface TrustedProviderRecordReceipt {
  readonly receiptId: string;
  readonly interactionId: string;
  readonly assignmentId: string;
  readonly attemptNumber: number;
  readonly caseVersionDigest: `sha256:${string}`;
  readonly eventId: string;
  readonly eventSequence: number;
  readonly recordDigest: `sha256:${string}`;
  readonly source: "provider-record-store-readback";
}

export interface ReplayComparisonView {
  readonly original: ProviderDisplayRecord;
  readonly replay: ProviderDisplayRecord;
  readonly evaluation: StaffEvaluationRecord;
  readonly evaluationChanged: false;
  readonly truthChanged: false;
}

export interface EvaluatedAttemptSnapshot {
  readonly assignmentId: string;
  readonly caseVersionDigest: string;
  readonly attemptNumber: number;
  readonly status: "submitted" | "closed";
  readonly submissionId: string;
  readonly submissionDigest: `sha256:${string}`;
  readonly evaluation: StaffEvaluationRecord;
}

export interface ReopenResult {
  readonly operationId: string;
  readonly assignmentState: "reopened";
  readonly previous: EvaluatedAttemptSnapshot;
  readonly next: {
    readonly assignmentId: string;
    readonly caseVersionDigest: string;
    readonly attemptNumber: number;
    readonly status: "active";
    readonly openedAt: string;
    readonly reopenedFromAttempt: number;
    readonly submissionId?: never;
    readonly evaluation?: never;
  };
}

export type TextArtifactContentType =
  | "text/html"
  | "image/svg+xml"
  | "text/markdown"
  | "application/json"
  | "text/csv";

export interface TextArtifact {
  readonly artifactId: string;
  readonly relativePath: string;
  readonly contentType: TextArtifactContentType;
  readonly digest: `sha256:${string}`;
  readonly content: string;
}

export interface SubmissionArtifactReceipt {
  readonly receiptId: string;
  readonly assignmentId: string;
  readonly attemptNumber: number;
  readonly caseVersionDigest: `sha256:${string}`;
  readonly submissionId: string;
  readonly submissionDigest: `sha256:${string}`;
  readonly artifactId: string;
  readonly relativePath: string;
  readonly contentType: TextArtifactContentType;
  readonly byteLength: number;
  readonly digest: `sha256:${string}`;
  readonly source: "submission-artifact-store-readback";
}

export interface InertArtifactView {
  readonly assignmentId: string;
  readonly attemptNumber: number;
  readonly submissionId: string;
  readonly artifactId: string;
  readonly relativePath: string;
  readonly contentType: TextArtifactContentType;
  readonly digest: `sha256:${string}`;
  readonly displayMode: "plain-text";
  readonly text: string;
  readonly executable: false;
  readonly remoteResourcesAllowed: false;
}

export interface AcceptedSubmissionBinding extends AssignmentAttemptBinding {
  readonly submissionId: string;
  readonly submissionDigest: `sha256:${string}`;
}

const officialEventKinds = new Set<OfficialTimelineEvent["kind"]>([
  "action",
  "evidence-released",
  "decision",
  "estimate",
  "review-request",
  "review-response",
  "intervention",
  "submission",
  "provider-replay",
  "reopened",
  "state-transition",
]);
const humanRatings = new Set<HumanRating>([
  "effective",
  "partially-effective",
  "not-yet-effective",
]);
const baselineKinds = new Set<BaselineKind>([
  "measured-baseline",
  "credible-baseline-plan",
  "missing",
]);
const responseModes = new Set<ResponseMode>([
  "build",
  "pilot",
  "buy",
  "data-collection",
  "no-build",
]);
const assignmentLifecycleStates = new Set<AssignmentLifecycleState>([
  "provisioning",
  "active",
  "review-requested",
  "submitted",
  "reopened",
  "closed",
]);
const repositoryReadbackStates = new Set<StaffAssignmentSource["repositoryReadback"]>([
  "pending",
  "ready",
  "failed",
]);
const textArtifactTypes = new Set<TextArtifactContentType>([
  "text/html",
  "image/svg+xml",
  "text/markdown",
  "application/json",
  "text/csv",
]);
const operationIdPattern = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/u;
const sha256Pattern = /^sha256:[a-f0-9]{64}$/u;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundedText(value: unknown, maximum: number): string | undefined {
  return typeof value === "string" && value.length > 0 && value.length <= maximum
    ? value
    : undefined;
}

function stringList(value: unknown, maximumItems: number): readonly string[] | undefined {
  if (!Array.isArray(value) || value.length > maximumItems) return undefined;
  const strings = value.filter(
    (item): item is string => typeof item === "string" && item.length > 0 && item.length <= 160,
  );
  return strings.length === value.length ? strings : undefined;
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}

function immutableCopy<T>(value: T): T {
  return deepFreeze(structuredClone(value));
}

function assertOperationId(operationId: string): void {
  if (operationId.length > 160 || !operationIdPattern.test(operationId)) {
    throw new Error("Operation IDs must be bounded stable lowercase identifiers");
  }
}

function validIdentifier(value: unknown): value is string {
  return typeof value === "string" && value.length <= 160 && operationIdPattern.test(value);
}

function validSha256(value: unknown): value is `sha256:${string}` {
  return typeof value === "string" && sha256Pattern.test(value);
}

function positiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1;
}

function validateJudgments(competencies: unknown): string[] {
  const issues: string[] = [];
  if (!isRecord(competencies)) {
    return ["All four competency judgments are required exactly once."];
  }
  const keys = Object.keys(competencies);
  if (
    keys.length !== COMPETENCY_IDS.length ||
    !COMPETENCY_IDS.every((competencyId) => keys.includes(competencyId))
  ) {
    issues.push("All four competency judgments are required exactly once.");
  }
  for (const competencyId of COMPETENCY_IDS) {
    const judgment = competencies[competencyId];
    if (!isRecord(judgment) || !humanRatings.has(judgment.rating as HumanRating)) {
      issues.push(`${competencyId} needs a human rating.`);
      continue;
    }
    if (boundedText(judgment.rationale, 10_000)?.trim().length === 0 || boundedText(judgment.rationale, 10_000) === undefined) {
      issues.push(`${competencyId} needs a bounded human rationale.`);
    }
  }
  return issues;
}

export function acceptedSubmissionProjectionDigest(
  projection: Omit<AcceptedSubmissionProjection, "projectionDigest">,
): `sha256:${string}` {
  return sha256TextDigest(
    JSON.stringify([
      projection.assignmentId,
      projection.attemptNumber,
      projection.caseVersionDigest,
      projection.submissionId,
      projection.submissionDigest,
      projection.responseMode,
      projection.responseSummary,
      projection.baselineKind,
      projection.baselineDetail,
      projection.source,
    ]),
  );
}

function projectAcceptedSubmission(input: AcceptedSubmissionProjection): AcceptedSubmissionProjection {
  if (
    !isRecord(input) ||
    !validIdentifier(input.assignmentId) ||
    !Number.isSafeInteger(input.attemptNumber) ||
    input.attemptNumber < 1 ||
    !sha256Pattern.test(input.caseVersionDigest) ||
    !validIdentifier(input.submissionId) ||
    !sha256Pattern.test(input.submissionDigest) ||
    !responseModes.has(input.responseMode) ||
    boundedText(input.responseSummary, 10_000)?.trim().length === 0 ||
    boundedText(input.responseSummary, 10_000) === undefined ||
    !baselineKinds.has(input.baselineKind) ||
    typeof input.baselineDetail !== "string" ||
    input.baselineDetail.length > 10_000 ||
    input.source !== "accepted-submission-readback" ||
    !sha256Pattern.test(input.projectionDigest)
  ) {
    throw new Error("The accepted submission projection is invalid or unbounded");
  }
  if (
    input.baselineKind !== "missing" &&
    (input.baselineDetail.trim().length === 0 || input.baselineDetail.length > 10_000)
  ) {
    throw new Error("The accepted submission baseline readback is incomplete");
  }
  const projected = {
    assignmentId: input.assignmentId,
    attemptNumber: input.attemptNumber,
    caseVersionDigest: input.caseVersionDigest,
    submissionId: input.submissionId,
    submissionDigest: input.submissionDigest,
    responseMode: input.responseMode,
    responseSummary: input.responseSummary,
    baselineKind: input.baselineKind,
    baselineDetail: input.baselineDetail,
    projectionDigest: input.projectionDigest,
    source: input.source,
  };
  if (acceptedSubmissionProjectionDigest(projected) !== projected.projectionDigest) {
    throw new Error("The accepted submission projection digest does not match its contents");
  }
  return immutableCopy(projected);
}

export function previewHumanEvaluation(
  acceptedSubmissionInput: AcceptedSubmissionProjection,
  draft: EvaluationDraft,
): EvaluationPreview {
  let acceptedSubmission: AcceptedSubmissionProjection;
  try {
    acceptedSubmission = projectAcceptedSubmission(acceptedSubmissionInput);
  } catch {
    return {
      overallRating: "unavailable",
      canSave: false,
      issues: ["A verified immutable accepted-submission readback is required."],
      method: "human-four-competency-derivation",
      canonicalAnswerCompared: false,
    };
  }
  if (!isRecord(draft)) {
    return {
      overallRating: "unavailable",
      canSave: false,
      issues: ["The evaluation draft is invalid."],
      method: "human-four-competency-derivation",
      canonicalAnswerCompared: false,
    };
  }
  const competencies = isRecord(draft.competencies)
    ? (draft.competencies as unknown as Readonly<Record<CompetencyId, CompetencyJudgment>>)
    : undefined;
  const issues = validateJudgments(competencies);
  const draftKeys = Object.keys(draft);
  if (
    draftKeys.length !== 2 ||
    !draftKeys.includes("competencies") ||
    !draftKeys.includes("overallRationale")
  ) {
    issues.push("Evaluation input must not supply or replace accepted-submission response facts.");
  }
  if (boundedText(draft.overallRationale, 10_000)?.trim().length === 0 || boundedText(draft.overallRationale, 10_000) === undefined) {
    issues.push("An overall human rationale is required.");
  }
  const hasBaseline = acceptedSubmission.baselineKind !== "missing";
  if (!hasBaseline) {
    if (competencies?.["evidence-sufficiency"]?.rating === "effective") {
      issues.push("Evidence sufficiency cannot be effective without a baseline or credible plan.");
    }
    if (competencies?.["objective-success-criteria"]?.rating === "effective") {
      issues.push("Objective success criteria cannot be effective without a baseline or credible plan.");
    }
  }
  if (issues.length > 0) {
    return {
      overallRating: "unavailable",
      canSave: false,
      issues,
      method: "human-four-competency-derivation",
      canonicalAnswerCompared: false,
    };
  }
  const overallRating = deriveOverallHumanRating(competencies!);
  return {
    overallRating,
    canSave: true,
    issues: [],
    method: "human-four-competency-derivation",
    canonicalAnswerCompared: false,
  };
}

export function createHumanEvaluation(input: {
  readonly evaluationId: string;
  readonly operationId: string;
  readonly evaluatorGithubUserId: string;
  readonly evaluatedAt: string;
  readonly acceptedSubmission: AcceptedSubmissionProjection;
  readonly draft: EvaluationDraft;
}): StaffEvaluationRecord {
  assertOperationId(input.operationId);
  const acceptedSubmission = projectAcceptedSubmission(input.acceptedSubmission);
  const preview = previewHumanEvaluation(acceptedSubmission, input.draft);
  if (!preview.canSave || preview.overallRating === "unavailable") {
    throw new Error(preview.issues.join(" "));
  }
  if (!/^\d+$/u.test(input.evaluatorGithubUserId)) {
    throw new Error("The evaluator must use an immutable numeric GitHub identity");
  }
  if (!validIdentifier(input.evaluationId)) {
    throw new Error("The evaluation ID is invalid");
  }
  if (!Number.isFinite(Date.parse(input.evaluatedAt))) {
    throw new Error("The evaluation must use server time");
  }
  const competencies = input.draft.competencies;
  return immutableCopy({
    assignmentId: acceptedSubmission.assignmentId,
    attemptNumber: acceptedSubmission.attemptNumber,
    caseVersionDigest: acceptedSubmission.caseVersionDigest,
    submissionId: acceptedSubmission.submissionId,
    submissionDigest: acceptedSubmission.submissionDigest,
    responseMode: acceptedSubmission.responseMode,
    responseSummary: acceptedSubmission.responseSummary,
    baselineKind: acceptedSubmission.baselineKind,
    baselineDetail: acceptedSubmission.baselineDetail,
    acceptedSubmissionProjectionDigest: acceptedSubmission.projectionDigest,
    competencies: {
      "problem-viability": { ...competencies["problem-viability"] },
      "evidence-sufficiency": { ...competencies["evidence-sufficiency"] },
      "response-feasibility": { ...competencies["response-feasibility"] },
      "objective-success-criteria": { ...competencies["objective-success-criteria"] },
    },
    overallRationale: input.draft.overallRationale,
    evaluationId: input.evaluationId,
    operationId: input.operationId,
    evaluatorGithubUserId: input.evaluatorGithubUserId,
    evaluatedAt: input.evaluatedAt,
    overallRating: preview.overallRating,
    method: preview.method,
    canonicalAnswerCompared: false,
  });
}

export function officialTimelineEventDigest(event: OfficialTimelineEvent): `sha256:${string}` {
  return sha256TextDigest(
    JSON.stringify([
      event.eventId,
      event.assignmentId,
      event.attemptNumber,
      event.caseVersionDigest,
      event.sequence,
      event.kind,
      event.occurredAt,
      event.actorLabel,
      event.title,
      event.detail,
      [...event.officialFactIds],
      [...event.releasedEvidenceIds],
      event.source,
      event.officialEventReceiptId,
    ]),
  );
}

function trustedReceiptRegistry(
  receipts: readonly unknown[],
  binding: AssignmentAttemptBinding,
): ReadonlyMap<string, TrustedOfficialEventReceipt> {
  const registry = new Map<string, TrustedOfficialEventReceipt>();
  const eventIds = new Set<string>();
  const sequences = new Set<number>();
  for (const candidate of receipts) {
    if (
      !isRecord(candidate) ||
      !validIdentifier(candidate.receiptId) ||
      !validIdentifier(candidate.eventId) ||
      !validIdentifier(candidate.assignmentId) ||
      !positiveSafeInteger(candidate.attemptNumber) ||
      !validSha256(candidate.caseVersionDigest) ||
      !positiveSafeInteger(candidate.sequence) ||
      !validSha256(candidate.eventDigest) ||
      candidate.source !== "official-event-store-readback"
    ) {
      continue;
    }
    if (
      candidate.assignmentId !== binding.assignmentId ||
      candidate.attemptNumber !== binding.attemptNumber ||
      candidate.caseVersionDigest !== binding.caseVersionDigest
    ) {
      throw new Error("Official event receipt belongs to another assignment attempt");
    }
    if (
      registry.has(candidate.receiptId) ||
      eventIds.has(candidate.eventId) ||
      sequences.has(candidate.sequence)
    ) {
      throw new Error("Official event receipts contain a duplicate receipt, event, or sequence");
    }
    registry.set(candidate.receiptId, {
      receiptId: candidate.receiptId,
      eventId: candidate.eventId,
      assignmentId: candidate.assignmentId,
      attemptNumber: candidate.attemptNumber,
      caseVersionDigest: candidate.caseVersionDigest,
      sequence: candidate.sequence,
      eventDigest: candidate.eventDigest,
      source: candidate.source,
    });
    eventIds.add(candidate.eventId);
    sequences.add(candidate.sequence);
  }
  return registry;
}

export function selectOfficialTimeline(
  events: readonly unknown[],
  trustedReceipts: readonly unknown[],
  binding: AssignmentAttemptBinding,
): readonly OfficialTimelineEvent[] {
  if (
    !isRecord(binding) ||
    !validIdentifier(binding.assignmentId) ||
    !Number.isSafeInteger(binding.attemptNumber) ||
    binding.attemptNumber < 1 ||
    !sha256Pattern.test(binding.caseVersionDigest)
  ) {
    throw new Error("Official timeline binding is invalid");
  }
  const receiptRegistry = trustedReceiptRegistry(trustedReceipts, binding);
  const result: OfficialTimelineEvent[] = [];
  const eventIds = new Set<string>();
  const receiptIds = new Set<string>();
  const sequences = new Set<number>();
  for (const candidate of events) {
    if (
      !isRecord(candidate) ||
      candidate.source !== "official-event-store" ||
      !validIdentifier(candidate.officialEventReceiptId) ||
      !officialEventKinds.has(candidate.kind as OfficialTimelineEvent["kind"])
    ) {
      continue;
    }
    const eventId = boundedText(candidate.eventId, 160);
    const assignmentId = boundedText(candidate.assignmentId, 160);
    const attemptNumber = positiveSafeInteger(candidate.attemptNumber)
      ? candidate.attemptNumber
      : undefined;
    const caseVersionDigest = validSha256(candidate.caseVersionDigest)
      ? candidate.caseVersionDigest
      : undefined;
    const sequence = positiveSafeInteger(candidate.sequence) ? candidate.sequence : undefined;
    const occurredAt = boundedText(candidate.occurredAt, 80);
    const actorLabel = boundedText(candidate.actorLabel, 160);
    const title = boundedText(candidate.title, 500);
    const detail = boundedText(candidate.detail, 10_000);
    const officialFactIds = stringList(candidate.officialFactIds, 100);
    const releasedEvidenceIds = stringList(candidate.releasedEvidenceIds, 100);
    if (
      eventId === undefined ||
      assignmentId === undefined ||
      attemptNumber === undefined ||
      caseVersionDigest === undefined ||
      sequence === undefined ||
      occurredAt === undefined ||
      actorLabel === undefined ||
      title === undefined ||
      detail === undefined ||
      officialFactIds === undefined ||
      releasedEvidenceIds === undefined
    ) {
      continue;
    }
    if (
      assignmentId !== binding.assignmentId ||
      attemptNumber !== binding.attemptNumber ||
      caseVersionDigest !== binding.caseVersionDigest
    ) {
      throw new Error("Official event belongs to another assignment attempt");
    }
    if (
      eventIds.has(eventId) ||
      receiptIds.has(candidate.officialEventReceiptId) ||
      sequences.has(sequence)
    ) {
      throw new Error("Official timeline contains a duplicate receipt, event, or sequence");
    }
    const projected: OfficialTimelineEvent = {
      assignmentId,
      attemptNumber,
      caseVersionDigest,
      sequence,
      eventId,
      kind: candidate.kind as OfficialTimelineEvent["kind"],
      occurredAt,
      actorLabel,
      title,
      detail,
      officialFactIds: [...officialFactIds],
      releasedEvidenceIds: [...releasedEvidenceIds],
      source: candidate.source,
      officialEventReceiptId: candidate.officialEventReceiptId,
    };
    const receipt = receiptRegistry.get(projected.officialEventReceiptId);
    if (
      receipt === undefined ||
      receipt.eventId !== projected.eventId ||
      receipt.assignmentId !== projected.assignmentId ||
      receipt.attemptNumber !== projected.attemptNumber ||
      receipt.caseVersionDigest !== projected.caseVersionDigest ||
      receipt.sequence !== projected.sequence ||
      receipt.eventDigest !== officialTimelineEventDigest(projected)
    ) {
      continue;
    }
    result.push(projected);
    eventIds.add(projected.eventId);
    receiptIds.add(projected.officialEventReceiptId);
    sequences.add(projected.sequence);
  }
  return immutableCopy(result.sort((left, right) => left.sequence - right.sequence));
}

export function buildStaffAssignmentView(
  viewer: StaffViewer,
  requestedAssignmentId: string,
  assignments: readonly StaffAssignmentSource[],
): StaffAssignmentView {
  if (
    !isRecord(viewer) ||
    !validIdentifier(requestedAssignmentId) ||
    !Array.isArray(viewer.authorizedAssignmentIds) ||
    !Array.isArray(viewer.blindAssignmentIds) ||
    !Array.isArray(viewer.acceptedAttemptOneAssignmentIds)
  ) {
    return { allowed: false, reason: "not-found-or-not-authorized" };
  }
  const authorized = viewer.authorizedAssignmentIds.includes(requestedAssignmentId);
  const blind =
    viewer.blindAssignmentIds.includes(requestedAssignmentId) &&
    !viewer.acceptedAttemptOneAssignmentIds.includes(requestedAssignmentId);
  if (viewer.role !== "staff" || viewer.githubUserId === null || !authorized || blind) {
    return { allowed: false, reason: "not-found-or-not-authorized" };
  }
  const source = assignments.find(({ assignmentId }) => assignmentId === requestedAssignmentId);
  if (
    source === undefined ||
    !validIdentifier(source.assignmentId) ||
    !validIdentifier(source.caseId) ||
    boundedText(source.caseTitle, 500) === undefined ||
    boundedText(source.studentLabel, 160) === undefined ||
    !sha256Pattern.test(source.caseVersionDigest) ||
    !Number.isInteger(source.attemptNumber) ||
    source.attemptNumber < 1 ||
    !assignmentLifecycleStates.has(source.lifecycleState) ||
    !repositoryReadbackStates.has(source.repositoryReadback) ||
    !Array.isArray(source.timeline) ||
    !Array.isArray(source.officialEventReceipts)
  ) {
    return { allowed: false, reason: "not-found-or-not-authorized" };
  }
  return immutableCopy({
    allowed: true as const,
    assignment: {
      assignmentId: source.assignmentId,
      caseId: source.caseId,
      caseTitle: source.caseTitle,
      studentLabel: source.studentLabel,
      caseVersionDigest: source.caseVersionDigest,
      attemptNumber: source.attemptNumber,
      lifecycleState: source.lifecycleState,
      repositoryReadback: source.repositoryReadback,
      stateAuthority: "persisted-service-and-provider-readback" as const,
      timeline: selectOfficialTimeline(source.timeline, source.officialEventReceipts, {
        assignmentId: source.assignmentId,
        attemptNumber: source.attemptNumber,
        caseVersionDigest: source.caseVersionDigest as `sha256:${string}`,
      }),
    },
  });
}

export function createReviewResponse(
  request: ReviewRequestRecord,
  input: {
    readonly reviewResponseId: string;
    readonly operationId: string;
    readonly assignmentId: string;
    readonly attemptNumber: number;
    readonly responderGithubUserId: string;
    readonly responseText: string;
    readonly respondedAt: string;
  },
  trustedExistingResponses: readonly ReviewResponseRecord[],
): ReviewResponseRecord {
  assertOperationId(input.operationId);
  if (
    !validIdentifier(input.reviewResponseId) ||
    !validIdentifier(request.reviewRequestId) ||
    !validIdentifier(request.assignmentId) ||
    !positiveSafeInteger(request.attemptNumber) ||
    request.status !== "open" ||
    request.studentSandboxAvailable !== true
  ) {
    throw new Error("The review request is not open with an available student sandbox");
  }
  if (
    input.assignmentId !== request.assignmentId ||
    input.attemptNumber !== request.attemptNumber
  ) {
    throw new Error("The review response belongs to another assignment attempt");
  }
  if (!Array.isArray(trustedExistingResponses)) {
    throw new Error("Trusted review response readback is required");
  }
  if (
    trustedExistingResponses.some(
      (existing) =>
        existing.reviewRequestId === request.reviewRequestId ||
        existing.reviewResponseId === input.reviewResponseId ||
        existing.operationId === input.operationId,
    )
  ) {
    throw new Error("The review request already has a response or reuses a stored identity");
  }
  if (!/^\d+$/u.test(input.responderGithubUserId)) {
    throw new Error("The responder must use an immutable numeric GitHub identity");
  }
  if (
    boundedText(input.responseText, 10_000)?.trim().length === 0 ||
    boundedText(input.responseText, 10_000) === undefined
  ) {
    throw new Error("A bounded review response is required");
  }
  if (!Number.isFinite(Date.parse(input.respondedAt))) {
    throw new Error("The review response must use server time");
  }
  return immutableCopy({
    reviewResponseId: input.reviewResponseId,
    operationId: input.operationId,
    reviewRequestId: request.reviewRequestId,
    assignmentId: input.assignmentId,
    attemptNumber: input.attemptNumber,
    responderGithubUserId: input.responderGithubUserId,
    responseText: input.responseText,
    respondedAt: input.respondedAt,
    blocksSandboxWork: false as const,
  });
}

export function buildReplayComparison(
  original: ProviderDisplayRecord,
  replay: ProviderDisplayRecord,
  evaluation: StaffEvaluationRecord,
  trustedReceipts: readonly TrustedProviderRecordReceipt[],
): ReplayComparisonView {
  const evaluationView = projectEvaluationRecord(evaluation);
  const originalView = projectProviderRecord(original);
  const replayView = projectProviderRecord(replay);
  const receiptRegistry = trustedProviderReceiptRegistry(trustedReceipts);
  assertTrustedProviderRecord(originalView, receiptRegistry);
  assertTrustedProviderRecord(replayView, receiptRegistry);
  if (originalView.interactionId === replayView.interactionId) {
    throw new Error("Replay must create a distinct provider interaction");
  }
  if (
    replayView.replayOfInteractionId !== originalView.interactionId
  ) {
    throw new Error("The replay is not linked to this original interaction");
  }
  if (
    originalView.assignmentId !== replayView.assignmentId ||
    originalView.assignmentId !== evaluationView.assignmentId ||
    originalView.attemptNumber !== replayView.attemptNumber ||
    originalView.attemptNumber !== evaluationView.attemptNumber ||
    originalView.caseVersionDigest !== replayView.caseVersionDigest ||
    originalView.caseVersionDigest !== evaluationView.caseVersionDigest ||
    originalView.eventId !== replayView.eventId ||
    originalView.eventSequence !== replayView.eventSequence ||
    replayView.routeId !== originalView.routeId ||
    JSON.stringify([...replayView.officialFactIds].sort()) !==
      JSON.stringify([...originalView.officialFactIds].sort()) ||
    JSON.stringify([...replayView.releasedEvidenceIds].sort()) !==
      JSON.stringify([...originalView.releasedEvidenceIds].sort())
  ) {
    throw new Error("Replay cannot change official truth or released evidence");
  }
  return immutableCopy({
    original: originalView,
    replay: replayView,
    evaluation: evaluationView,
    evaluationChanged: false as const,
    truthChanged: false as const,
  });
}

export function providerRecordDigest(record: ProviderDisplayRecord): `sha256:${string}` {
  return sha256TextDigest(
    JSON.stringify([
      record.assignmentId,
      record.attemptNumber,
      record.caseVersionDigest,
      record.eventId,
      record.eventSequence,
      record.providerRecordReceiptId,
      record.interactionId,
      record.providerId,
      record.modelId,
      record.routeId,
      [...record.officialFactIds],
      [...record.releasedEvidenceIds],
      record.renderedText,
      record.renderedTextIsAuthoritative,
      record.replayOfInteractionId ?? null,
    ]),
  );
}

function trustedProviderReceiptRegistry(
  receipts: readonly TrustedProviderRecordReceipt[],
): ReadonlyMap<string, TrustedProviderRecordReceipt> {
  if (!Array.isArray(receipts)) throw new Error("Trusted provider receipt readback is required");
  const registry = new Map<string, TrustedProviderRecordReceipt>();
  const interactions = new Set<string>();
  for (const candidate of receipts) {
    if (
      !isRecord(candidate) ||
      !validIdentifier(candidate.receiptId) ||
      !validIdentifier(candidate.interactionId) ||
      !validIdentifier(candidate.assignmentId) ||
      !positiveSafeInteger(candidate.attemptNumber) ||
      !validSha256(candidate.caseVersionDigest) ||
      !validIdentifier(candidate.eventId) ||
      !positiveSafeInteger(candidate.eventSequence) ||
      !validSha256(candidate.recordDigest) ||
      candidate.source !== "provider-record-store-readback"
    ) {
      throw new Error("Trusted provider receipt readback is invalid");
    }
    const receipt: TrustedProviderRecordReceipt = {
      receiptId: candidate.receiptId,
      interactionId: candidate.interactionId,
      assignmentId: candidate.assignmentId,
      attemptNumber: candidate.attemptNumber,
      caseVersionDigest: candidate.caseVersionDigest,
      eventId: candidate.eventId,
      eventSequence: candidate.eventSequence,
      recordDigest: candidate.recordDigest,
      source: candidate.source,
    };
    if (registry.has(receipt.receiptId) || interactions.has(receipt.interactionId)) {
      throw new Error("Trusted provider receipt readback contains a duplicate identity");
    }
    registry.set(receipt.receiptId, immutableCopy(receipt));
    interactions.add(receipt.interactionId);
  }
  return registry;
}

function assertTrustedProviderRecord(
  record: ProviderDisplayRecord,
  receipts: ReadonlyMap<string, TrustedProviderRecordReceipt>,
): void {
  const receipt = receipts.get(record.providerRecordReceiptId);
  if (
    receipt === undefined ||
    receipt.interactionId !== record.interactionId ||
    receipt.assignmentId !== record.assignmentId ||
    receipt.attemptNumber !== record.attemptNumber ||
    receipt.caseVersionDigest !== record.caseVersionDigest ||
    receipt.eventId !== record.eventId ||
    receipt.eventSequence !== record.eventSequence ||
    receipt.recordDigest !== providerRecordDigest(record)
  ) {
    throw new Error("Provider record does not match its trusted readback receipt");
  }
}

function projectProviderRecord(record: ProviderDisplayRecord): ProviderDisplayRecord {
  const officialFactIds = stringList(record.officialFactIds, 100);
  const releasedEvidenceIds = stringList(record.releasedEvidenceIds, 100);
  if (
    !validIdentifier(record.assignmentId) ||
    !Number.isSafeInteger(record.attemptNumber) ||
    record.attemptNumber < 1 ||
    !sha256Pattern.test(record.caseVersionDigest) ||
    !validIdentifier(record.eventId) ||
    !Number.isSafeInteger(record.eventSequence) ||
    record.eventSequence < 1 ||
    !validIdentifier(record.providerRecordReceiptId) ||
    !validIdentifier(record.interactionId) ||
    !validIdentifier(record.providerId) ||
    !validIdentifier(record.modelId) ||
    !validIdentifier(record.routeId) ||
    officialFactIds === undefined ||
    releasedEvidenceIds === undefined ||
    new Set(officialFactIds).size !== officialFactIds.length ||
    new Set(releasedEvidenceIds).size !== releasedEvidenceIds.length ||
    boundedText(record.renderedText, 10_000) === undefined ||
    record.renderedTextIsAuthoritative !== false ||
    (record.replayOfInteractionId !== undefined &&
      !validIdentifier(record.replayOfInteractionId))
  ) {
    throw new Error("The provider record is invalid or unbounded");
  }
  return immutableCopy({
    assignmentId: record.assignmentId,
    attemptNumber: record.attemptNumber,
    caseVersionDigest: record.caseVersionDigest,
    eventId: record.eventId,
    eventSequence: record.eventSequence,
    providerRecordReceiptId: record.providerRecordReceiptId,
    interactionId: record.interactionId,
    providerId: record.providerId,
    modelId: record.modelId,
    routeId: record.routeId,
    officialFactIds: [...officialFactIds],
    releasedEvidenceIds: [...releasedEvidenceIds],
    renderedText: record.renderedText,
    renderedTextIsAuthoritative: false as const,
    ...(record.replayOfInteractionId === undefined
      ? {}
      : { replayOfInteractionId: record.replayOfInteractionId }),
  });
}

function projectEvaluationRecord(evaluation: StaffEvaluationRecord): StaffEvaluationRecord {
  const projected = createHumanEvaluation({
    evaluationId: evaluation.evaluationId,
    operationId: evaluation.operationId,
    evaluatorGithubUserId: evaluation.evaluatorGithubUserId,
    evaluatedAt: evaluation.evaluatedAt,
    acceptedSubmission: {
      assignmentId: evaluation.assignmentId,
      attemptNumber: evaluation.attemptNumber,
      caseVersionDigest: evaluation.caseVersionDigest,
      submissionId: evaluation.submissionId,
      submissionDigest: evaluation.submissionDigest,
      responseMode: evaluation.responseMode,
      responseSummary: evaluation.responseSummary,
      baselineKind: evaluation.baselineKind,
      baselineDetail: evaluation.baselineDetail,
      projectionDigest: evaluation.acceptedSubmissionProjectionDigest,
      source: "accepted-submission-readback",
    },
    draft: {
      competencies: evaluation.competencies,
      overallRationale: evaluation.overallRationale,
    },
  });
  if (projected.overallRating !== evaluation.overallRating) {
    throw new Error("The stored overall evaluation contradicts its four human judgments");
  }
  return projected;
}

export function reopenEvaluatedAttempt(
  previousInput: EvaluatedAttemptSnapshot,
  input: { readonly operationId: string; readonly openedAt: string },
): ReopenResult {
  assertOperationId(input.operationId);
  if (
    !validIdentifier(previousInput.assignmentId) ||
    !validIdentifier(previousInput.submissionId) ||
    !sha256Pattern.test(previousInput.caseVersionDigest) ||
    !Number.isSafeInteger(previousInput.attemptNumber) ||
    previousInput.attemptNumber < 1 ||
    previousInput.attemptNumber >= Number.MAX_SAFE_INTEGER ||
    !isRecord(previousInput.evaluation)
  ) {
    throw new Error("The prior attempt identity is invalid");
  }
  if (previousInput.status !== "submitted" && previousInput.status !== "closed") {
    throw new Error("Only a submitted or closed attempt can be reopened");
  }
  if (!sha256Pattern.test(previousInput.submissionDigest)) {
    throw new Error("The immutable submission digest is invalid");
  }
  if (!Number.isFinite(Date.parse(input.openedAt))) {
    throw new Error("Reopening must use server time");
  }
  const evaluation = projectEvaluationRecord(previousInput.evaluation);
  if (
    evaluation.assignmentId !== previousInput.assignmentId ||
    evaluation.attemptNumber !== previousInput.attemptNumber ||
    evaluation.caseVersionDigest !== previousInput.caseVersionDigest ||
    evaluation.submissionId !== previousInput.submissionId ||
    evaluation.submissionDigest !== previousInput.submissionDigest
  ) {
    throw new Error("The prior evaluation is not bound to the accepted attempt snapshot");
  }
  const previous = immutableCopy({
    assignmentId: previousInput.assignmentId,
    caseVersionDigest: previousInput.caseVersionDigest,
    attemptNumber: previousInput.attemptNumber,
    status: previousInput.status,
    submissionId: previousInput.submissionId,
    submissionDigest: previousInput.submissionDigest,
    evaluation,
  });
  return immutableCopy({
    operationId: input.operationId,
    assignmentState: "reopened" as const,
    previous,
    next: {
      assignmentId: previous.assignmentId,
      caseVersionDigest: previous.caseVersionDigest,
      attemptNumber: previous.attemptNumber + 1,
      status: "active" as const,
      openedAt: input.openedAt,
      reopenedFromAttempt: previous.attemptNumber,
    },
  });
}

function validArtifactPath(path: unknown): path is string {
  if (typeof path !== "string" || path.length === 0 || path.length > 512) return false;
  if (path.startsWith("/") || /^[a-z]:\//iu.test(path) || path.includes("\\")) return false;
  if ([...path].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint < 32 || codePoint === 127;
  })) return false;
  return !path.split("/").some((segment) => segment === "" || segment === "." || segment === "..");
}

export function inertArtifactView(
  artifact: TextArtifact,
  trustedReceipt: SubmissionArtifactReceipt,
  expectedSubmission: AcceptedSubmissionBinding,
): InertArtifactView {
  if (!validIdentifier(artifact.artifactId)) throw new Error("Invalid artifact ID");
  if (!textArtifactTypes.has(artifact.contentType)) {
    throw new Error("Unsupported artifact content type");
  }
  if (!sha256Pattern.test(artifact.digest)) throw new Error("Invalid artifact digest");
  if (!validArtifactPath(artifact.relativePath)) {
    throw new Error("Artifact path must stay relative to the verified submission");
  }
  const byteLength = new TextEncoder().encode(artifact.content).byteLength;
  if (byteLength > 200_000) {
    throw new Error("Artifact exceeds the staff preview limit");
  }
  if (sha256TextDigest(artifact.content) !== artifact.digest) {
    throw new Error("Artifact content does not match its verified digest");
  }
  if (
    !isRecord(trustedReceipt) ||
    !validIdentifier(trustedReceipt.receiptId) ||
    !validIdentifier(trustedReceipt.assignmentId) ||
    !Number.isSafeInteger(trustedReceipt.attemptNumber) ||
    trustedReceipt.attemptNumber < 1 ||
    !sha256Pattern.test(trustedReceipt.caseVersionDigest) ||
    !validIdentifier(trustedReceipt.submissionId) ||
    !sha256Pattern.test(trustedReceipt.submissionDigest) ||
    !validIdentifier(trustedReceipt.artifactId) ||
    !validArtifactPath(trustedReceipt.relativePath) ||
    !textArtifactTypes.has(trustedReceipt.contentType) ||
    !Number.isSafeInteger(trustedReceipt.byteLength) ||
    trustedReceipt.byteLength < 0 ||
    trustedReceipt.byteLength > 200_000 ||
    !sha256Pattern.test(trustedReceipt.digest) ||
    trustedReceipt.source !== "submission-artifact-store-readback"
  ) {
    throw new Error("Trusted submission artifact receipt is invalid");
  }
  if (
    !validIdentifier(expectedSubmission.assignmentId) ||
    !Number.isSafeInteger(expectedSubmission.attemptNumber) ||
    expectedSubmission.attemptNumber < 1 ||
    !sha256Pattern.test(expectedSubmission.caseVersionDigest) ||
    !validIdentifier(expectedSubmission.submissionId) ||
    !sha256Pattern.test(expectedSubmission.submissionDigest) ||
    trustedReceipt.assignmentId !== expectedSubmission.assignmentId ||
    trustedReceipt.attemptNumber !== expectedSubmission.attemptNumber ||
    trustedReceipt.caseVersionDigest !== expectedSubmission.caseVersionDigest ||
    trustedReceipt.submissionId !== expectedSubmission.submissionId ||
    trustedReceipt.submissionDigest !== expectedSubmission.submissionDigest ||
    trustedReceipt.artifactId !== artifact.artifactId ||
    trustedReceipt.relativePath !== artifact.relativePath ||
    trustedReceipt.contentType !== artifact.contentType ||
    trustedReceipt.byteLength !== byteLength ||
    trustedReceipt.digest !== artifact.digest
  ) {
    throw new Error("Artifact does not match its immutable submission receipt");
  }
  return immutableCopy({
    assignmentId: trustedReceipt.assignmentId,
    attemptNumber: trustedReceipt.attemptNumber,
    submissionId: trustedReceipt.submissionId,
    artifactId: artifact.artifactId,
    relativePath: artifact.relativePath,
    contentType: artifact.contentType,
    digest: artifact.digest,
    displayMode: "plain-text" as const,
    text: artifact.content,
    executable: false as const,
    remoteResourcesAllowed: false as const,
  });
}

export function neutralizeSpreadsheetFormula(value: string): string {
  const firstVisible = value.trimStart().charAt(0);
  return firstVisible === "=" || firstVisible === "+" || firstVisible === "-" || firstVisible === "@"
    ? `'${value}`
    : value;
}

function csvCell(value: string): string {
  const neutralized = neutralizeSpreadsheetFormula(value);
  return `"${neutralized.replaceAll('"', '""')}"`;
}

export function exportEvaluationCsv(evaluation: StaffEvaluationRecord): string {
  const rows: string[][] = [
    ["field", "rating", "rationale"],
    ...COMPETENCY_IDS.map((competencyId) => [
      competencyId,
      evaluation.competencies[competencyId].rating,
      evaluation.competencies[competencyId].rationale,
    ]),
    ["overall", evaluation.overallRating, evaluation.overallRationale],
  ];
  return rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
}
