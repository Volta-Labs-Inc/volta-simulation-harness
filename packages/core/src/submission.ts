import { createHash } from "node:crypto";
import {
  AttemptSnapshotSchema,
  ProviderProvenanceSchema,
  SubmissionDraftSchema,
  SubmissionRecordSchema,
  type AttemptSnapshot,
  type CalculationRecord,
  type ProviderProvenance,
  type SubmissionDraft,
  type SubmissionRecord,
} from "@volta-sim/contracts";
import { sha256Digest } from "./canonical.js";
import { deepFreeze, type DeepReadonly } from "./immutable.js";
import type { PublishedCase } from "./published-case.js";
import { verifyPublishedCase } from "./published-case.js";
import type { TrustedReleasedState } from "./trusted-state.js";
import { validateTrustedReleasedState } from "./trusted-state.js";

export interface SubmissionCompletenessContext {
  readonly publishedCase: PublishedCase;
  readonly trustedReleasedState: TrustedReleasedState;
}

export interface SubmissionAcceptanceMetadata {
  readonly acceptedAt: string;
  readonly cliVersion: string;
  readonly providerProvenance: readonly ProviderProvenance[];
}

export interface StudentCompletenessReport {
  readonly complete: boolean;
  readonly missing: readonly { readonly path: string; readonly message: string }[];
  readonly requirements: readonly {
    readonly requirementId: string;
    readonly status: "addressed" | "not-yet" | "not-applicable" | "missing";
  }[];
  readonly provenance: {
    readonly citedOfficialFactCount: number;
    readonly unreleasedFactIds: readonly string[];
  };
}

function invalidDraftReport(
  value: unknown,
  context: SubmissionCompletenessContext,
  releasedFactIds: readonly string[],
): StudentCompletenessReport | undefined {
  const parsed = SubmissionDraftSchema.safeParse(value);
  if (parsed.success) return undefined;
  const draft = typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
  const rawAssessments = Array.isArray(draft.requirementAssessments)
    ? draft.requirementAssessments
    : [];
  const assessmentByRequirement = new Map<
    string,
    "addressed" | "not-yet" | "not-applicable"
  >();
  for (const assessment of rawAssessments) {
    if (typeof assessment !== "object" || assessment === null) continue;
    const record = assessment as Record<string, unknown>;
    if (
      typeof record.requirementId === "string" &&
      (record.status === "addressed" ||
        record.status === "not-yet" ||
        record.status === "not-applicable") &&
      typeof record.rationale === "string" &&
      record.rationale.trim() !== ""
    ) {
      assessmentByRequirement.set(record.requirementId, record.status);
    }
  }
  const citedFactIds: string[] = [];
  if (Array.isArray(draft.evidence)) {
    for (const evidence of draft.evidence) {
      if (typeof evidence !== "object" || evidence === null) continue;
      const officialFactId = (evidence as Record<string, unknown>).officialFactId;
      if (typeof officialFactId === "string") citedFactIds.push(officialFactId);
    }
  }
  if (Array.isArray(draft.ledger)) {
    for (const entry of draft.ledger) {
      if (typeof entry !== "object" || entry === null) continue;
      const ids = (entry as Record<string, unknown>).officialFactIds;
      if (Array.isArray(ids)) {
        citedFactIds.push(...ids.filter((id): id is string => typeof id === "string"));
      }
    }
  }
  const released = new Set(releasedFactIds);
  const unreleasedFactIds = [
    ...new Set(citedFactIds.filter((factId) => !released.has(factId))),
  ].sort();
  return {
    complete: false,
    missing: parsed.error.issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message,
    })),
    requirements: context.publishedCase.source.visible.requirements.map(({ id }) => ({
      requirementId: id,
      status: assessmentByRequirement.get(id) ?? "missing",
    })),
    provenance: {
      citedOfficialFactCount: new Set(citedFactIds).size,
      unreleasedFactIds,
    },
  };
}

