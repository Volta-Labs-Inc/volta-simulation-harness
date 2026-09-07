import { z } from "zod";
import { PersonaProfileSchema } from "./persona.js";

const IdentifierSchema = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/, "Use a stable lowercase identifier");

const Sha256Schema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const IsoDateTimeSchema = z.string().datetime({ offset: true });

function normalizeCue(value: string): string {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

const RouteCueSchema = z
  .string()
  .min(1)
  .max(200)
  .refine((cue) => normalizeCue(cue).length > 0, "A route cue must contain a letter or number");

export const CompetencyIdSchema = z.enum([
  "problem-viability",
  "evidence-sufficiency",
  "response-feasibility",
  "objective-success-criteria",
]);

export const CompetencyRubricSchema = z
  .object({
    id: CompetencyIdSchema,
    title: z.string().min(1).max(160),
    studentPrompt: z.string().min(1).max(2_000),
  })
  .strict();

export const CaseRequirementSchema = z
  .object({
    id: IdentifierSchema,
    title: z.string().min(1).max(200),
    prompt: z.string().min(1).max(2_000),
    applicability: z.enum(["applicable", "student-may-mark-not-applicable"]),
    stage: IdentifierSchema.optional(),
    gate: IdentifierSchema.optional(),
    optional: z.boolean().optional(),
    initialState: z.enum(["open", "present"]).optional(),
  })
  .strict();

export const PersonaSchema = z
  .object({
    id: IdentifierSchema,
    name: z.string().min(1).max(120),
    role: z.string().min(1).max(200),
    studentBrief: z.string().min(1).max(2_000),
  })
  .strict();

export const EvidenceSourceSchema = z
  .object({
    id: IdentifierSchema,
    title: z.string().min(1).max(200),
    kind: z.enum(["file", "dataset", "system-query", "collection-opportunity"]),
    studentBrief: z.string().min(1).max(2_000),
  })
  .strict();

const ContentAssetSchema = z
  .object({
    sourcePath: z.string().min(1).max(500),
    targetPath: z.string().min(1).max(500),
    mediaType: z.enum([
      "text/plain",
      "text/markdown",
      "text/csv",
      "application/json",
      "application/yaml",
    ]),
    byteLength: z.number().int().nonnegative().max(5_000_000),
    digest: Sha256Schema,
  })
  .strict();

const FactSourceSchema = z
  .object({
    channel: z.enum(["persona", "evidence"]),
    targetId: IdentifierSchema,
  })
  .strict();

export const OfficialFactSchema = z
  .object({
    id: IdentifierSchema,
    claim: z.string().min(1).max(5_000),
    provenance: z.string().min(1).max(1_000),
    source: FactSourceSchema,
    additionalSources: z.array(FactSourceSchema).max(100).optional(),
  })
  .strict();

const RouteMatchSchema = z
  .object({
    anyPhrases: z.array(RouteCueSchema).max(30).default([]),
    allTerms: z.array(RouteCueSchema).max(30).default([]),
    anyTermGroups: z.array(z.array(RouteCueSchema).min(1).max(30)).max(30).default([]),
    noneTerms: z.array(RouteCueSchema).max(30).default([]),
  })
  .strict()
  .superRefine((match, context) => {
    if (
      match.anyPhrases.length === 0 &&
      match.allTerms.length === 0 &&
      match.anyTermGroups.length === 0
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "A route needs at least one authored matching cue",
      });
    }
  });

const RouteConsequenceSchema = z
  .object({
    id: IdentifierSchema,
    time: z
      .object({
        amount: z.number().int().nonnegative(),
        unit: z.enum(["minutes", "hours", "days"]),
      })
      .strict(),
    resources: z
      .array(
        z
          .object({
            id: IdentifierSchema,
            amount: z.number().finite().nonnegative(),
            unit: z.string().min(1).max(80),
          })
          .strict(),
      )
      .max(20),
    risk: z
      .object({
        level: z.enum(["low", "moderate", "high"]),
        suggestStaffReview: z.boolean(),
        blocksSandboxWork: z.literal(false),
      })
      .strict()
      .optional(),
    evidenceOutcome: z.enum(["release", "partial", "unavailable", "collection-plan"]),
  })
  .strict();

