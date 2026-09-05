import { z } from "zod";
import { CompetencyIdSchema } from "./case.js";

const IdentifierSchema = z.string().min(1).max(160);
const GithubUserIdSchema = z.string().regex(/^\d+$/, "Use the immutable numeric GitHub user id");
const IsoDateTimeSchema = z.string().datetime({ offset: true });
const Sha256Schema = z.string().regex(/^sha256:[a-f0-9]{64}$/);

export const LedgerEntrySchema = z
  .object({
    id: IdentifierSchema,
    kind: z.enum(["fact", "assumption", "contradiction", "unknown"]),
    statement: z.string().min(1).max(5_000),
    officialFactIds: z.array(IdentifierSchema).default([]),
    createdAt: IsoDateTimeSchema,
  })
  .strict()
  .superRefine((entry, context) => {
    if (entry.kind === "fact" && entry.officialFactIds.length === 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["officialFactIds"],
        message: "A fact entry must cite at least one officially released fact",
      });
    }
    if (entry.kind !== "fact" && entry.officialFactIds.length > 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["officialFactIds"],
        message: "Only fact entries may cite official facts",
      });
    }
  });

export const EvidenceRecordSchema = z
  .object({
    id: IdentifierSchema,
    assignmentId: IdentifierSchema,
    attemptNumber: z.number().int().positive(),
    officialFactId: IdentifierSchema,
    sourceEventId: IdentifierSchema,
    capturedAt: IsoDateTimeSchema,
    provenance: z.string().min(1).max(2_000),
  })
  .strict();

export const DecisionRecordSchema = z
  .object({
    id: IdentifierSchema,
    choice: z.enum(["continue", "pivot", "buy", "collect-more-evidence", "stop"]),
    rationale: z.string().min(1).max(10_000),
    supportingEvidenceIds: z.array(IdentifierSchema),
    expectedEvidence: z
      .array(
        z
          .object({
            description: z.string().min(1).max(2_000),
            sourceOrMethod: z.string().min(1).max(1_000),
            decisionUse: z.string().min(1).max(2_000),
          })
          .strict(),
      )
      .min(1)
      .max(30),
    pivotOrStopConditions: z
      .array(
        z
          .object({
            action: z.enum(["pivot", "stop"]),
            condition: z.string().min(1).max(2_000),
            rationale: z.string().min(1).max(2_000),
          })
          .strict(),
      )
      .min(1)
      .max(30),
    createdAt: IsoDateTimeSchema,
  })
  .strict();

export const EstimateRecordSchema = z
  .object({
    id: IdentifierSchema,
    subject: z.string().min(1).max(500),
    low: z.number().finite().nonnegative(),
    high: z.number().finite().nonnegative(),
    unit: z.string().min(1).max(80),
    assumptions: z.array(z.string().min(1).max(2_000)).min(1),
    confidence: z.number().min(0).max(1),
    createdAt: IsoDateTimeSchema,
  })
  .strict()
  .superRefine((estimate, context) => {
    if (estimate.low > estimate.high) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["high"],
        message: "The high estimate must be at least the low estimate",
      });
    }
  });

const RequirementAssessmentSchema = z
  .object({
    requirementId: IdentifierSchema,
    status: z.enum(["addressed", "not-yet", "not-applicable"]),
    rationale: z.string().min(1).max(5_000),
    evidenceIds: z.array(IdentifierSchema),
  })
  .strict();

const CompetencyClaimSchema = z
  .object({
    competencyId: CompetencyIdSchema,
    rationale: z.string().min(1).max(10_000),
    evidenceIds: z.array(IdentifierSchema),
  })
  .strict();

export const SuccessCriterionSchema = z
  .object({
    metric: z.string().min(1).max(500),
    baseline: z.string().min(1).max(1_000).optional(),
    baselinePlan: z.string().min(1).max(2_000).optional(),
    target: z.string().min(1).max(1_000),
    targetDate: IsoDateTimeSchema,
    failureThreshold: z.string().min(1).max(1_000),
  })
  .strict()
  .superRefine((criterion, context) => {
    if ((criterion.baseline === undefined) === (criterion.baselinePlan === undefined)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Provide exactly one measured baseline or credible baseline plan",
      });
    }
  });