function calculate(record: CalculationRecord): number | undefined {
  const inputByName = new Map(record.inputs.map((input) => [input.name, input.value]));
  const values = record.formula.inputNames.map((name) => inputByName.get(name));
  if (values.some((value) => value === undefined)) return undefined;
  const numbers = values as number[];
  switch (record.formula.operation) {
    case "sum":
      return numbers.reduce((sum, value) => sum + value, 0);
    case "difference":
      return numbers[0]! - numbers[1]!;
    case "product":
      return numbers.reduce((product, value) => product * value, 1);
    case "quotient":
      return numbers[1] === 0 ? undefined : numbers[0]! / numbers[1]!;
    case "percentage-change":
      return numbers[0] === 0 ? undefined : ((numbers[1]! - numbers[0]!) / Math.abs(numbers[0]!)) * 100;
  }
}

function artifactDigest(content: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(content, "utf8").digest("hex")}`;
}

export function calculationIntegrityIssue(calculation: CalculationRecord): string | undefined {
  const recomputed = calculate(calculation);
  const tolerance = Math.max(1, Math.abs(calculation.result.value)) * Number.EPSILON * 16;
  if (recomputed === undefined || !Number.isFinite(recomputed) || Math.abs(recomputed - calculation.result.value) > tolerance) {
    return "Calculation result must be reproducible from its named inputs and formula";
  }
  const inputUnits = new Set(calculation.inputs.map(({ unit }) => unit));
  if ((calculation.formula.operation === "sum" || calculation.formula.operation === "difference") &&
      (inputUnits.size !== 1 || !inputUnits.has(calculation.result.unit))) {
    return "Sum and difference calculations must use one consistent input and result unit";
  }
  if (calculation.formula.operation === "percentage-change" && calculation.result.unit !== "percent") {
    return "Percentage change results must use the percent unit";
  }
  return undefined;
}

function contentIntegrityIssues(submission: SubmissionDraft): { path: string; message: string }[] {
  const issues: { path: string; message: string }[] = [];
  for (const [index, artifact] of submission.responsePlan.artifactSnapshots.entries()) {
    if (Buffer.byteLength(artifact.content, "utf8") !== artifact.byteLength) {
      issues.push({
        path: `responsePlan.artifactSnapshots.${index}.byteLength`,
        message: "Artifact byte length must match the captured UTF-8 content",
      });
    }
    if (artifactDigest(artifact.content) !== artifact.digest) {
      issues.push({
        path: `responsePlan.artifactSnapshots.${index}.digest`,
        message: "Artifact digest must match the captured content",
      });
    }
  }
  for (const [index, calculation] of submission.calculations.entries()) {
    const issue = calculationIntegrityIssue(calculation);
    if (issue !== undefined) {
      issues.push({
        path: `calculations.${index}.result.value`,
        message: issue,
      });
    }
  }
  return issues;
}

export function checkSubmissionCompleteness(
  value: unknown,
  contextInput: SubmissionCompletenessContext,
): StudentCompletenessReport {
  const publishedCase = verifyPublishedCase(contextInput.publishedCase);
  const context = { ...contextInput, publishedCase };
  const releasedFactIds = validateTrustedReleasedState(
    publishedCase,
    context.trustedReleasedState,
  );
  const invalid = invalidDraftReport(value, context, releasedFactIds);
  if (invalid !== undefined) return invalid;
  const submission = SubmissionDraftSchema.parse(value);
  const missing = contentIntegrityIssues(submission);
  const trustedState = context.trustedReleasedState;

  if (
    submission.assignmentId !== trustedState.assignmentId ||
    submission.attemptNumber !== trustedState.attemptNumber ||
    submission.caseVersionDigest !== trustedState.caseVersionDigest
  ) {
    missing.push({
      path: "assignmentIdentity",
      message: "The submission must use the trusted assignment, attempt, and frozen case version",
    });
  }

  const released = new Set(releasedFactIds);
  const citedFactIds = [
    ...submission.evidence.map(({ officialFactId }) => officialFactId),
    ...submission.ledger.flatMap(({ officialFactIds }) => officialFactIds),
  ];
  const unreleasedFactIds = [...new Set(citedFactIds.filter((factId) => !released.has(factId)))].sort();
  if (unreleasedFactIds.length > 0) {
    missing.push({
      path: "evidence",
      message: "Evidence may cite only facts in trusted release events for this assignment attempt",
    });
  }

  const eventById = new Map(trustedState.events.map((event) => [event.eventId, event]));
  if (
    submission.evidence.some((evidence) => {
      const event = eventById.get(evidence.sourceEventId);
      return (
        evidence.assignmentId !== submission.assignmentId ||
        evidence.attemptNumber !== submission.attemptNumber ||
        event === undefined ||
        !event.officialFactIds.includes(evidence.officialFactId)
      );
    })
  ) {
    missing.push({
      path: "evidence",
      message: "Captured evidence must match the trusted release event and assignment attempt",
    });
  }

  const assessmentByRequirement = new Map(
    submission.requirementAssessments.map((assessment) => [assessment.requirementId, assessment]),
  );
  if (assessmentByRequirement.size !== submission.requirementAssessments.length) {
    missing.push({
      path: "requirementAssessments",
      message: "Each case requirement may be assessed only once",
    });
  }
  const caseRequirementIds = new Set(publishedCase.source.visible.requirements.map(({ id }) => id));
  if (
    submission.requirementAssessments.some(
      ({ requirementId }) => !caseRequirementIds.has(requirementId),
    )
  ) {
    missing.push({
      path: "requirementAssessments",
      message: "Requirement assessments must belong to the assigned case version",
    });
  }
  const applicabilityByRequirement = new Map(
    publishedCase.source.visible.requirements.map(({ id, applicability }) => [id, applicability]),
  );
  if (
    submission.requirementAssessments.some(
      ({ requirementId, status }) =>
        status === "not-applicable" &&
        applicabilityByRequirement.get(requirementId) === "applicable",
    )
  ) {
    missing.push({
      path: "requirementAssessments",
      message: "A fixed applicable case requirement cannot be marked not applicable",
    });
  }
  const requirements = publishedCase.source.visible.requirements.map((requirement) => ({
    requirementId: requirement.id,
    status: assessmentByRequirement.get(requirement.id)?.status ?? ("missing" as const),
  }));
  if (requirements.some(({ status }) => status === "missing")) {
    missing.push({
      path: "requirementAssessments",
      message: "Every case requirement needs a status and rationale",
    });
  }

  const evidenceIds = new Set(submission.evidence.map(({ id }) => id));
  if (evidenceIds.size !== submission.evidence.length) {
    missing.push({
      path: "evidence",
      message: "Each captured evidence record needs a unique identifier",
    });
  }
  const invalidEvidenceReferences = [
    ...submission.competencyClaims.flatMap(({ evidenceIds: ids }) => ids),
    ...submission.requirementAssessments.flatMap(({ evidenceIds: ids }) => ids),
    ...submission.decision.supportingEvidenceIds,
  ].filter((evidenceId) => !evidenceIds.has(evidenceId));
  if (invalidEvidenceReferences.length > 0) {
    missing.push({
      path: "evidenceReferences",
      message: "All evidence references must point to evidence captured in this submission",
    });
  }

  return {
    complete: missing.length === 0,
    missing,
    requirements,
    provenance: {
      citedOfficialFactCount: new Set(citedFactIds).size,
      unreleasedFactIds,
    },
  };
}

function submissionContent(record: SubmissionRecord): Omit<SubmissionRecord, "submissionDigest"> {
  return Object.fromEntries(
    Object.entries(record).filter(([key]) => key !== "submissionDigest"),
  ) as Omit<SubmissionRecord, "submissionDigest">;
}

function finalizeSubmission(
  draft: SubmissionDraft,
  trustedState: TrustedReleasedState,
  metadata: SubmissionAcceptanceMetadata,
): DeepReadonly<SubmissionRecord> {
  const withoutDigest = {
    ...draft,
    acceptedAt: metadata.acceptedAt,
    eventCutoffSequence: trustedState.currentEventSequence,
    providerProvenance: metadata.providerProvenance,
    cliVersion: metadata.cliVersion,
  };
  const parsed = SubmissionRecordSchema.parse({
    ...withoutDigest,
    submissionDigest: sha256Digest(withoutDigest),
  });
  return verifySubmissionRecord(parsed);
}

export function verifySubmissionRecord(input: unknown): DeepReadonly<SubmissionRecord> {
  const parsed = SubmissionRecordSchema.parse(input);
  if (sha256Digest(submissionContent(parsed)) !== parsed.submissionDigest) {
    throw new Error("Submission digest verification failed");
  }
  const integrityIssues = contentIntegrityIssues(parsed);
  if (integrityIssues.length > 0) {
    throw new Error(`Submission content integrity failed: ${integrityIssues[0]!.message}`);
  }
  return deepFreeze(parsed);
}

export type SubmissionAcceptanceResult =
  | {
      readonly accepted: true;
      readonly attempt: DeepReadonly<AttemptSnapshot>;
      readonly report: StudentCompletenessReport;
    }
  | {
      readonly accepted: false;
      readonly attempt: DeepReadonly<AttemptSnapshot>;
      readonly report: StudentCompletenessReport;
    };

export function acceptSubmission(
  currentInput: unknown,
  draftInput: unknown,
  context: SubmissionCompletenessContext,
  metadata: SubmissionAcceptanceMetadata,
): SubmissionAcceptanceResult {
  const current = deepFreeze(AttemptSnapshotSchema.parse(currentInput));
  if (current.status !== "active") throw new Error("This attempt already has an immutable submission");
  const publishedCase = verifyPublishedCase(context.publishedCase);
  if (
    current.assignmentId !== context.trustedReleasedState.assignmentId ||
    current.attemptNumber !== context.trustedReleasedState.attemptNumber ||
    current.caseVersionDigest !== publishedCase.digests.caseVersionDigest ||
    current.caseVersionDigest !== context.trustedReleasedState.caseVersionDigest
  ) {
    throw new Error("Trusted acceptance state does not match the active assignment attempt");
  }

  const report = checkSubmissionCompleteness(draftInput, {
    publishedCase,
    trustedReleasedState: context.trustedReleasedState,
  });
  const parsedDraft = SubmissionDraftSchema.safeParse(draftInput);
  if (!report.complete || !parsedDraft.success) {
    return { accepted: false, attempt: current, report };
  }
  if (parsedDraft.data.studentGithubUserId !== current.studentGithubUserId) {
    return {
      accepted: false,
      attempt: current,
      report: {
        ...report,
        complete: false,
        missing: [
          ...report.missing,
          {
            path: "studentGithubUserId",
            message: "The submission must belong to the assigned immutable GitHub identity",
          },
        ],
      },
    };
  }

  const provenance = metadata.providerProvenance.map((item) => ProviderProvenanceSchema.parse(item));
  const provenanceByInteraction = new Map(provenance.map((item) => [item.interactionId, item]));
  const provenanceIsInvalid =
    provenanceByInteraction.size !== provenance.length ||
    context.trustedReleasedState.events.some(
      (event) =>
        event.providerInteractionId !== undefined &&
        provenanceByInteraction.get(event.providerInteractionId)?.eventId !== event.eventId,
    ) ||
    provenance.some(
      ({ interactionId, eventId }) =>
        !context.trustedReleasedState.events.some(
          (event) => event.eventId === eventId && event.providerInteractionId === interactionId,
        ),
    );
  if (provenanceIsInvalid) {
    return {
      accepted: false,
      attempt: current,
      report: {
        ...report,
        complete: false,
        missing: [
          ...report.missing,
          {
            path: "providerProvenance",
            message: "Provider provenance must match the trusted release events",
          },
        ],
      },
    };
  }

  const submission = finalizeSubmission(parsedDraft.data, context.trustedReleasedState, {
    ...metadata,
    providerProvenance: provenance,
  });
  return {
    accepted: true,
    report,
    attempt: deepFreeze({ ...current, status: "submitted" as const, submission }),
  };
}

export function readAttempt(input: unknown): DeepReadonly<AttemptSnapshot> {
  const attempt = AttemptSnapshotSchema.parse(input);
  if (attempt.submission !== undefined) {
    const verified = verifySubmissionRecord(attempt.submission);
    return deepFreeze({ ...attempt, submission: verified });
  }
  return deepFreeze(attempt);
}

export function reopenAttempt(
  submitted: unknown,
  openedAt: string,
): {
  readonly previous: DeepReadonly<AttemptSnapshot>;
  readonly next: DeepReadonly<AttemptSnapshot>;
} {
  const previous = readAttempt(submitted);
  if (previous.status !== "submitted") throw new Error("Only a submitted attempt can be reopened");
  return {
    previous,
    next: deepFreeze({
      assignmentId: previous.assignmentId,
      studentGithubUserId: previous.studentGithubUserId,
      caseVersionDigest: previous.caseVersionDigest,
      attemptNumber: previous.attemptNumber + 1,
      openedAt,
      status: "active" as const,
    }),
  };
}