const ReleaseOutcomeSchema = z
  .object({
    kind: z.literal("release"),
    factIds: z.array(IdentifierSchema).min(1),
    studentMessage: z.string().min(1).max(5_000),
  })
  .strict();

const PartialOutcomeSchema = z
  .object({
    kind: z.literal("partial"),
    factIds: z.array(IdentifierSchema).min(1),
    studentMessage: z.string().min(1).max(5_000),
    limitation: z.string().min(1).max(2_000),
  })
  .strict();

const UnavailableOutcomeSchema = z
  .object({
    kind: z.literal("unavailable"),
    factIds: z.array(IdentifierSchema).length(0).default([]),
    studentMessage: z.string().min(1).max(5_000),
  })
  .strict();

const CollectionPlanOutcomeSchema = z
  .object({
    kind: z.literal("collection-plan"),
    factIds: z.array(IdentifierSchema).default([]),
    studentMessage: z.string().min(1).max(5_000),
    collectionMethod: z.string().min(1).max(2_000),
  })
  .strict();

export const AuthoredRouteSchema = z
  .object({
    id: IdentifierSchema,
    channel: z.enum(["persona", "evidence", "collection"]),
    targetId: IdentifierSchema,
    priority: z.number().int().min(-1_000).max(1_000).default(0),
    match: RouteMatchSchema,
    prerequisiteFactIds: z.array(IdentifierSchema).default([]),
    prerequisiteEvidenceIds: z.array(IdentifierSchema).default([]),
    releasedEvidenceIds: z.array(IdentifierSchema).default([]),
    consequence: RouteConsequenceSchema,
    outcome: z.discriminatedUnion("kind", [
      ReleaseOutcomeSchema,
      PartialOutcomeSchema,
      UnavailableOutcomeSchema,
      CollectionPlanOutcomeSchema,
    ]),
  })
  .strict()
  .superRefine((route, context) => {
    if (route.consequence.evidenceOutcome !== route.outcome.kind) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["consequence", "evidenceOutcome"],
        message: "The consequence evidence outcome must match the authored route outcome",
      });
    }
  });

const DifficultyFactorSchema = z
  .object({
    id: IdentifierSchema,
    dimension: z.enum([
      "ambiguity",
      "data-availability",
      "stakeholder-complexity",
      "solution-risk",
      "economic-uncertainty",
    ]),
    level: z.enum(["low", "medium", "high"]),
    rationale: z.string().min(1).max(1_000),
  })
  .strict();

export const VisibleCaseBundleSchema = z
  .object({
    caseId: IdentifierSchema,
    versionLabel: z.string().min(1).max(80),
    assessmentUse: z.enum(["assessed", "non-assessed-example"]),
    title: z.string().min(1).max(200),
    brief: z.string().min(1).max(10_000),
    difficulty: z
      .object({
        audience: z.string().min(1).max(200),
        experienceLevel: z.enum(["introductory", "intermediate", "advanced"]),
        factors: z.array(DifficultyFactorSchema).min(1).max(20),
      })
      .strict(),
    constraints: z.array(z.string().min(1).max(1_000)).min(1).max(50),
    unacceptableOutcomes: z.array(z.string().min(1).max(1_000)).min(1).max(50),
    nonExhaustiveResponseFamilies: z.array(z.string().min(1).max(500)).min(1).max(30),
    competencies: z.array(CompetencyRubricSchema).length(4),
    requirements: z.array(CaseRequirementSchema).min(1).max(100),
    personas: z.array(PersonaSchema).min(1).max(50),
    evidenceSources: z.array(EvidenceSourceSchema).min(1).max(100),
    studentAssets: z.array(ContentAssetSchema).max(200).optional(),
  })
  .strict();