function hasUnsafePathCharacter(path: string): boolean {
  return [...path].some((character) => {
    const codePoint = character.codePointAt(0)!;
    return (
      codePoint <= 0x1f ||
      (codePoint >= 0x7f && codePoint <= 0x9f) ||
      codePoint === 0x2028 ||
      codePoint === 0x2029
    );
  });
}

const SafeArtifactPathSchema = z
  .string()
  .min(1)
  .max(500)
  .refine(
    (path) =>
      !path.startsWith("/") &&
      !path.includes("\\") &&
      !hasUnsafePathCharacter(path) &&
      !/^[a-zA-Z]:/.test(path) &&
      path
        .split("/")
        .every(
          (segment) =>
            segment !== "" && segment !== "." && segment !== ".." && !segment.startsWith("."),
        ),
    "Artifact paths must be safe, normalized paths inside the assignment repository",
  );

export const ArtifactSnapshotSchema = z
  .object({
    path: SafeArtifactPathSchema,
    digest: Sha256Schema,
    mediaType: z.enum(["text/plain", "text/markdown", "text/csv", "application/json"]),
    byteLength: z.number().int().nonnegative().max(1_000_000),
    content: z.string().max(1_000_000),
  })
  .strict();

const CalculationInputSchema = z
  .object({
    name: IdentifierSchema,
    value: z.number().finite(),
    unit: z.string().min(1).max(80),
    source: z.string().min(1).max(1_000),
  })
  .strict();

export const CalculationRecordSchema = z
  .object({
    id: IdentifierSchema,
    name: z.string().min(1).max(300),
    inputs: z.array(CalculationInputSchema).min(1).max(30),
    formula: z
      .object({
        operation: z.enum(["sum", "difference", "product", "quotient", "percentage-change"]),
        inputNames: z.array(IdentifierSchema).min(1).max(30),
      })
      .strict(),
    result: z
      .object({
        value: z.number().finite(),
        unit: z.string().min(1).max(80),
      })
      .strict(),
    rationale: z.string().min(1).max(2_000),
  })
  .strict()
  .superRefine((calculation, context) => {
    const inputNames = calculation.inputs.map(({ name }) => name);
    if (new Set(inputNames).size !== inputNames.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["inputs"],
        message: "Calculation input names must be unique",
      });
    }
    const knownNames = new Set(inputNames);
    if (calculation.formula.inputNames.some((name) => !knownNames.has(name))) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["formula", "inputNames"],
        message: "A formula may reference only its named calculation inputs",
      });
    }
    const arity = calculation.formula.inputNames.length;
    if (
      (["difference", "quotient", "percentage-change"] as const).includes(
        calculation.formula.operation as "difference" | "quotient" | "percentage-change",
      ) &&
      arity !== 2
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["formula", "inputNames"],
        message: "Difference, quotient, and percentage change formulas require exactly two inputs",
      });
    }
  });

const ResponsePlanSchema = z
  .object({
    mode: z.enum(["build", "pilot", "buy", "no-build", "data-collection"]),
    rationale: z.string().min(1).max(10_000),
    feasibility: z.string().min(1).max(5_000),
    risks: z.array(z.string().min(1).max(2_000)).min(1),
    artifactSnapshots: z.array(ArtifactSnapshotSchema).max(50),
  })
  .strict();

const SubmissionDraftBaseSchema = z
  .object({
    submissionId: IdentifierSchema,
    assignmentId: IdentifierSchema,
    studentGithubUserId: GithubUserIdSchema,
    attemptNumber: z.number().int().positive(),
    caseVersionDigest: Sha256Schema,
    gitCommitSha: z.string().regex(/^[a-f0-9]{40}$/),
    ledger: z.array(LedgerEntrySchema).min(1),
    evidence: z.array(EvidenceRecordSchema),
    decision: DecisionRecordSchema,
    estimates: z.array(EstimateRecordSchema).min(1),
    missingDataPlan: z.string().min(1).max(10_000),
    requirementAssessments: z.array(RequirementAssessmentSchema).min(1),
    competencyClaims: z.array(CompetencyClaimSchema).length(4),
    successCriteria: z.array(SuccessCriterionSchema).min(1),
    calculations: z.array(CalculationRecordSchema).min(1).max(50),
    economicRationale: z.string().min(1).max(10_000),
    responsePlan: ResponsePlanSchema,
  })
  .strict();