const EvidenceBehaviorSchema = z
  .object({
    evidenceSourceId: IdentifierSchema,
    availability: z.enum(["initial", "on-purposeful-request", "after-collection", "unavailable"]),
    outcomeClass: z.enum(["complete", "partial", "biased", "unavailable", "unusable"]),
    authoritativeFactIds: z.array(IdentifierSchema).max(1_000),
    requestCues: z.array(z.string().min(1).max(500)).max(50),
    limitations: z.array(z.string().min(1).max(2_000)).max(50),
    collectionRouteId: IdentifierSchema.optional(),
    unavailableReason: z.string().min(1).max(2_000).optional(),
    studentVisibleSamplingFrame: z
      .object({
        included: z.string().min(1).max(2_000),
        excluded: z.string().min(1).max(2_000),
      })
      .strict()
      .optional(),
    asset: ContentAssetSchema.omit({ targetPath: true }).optional(),
  })
  .strict()
  .superRefine((behavior, context) => {
    if (behavior.availability === "unavailable") {
      if (behavior.asset !== undefined || behavior.authoritativeFactIds.length > 0) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Unavailable evidence cannot contain an asset or authoritative facts",
        });
      }
      if (behavior.unavailableReason === undefined) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["unavailableReason"],
          message: "Unavailable evidence needs an authored reason",
        });
      }
    } else if (behavior.asset === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["asset"],
        message: "Available evidence needs a frozen asset",
      });
    }
  });

const EconomicsSchema = z
  .object({
    currency: z.string().min(1).max(20),
    fixedInputs: z
      .array(
        z
          .object({
            id: IdentifierSchema,
            value: z.union([z.number().finite(), z.string().min(1).max(2_000), z.boolean()]),
            unit: z.string().min(1).max(120).optional(),
            factId: IdentifierSchema.optional(),
            evidenceClass: z.string().min(1).max(120).optional(),
          })
          .strict(),
      )
      .min(1)
      .max(100),
    measurableOutcomes: z
      .array(
        z
          .object({
            id: IdentifierSchema,
            value: z.union([z.number().finite(), z.string().min(1).max(2_000)]).optional(),
            calculation: z.string().min(1).max(2_000).optional(),
            caveat: z.string().min(1).max(2_000).optional(),
            evidenceSourceId: IdentifierSchema.optional(),
          })
          .strict(),
      )
      .max(100),
    studentOwnedInputs: z.array(z.string().min(1).max(2_000)).min(1).max(100),
    calculationRules: z.array(z.string().min(1).max(2_000)).min(1).max(100),
    authorNote: z.string().min(1).max(5_000),
  })
  .strict();

const SourcePinSchema = z
  .object({
    id: IdentifierSchema,
    source: z.string().min(1).max(500),
    revision: z.string().min(1).max(500),
    artifacts: z
      .array(
        z
          .object({
            locator: z.string().min(1).max(1_000),
            digest: Sha256Schema.optional(),
          })
          .strict(),
      )
      .max(200),
  })
  .strict();

const AuthoringProvenanceSchema = z
  .object({
    path: z.enum(["blank", "sanitized-reference-assisted"]),
    studentDisclosure: z.literal("simulated"),
    liveSourceAccessRequired: z.literal(false),
    rawSourceMaterialPresent: z.boolean(),
    sourceDocumentDigests: z
      .array(
        z
          .object({
            id: IdentifierSchema,
            digest: Sha256Schema,
          })
          .strict(),
      )
      .min(1)
      .max(500),
  })
  .strict();

export const ProtectedCasePackageSchema = z
  .object({
    facts: z.array(OfficialFactSchema).min(1).max(1_000),
    routes: z.array(AuthoredRouteSchema).min(1).max(2_000),
    personaBehaviors: z
      .array(
        z
          .object({
            personaId: IdentifierSchema,
            profile: PersonaProfileSchema.optional(),
            incentives: z.array(z.string().min(1).max(1_000)).min(1).max(20),
            uncertainties: z.array(z.string().min(1).max(1_000)).max(20),
            biases: z.array(z.string().min(1).max(1_000)).max(20).optional(),
            openingFactIds: z.array(IdentifierSchema).max(100).optional(),
            openingPoints: z.array(z.string().min(1).max(2_000)).max(100).optional(),
            refusalRules: z
              .array(
                z
                  .object({
                    id: IdentifierSchema,
                    trigger: z.string().min(1).max(1_000),
                    responseBoundary: z.string().min(1).max(2_000),
                  })
                  .strict(),
              )
              .min(1)
              .max(30),
          })
          .strict(),
      )
      .min(1)
      .max(50),
    calibrationAnchors: z
      .array(
        z
          .object({
            class: z.enum(["effective", "partially-effective", "not-yet-effective"]),
            artifactDigest: Sha256Schema,
            rationale: z.string().min(1).max(5_000),
          })
          .strict(),
      )
      .length(3),
    nonExhaustiveOutcomeFamilies: z
      .array(
        z
          .object({
            id: IdentifierSchema,
            title: z.string().min(1).max(200),
            warrantingConditions: z.array(z.string().min(1).max(2_000)).min(1).max(30),
            disqualifyingConditions: z.array(z.string().min(1).max(2_000)).min(1).max(30),
            nonExhaustive: z.literal(true),
          })
          .strict(),
      )
      .min(1)
      .max(30),
    authoredRisks: z.array(z.string().min(1).max(2_000)).min(1).max(100),
    successStandard: z.string().min(1).max(5_000),
    evidenceBehaviors: z.array(EvidenceBehaviorSchema).max(100).optional(),
    economics: EconomicsSchema.optional(),
    sourcePins: z.array(SourcePinSchema).max(50).optional(),
    authoringProvenance: AuthoringProvenanceSchema.optional(),
    outOfUniverse: z
      .object({ studentMessage: z.string().min(1).max(5_000) })
      .strict()
      .optional(),
  })
  .strict();

const SnapshotSchema = z
  .object({
    source: z.string().min(1).max(500),
    sourceDigest: Sha256Schema,
    capturedAt: IsoDateTimeSchema,
  })
  .strict();

function duplicateIds(values: readonly { id: string }[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (seen.has(value.id)) duplicates.add(value.id);
    seen.add(value.id);
  }
  return [...duplicates].sort();
}

const CaseVersionSourceBaseSchema = z.object({
    visible: VisibleCaseBundleSchema,
    protected: ProtectedCasePackageSchema,
    requirementsSnapshot: SnapshotSchema,
    methodologySnapshot: SnapshotSchema,
  });

export const ApprovedCaseVersionSourceSchema = CaseVersionSourceBaseSchema.extend({
  status: z.literal("approved"),
  approvedBy: z.string().min(1).max(200),
  approvedAt: IsoDateTimeSchema,
}).strict();

export const DraftCaseVersionSourceSchema = CaseVersionSourceBaseSchema.extend({
  status: z.literal("draft"),
  approvedBy: z.null(),
  approvedAt: z.null(),
}).strict();