function validateSubmissionContent(
  submission: z.infer<typeof SubmissionDraftBaseSchema>,
  context: z.RefinementCtx,
): void {
  const competencyIds = submission.competencyClaims.map(({ competencyId }) => competencyId);
  if (new Set(competencyIds).size !== CompetencyIdSchema.options.length) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["competencyClaims"],
      message: "The submission must defend each mandatory competency exactly once",
    });
  }
  if (
    (submission.responsePlan.mode === "build" || submission.responsePlan.mode === "pilot") &&
    submission.responsePlan.artifactSnapshots.length === 0
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["responsePlan", "artifactSnapshots"],
      message: "A build or pilot response must include at least one bounded artifact",
    });
  }
  if (
    submission.responsePlan.mode === "no-build" &&
    submission.responsePlan.artifactSnapshots.length !== 0
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["responsePlan", "artifactSnapshots"],
      message: "A no-build response cannot include an implementation artifact",
    });
  }
}

export const SubmissionDraftSchema = SubmissionDraftBaseSchema.superRefine(
  validateSubmissionContent,
);

export const ProviderProvenanceSchema = z
  .object({
    interactionId: IdentifierSchema,
    eventId: IdentifierSchema,
    providerId: IdentifierSchema,
    modelId: z.string().min(1).max(200),
    calibration: z.enum(["passed", "flagged", "not-run"]),
    renderedAt: IsoDateTimeSchema,
  })
  .strict();

export const SubmissionRecordSchema = SubmissionDraftBaseSchema.extend({
  acceptedAt: IsoDateTimeSchema,
  eventCutoffSequence: z.number().int().nonnegative(),
  providerProvenance: z.array(ProviderProvenanceSchema).max(1_000),
  cliVersion: z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/),
  submissionDigest: Sha256Schema,
})
  .strict()
  .superRefine(validateSubmissionContent);

export const AttemptSnapshotSchema = z
  .object({
    assignmentId: IdentifierSchema,
    studentGithubUserId: GithubUserIdSchema,
    caseVersionDigest: Sha256Schema,
    attemptNumber: z.number().int().positive(),
    openedAt: IsoDateTimeSchema,
    status: z.enum(["active", "submitted"]),
    submission: SubmissionRecordSchema.optional(),
  })
  .strict()
  .superRefine((attempt, context) => {
    if ((attempt.status === "submitted") !== (attempt.submission !== undefined)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["submission"],
        message: "Only submitted attempts contain an immutable submission",
      });
    }
    if (
      attempt.submission !== undefined &&
      (attempt.submission.assignmentId !== attempt.assignmentId ||
        attempt.submission.studentGithubUserId !== attempt.studentGithubUserId ||
        attempt.submission.caseVersionDigest !== attempt.caseVersionDigest ||
        attempt.submission.attemptNumber !== attempt.attemptNumber)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["submission"],
        message: "The embedded submission identity must match its immutable attempt",
      });
    }
  });

export type LedgerEntry = z.infer<typeof LedgerEntrySchema>;
export type EvidenceRecord = z.infer<typeof EvidenceRecordSchema>;
export type DecisionRecord = z.infer<typeof DecisionRecordSchema>;
export type EstimateRecord = z.infer<typeof EstimateRecordSchema>;
export type CalculationRecord = z.infer<typeof CalculationRecordSchema>;
export type ArtifactSnapshot = z.infer<typeof ArtifactSnapshotSchema>;
export type ProviderProvenance = z.infer<typeof ProviderProvenanceSchema>;
export type SubmissionDraft = z.infer<typeof SubmissionDraftSchema>;
export type SubmissionRecord = z.infer<typeof SubmissionRecordSchema>;
export type AttemptSnapshot = z.infer<typeof AttemptSnapshotSchema>;