export const CaseVersionSourceSchema = z
  .discriminatedUnion("status", [ApprovedCaseVersionSourceSchema, DraftCaseVersionSourceSchema])
  .superRefine((source, context) => {
    const competencyIds = source.visible.competencies.map(({ id }) => id);
    const requiredCompetencies = CompetencyIdSchema.options;
    if (new Set(competencyIds).size !== requiredCompetencies.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["visible", "competencies"],
        message: "The four mandatory competencies must each appear exactly once",
      });
    }

    const collections = [
      ["requirements", source.visible.requirements],
      ["personas", source.visible.personas],
      ["evidenceSources", source.visible.evidenceSources],
      ["facts", source.protected.facts],
      ["routes", source.protected.routes],
      ["nonExhaustiveOutcomeFamilies", source.protected.nonExhaustiveOutcomeFamilies],
    ] as const;
    for (const [name, values] of collections) {
      const duplicates = duplicateIds(values);
      if (duplicates.length > 0) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [name === "facts" || name === "routes" ? "protected" : "visible", name],
          message: `Duplicate ids: ${duplicates.join(", ")}`,
        });
      }
    }

    const factIds = new Set(source.protected.facts.map(({ id }) => id));
    const personaIds = new Set(source.visible.personas.map(({ id }) => id));
    const evidenceSourceIds = new Set(source.visible.evidenceSources.map(({ id }) => id));
    const factSourcesById = new Map(
      source.protected.facts.map((fact) => [fact.id, [fact.source, ...(fact.additionalSources ?? [])]]),
    );
    for (const fact of source.protected.facts) {
      const sources = [fact.source, ...(fact.additionalSources ?? [])];
      const sourceKeys = sources.map(({ channel, targetId }) => `${channel}:${targetId}`);
      if (new Set(sourceKeys).size !== sourceKeys.length) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["protected", "facts", fact.id, "additionalSources"],
          message: "A fact cannot repeat the same authored source",
        });
      }
      for (const authoredSource of sources) {
        const targets = authoredSource.channel === "persona" ? personaIds : evidenceSourceIds;
        if (!targets.has(authoredSource.targetId)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["protected", "facts", fact.id, "source"],
            message: `Unknown ${authoredSource.channel} source: ${authoredSource.targetId}`,
          });
        }
      }
    }
    for (const route of source.protected.routes) {
      const knownTarget =
        route.channel === "collection"
          ? route.targetId === "collection"
          : (route.channel === "persona" ? personaIds : evidenceSourceIds).has(route.targetId);
      if (!knownTarget) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["protected", "routes", route.id, "targetId"],
          message: `Unknown ${route.channel} target: ${route.targetId}`,
        });
      }
      for (const factId of [...route.prerequisiteFactIds, ...route.outcome.factIds]) {
        if (!factIds.has(factId)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["protected", "routes", route.id],
            message: `Unknown fact reference: ${factId}`,
          });
        }
      }
      for (const evidenceId of [
        ...route.prerequisiteEvidenceIds,
        ...route.releasedEvidenceIds,
      ]) {
        if (!evidenceSourceIds.has(evidenceId)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["protected", "routes", route.id],
            message: `Unknown evidence reference: ${evidenceId}`,
          });
        }
      }
      for (const factId of route.outcome.factIds) {
        const eligibleTargets =
          route.channel === "collection"
            ? new Set(route.releasedEvidenceIds.map((id) => `evidence:${id}`))
            : new Set([`${route.channel}:${route.targetId}`]);
        const authoredSources = factSourcesById.get(factId) ?? [];
        if (!authoredSources.some(({ channel, targetId }) => eligibleTargets.has(`${channel}:${targetId}`))) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["protected", "routes", route.id, "outcome", "factIds"],
            message: `Fact ${factId} must come from the route's declared source`,
          });
        }
      }
    }

    const consequenceDuplicates = duplicateIds(
      source.protected.routes.map(({ consequence }) => consequence),
    );
    if (consequenceDuplicates.length > 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["protected", "routes"],
        message: `Duplicate consequence ids: ${consequenceDuplicates.join(", ")}`,
      });
    }

    const behaviorPersonaIds = source.protected.personaBehaviors.map(({ personaId }) => personaId);
    if (
      new Set(behaviorPersonaIds).size !== personaIds.size ||
      behaviorPersonaIds.some((personaId) => !personaIds.has(personaId))
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["protected", "personaBehaviors"],
        message: "Every visible persona needs exactly one protected behavior profile",
      });
    }

    const calibrationClasses = source.protected.calibrationAnchors.map((anchor) => anchor.class);
    if (new Set(calibrationClasses).size !== 3) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["protected", "calibrationAnchors"],
        message: "Cases need effective, partially-effective, and not-yet-effective calibrations",
      });
    }
    const sourcePinDuplicates = duplicateIds(source.protected.sourcePins ?? []);
    if (sourcePinDuplicates.length > 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["protected", "sourcePins"],
        message: `Duplicate ids: ${sourcePinDuplicates.join(", ")}`,
      });
    }
    const authoringDocumentDuplicates = duplicateIds(
      source.protected.authoringProvenance?.sourceDocumentDigests ?? [],
    );
    if (authoringDocumentDuplicates.length > 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["protected", "authoringProvenance", "sourceDocumentDigests"],
        message: `Duplicate ids: ${authoringDocumentDuplicates.join(", ")}`,
      });
    }
    const studentTargetPaths = source.visible.studentAssets?.map(({ targetPath }) => targetPath) ?? [];
    if (new Set(studentTargetPaths).size !== studentTargetPaths.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["visible", "studentAssets"],
        message: "Student asset target paths must be unique",
      });
    }

    const evidenceBehaviors = source.protected.evidenceBehaviors;
    if (evidenceBehaviors !== undefined) {
      const behaviorIds = evidenceBehaviors.map(({ evidenceSourceId }) => evidenceSourceId);
      if (
        new Set(behaviorIds).size !== evidenceSourceIds.size ||
        behaviorIds.some((evidenceId) => !evidenceSourceIds.has(evidenceId))
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["protected", "evidenceBehaviors"],
          message: "Every visible evidence source needs exactly one protected behavior profile",
        });
      }
      for (const behavior of evidenceBehaviors) {
        for (const factId of behavior.authoritativeFactIds) {
          if (!factIds.has(factId)) {
            context.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["protected", "evidenceBehaviors", behavior.evidenceSourceId],
              message: `Unknown fact reference: ${factId}`,
            });
          }
        }
      }
    }

    if (source.protected.economics !== undefined) {
      for (const input of source.protected.economics.fixedInputs) {
        if (input.factId !== undefined && !factIds.has(input.factId)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["protected", "economics", "fixedInputs", input.id],
            message: `Unknown fact reference: ${input.factId}`,
          });
        }
      }
      for (const outcome of source.protected.economics.measurableOutcomes) {
        if (outcome.evidenceSourceId !== undefined && !evidenceSourceIds.has(outcome.evidenceSourceId)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["protected", "economics", "measurableOutcomes", outcome.id],
            message: `Unknown evidence reference: ${outcome.evidenceSourceId}`,
          });
        }
      }
    }

    if (source.visible.assessmentUse === "assessed") {
      if ((source.visible.studentAssets?.length ?? 0) === 0) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["visible", "studentAssets"],
          message: "Assessed cases need a frozen student asset manifest",
        });
      }
      for (const [field, value] of [
        ["evidenceBehaviors", source.protected.evidenceBehaviors],
        ["economics", source.protected.economics],
        ["sourcePins", source.protected.sourcePins],
        ["authoringProvenance", source.protected.authoringProvenance],
        ["outOfUniverse", source.protected.outOfUniverse],
      ] as const) {
        if (value === undefined || (Array.isArray(value) && value.length === 0)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["protected", field],
            message: `Assessed cases require ${field}`,
          });
        }
      }
      const calibrationDigests = source.protected.calibrationAnchors.map(
        ({ artifactDigest }) => artifactDigest,
      );
      const placeholderDigest = `sha256:${"0".repeat(64)}`;
      if (
        new Set(calibrationDigests).size !== 3 ||
        calibrationDigests.some((digest) => digest === placeholderDigest)
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["protected", "calibrationAnchors"],
          message: "Assessed cases need three distinct non-placeholder calibration artifacts",
        });
      }
    }
  });

export type CompetencyId = z.infer<typeof CompetencyIdSchema>;
export type VisibleCaseBundle = z.infer<typeof VisibleCaseBundleSchema>;
export type ProtectedCasePackage = z.infer<typeof ProtectedCasePackageSchema>;
export type CaseVersionSource = z.infer<typeof CaseVersionSourceSchema>;
export type ApprovedCaseVersionSource = z.infer<typeof ApprovedCaseVersionSourceSchema>;
export type AuthoredRoute = z.infer<typeof AuthoredRouteSchema>;
export type OfficialFact = z.infer<typeof OfficialFactSchema>;
