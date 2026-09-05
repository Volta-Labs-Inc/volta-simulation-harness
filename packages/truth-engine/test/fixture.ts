import type { ApprovedCaseVersionSource } from "@volta-sim/contracts";
import type {
  AssignmentAccessContext,
} from "@volta-sim/core";
import type {
  AssignmentAuthorizationStore,
  AuthorizationRequest,
  AuthorizationSnapshot,
} from "@volta-sim/service-auth";
import { createCaseVersionDigests } from "../../core/src/case-version.js";
import { sha256Digest } from "../../core/src/canonical.js";
import { publishCase } from "../../core/src/published-case.js";
import { nonAssessedLibraryRoutingCase } from "../../core/examples/non-assessed-library-routing.js";
import {
  createInitialTruthState,
  InMemoryActionOperationStore,
  InMemoryTruthStateStore,
  TruthAndProviderEngine,
} from "../src/index.js";

const zeroDigest = `sha256:${"0".repeat(64)}` as const;

const outcomeDefinitions = [
  { id: "complete", fact: true, outcome: "release", minutes: 10 },
  { id: "partial", fact: true, outcome: "partial", minutes: 20 },
  { id: "biased", fact: true, outcome: "release", minutes: 30 },
  { id: "unusable", fact: false, outcome: "unavailable", minutes: 40 },
  { id: "unavailable", fact: false, outcome: "unavailable", minutes: 50 },
] as const;

export function makeSyntheticCase() {
  const source: ApprovedCaseVersionSource = structuredClone(nonAssessedLibraryRoutingCase);
  source.visible.personas.push({
    id: "unrelated-director",
    name: "Taylor",
    role: "Unrelated fictional director",
    studentBrief: "OTHER_PERSONA_VISIBLE_CANARY",
  });
  source.protected.personaBehaviors.push({
    personaId: "unrelated-director",
    incentives: ["OTHER_ASSIGNMENT_OR_PERSONA_CANARY"],
    uncertainties: [],
    refusalRules: [
      {
        id: "unrelated-boundary",
        trigger: "Never selected",
        responseBoundary: "OTHER_PERSONA_BOUNDARY_CANARY",
      },
    ],
  });
  source.protected.authoredRisks.push("FULL_TRUTH_CANARY");
  source.protected.calibrationAnchors[0] = {
    ...source.protected.calibrationAnchors[0]!,
    rationale: "CALIBRATION_CANARY",
  };

  for (const definition of outcomeDefinitions) {
    const evidenceId = `collection-${definition.id}`;
    source.visible.evidenceSources.push({
      id: evidenceId,
      title: `Synthetic ${definition.id} collection`,
      kind: "collection-opportunity",
      studentBrief: `A synthetic ${definition.id} outcome fixture.`,
    });
    if (definition.fact) {
      source.protected.facts.push({
        id: `${definition.id}-fact`,
        claim: `The ${definition.id} collection produced its authored synthetic observation.`,
        provenance: `Synthetic ${definition.id} fixture`,
        source: { channel: "evidence", targetId: evidenceId },
      });
    }
    const isUnavailable = definition.id === "unavailable";
    source.protected.evidenceBehaviors ??= [];
    source.protected.evidenceBehaviors.push({
      evidenceSourceId: evidenceId,
      availability: isUnavailable ? "unavailable" : "after-collection",
      outcomeClass: definition.id,
      authoritativeFactIds: definition.fact ? [`${definition.id}-fact`] : [],
      requestCues: [`collect ${definition.id}`],
      limitations:
        definition.id === "biased"
          ? ["The sample includes only morning records."]
          : definition.id === "unusable"
            ? ["The collected file cannot be interpreted reliably."]
            : [],
      collectionRouteId: `collect-${definition.id}`,
      ...(isUnavailable
        ? { unavailableReason: "The synthetic source does not exist." }
        : {
            asset: {
              sourcePath: `synthetic/${definition.id}.csv`,
              mediaType: "text/csv",
              byteLength: 20,
              digest: zeroDigest,
            },
          }),
      ...(definition.id === "biased"
        ? {
            studentVisibleSamplingFrame: {
              included: "Morning records only.",
              excluded: "Afternoon and evening records.",
            },
          }
        : {}),
    });
    source.protected.routes.push({
      id: `collect-${definition.id}`,
      channel: "collection",
      targetId: "collection",
      priority: 20,
      match: {
        anyPhrases: [`collect ${definition.id}`],
        allTerms: [],
        anyTermGroups: [],
        noneTerms: [],
      },
      prerequisiteFactIds: [],
      prerequisiteEvidenceIds: [],
      releasedEvidenceIds: isUnavailable ? [] : [evidenceId],
      consequence: {
        id: `consequence-${definition.id}`,
        time: { amount: definition.minutes, unit: "minutes" },
        resources: [
          { id: `${definition.id}-credits`, amount: definition.minutes / 10, unit: "credits" },
        ],
        ...(definition.id === "biased"
          ? {
              risk: {
                level: "high" as const,
                suggestStaffReview: true,
                blocksSandboxWork: false as const,
              },
            }
          : {}),
        evidenceOutcome: definition.outcome,
      },
      outcome:
        definition.outcome === "release"
          ? {
              kind: "release",
              factIds: [`${definition.id}-fact`],
              studentMessage: `The ${definition.id} result is ready.`,
            }
          : definition.outcome === "partial"
            ? {
                kind: "partial",
                factIds: [`${definition.id}-fact`],
                studentMessage: "The partial result is ready.",
                limitation: "Only part of the requested period is represented.",
              }
            : {
                kind: "unavailable",
                factIds: [],
                studentMessage:
                  definition.id === "unusable"
                    ? "The collection completed, but its output is unusable."
                    : "The requested source is unavailable.",
              },
    });
  }

  for (const suffix of ["a", "b"] as const) {
    source.protected.routes.push({
      id: `ambiguous-${suffix}`,
      channel: "collection",
      targetId: "collection",
      priority: 99,
      match: {
        anyPhrases: ["collect conflict"],
        allTerms: [],
        anyTermGroups: [],
        noneTerms: [],
      },
      prerequisiteFactIds: [],
      prerequisiteEvidenceIds: [],
      releasedEvidenceIds: [],
      consequence: {
        id: `ambiguous-consequence-${suffix}`,
        time: { amount: 0, unit: "minutes" },
        resources: [],
        evidenceOutcome: "unavailable",
      },
      outcome: {
        kind: "unavailable",
        factIds: [],
        studentMessage: "This route must never win an equal-priority ambiguity.",
      },
    });
  }

  source.visible.evidenceSources.push({
    id: "unrelated-evidence",
    title: "Unrelated evidence",
    kind: "dataset",
    studentBrief: "This source is not selected by the tested interaction.",
  });
  source.protected.facts.push({
    id: "unrelated-fact",
    claim: "UNRELATED_FACT_CANARY",
    provenance: "UNRELATED_PROVENANCE_CANARY",
    source: { channel: "evidence", targetId: "unrelated-evidence" },
  });
  source.protected.evidenceBehaviors ??= [];
  source.protected.evidenceBehaviors.push(
    {
      evidenceSourceId: "desk-log",
      availability: "initial",
      outcomeClass: "complete",
      authoritativeFactIds: ["log-median-wait"],
      requestCues: ["response time"],
      limitations: [],
      asset: {
        sourcePath: "synthetic/desk-log.csv",
        mediaType: "text/csv",
        byteLength: 20,
        digest: zeroDigest,
      },
    },
    {
      evidenceSourceId: "unrelated-evidence",
      availability: "initial",
      outcomeClass: "complete",
      authoritativeFactIds: ["unrelated-fact"],
      requestCues: ["unrelated"],
      limitations: ["UNRELATED_EVIDENCE_CANARY"],
      asset: {
        sourcePath: "synthetic/unrelated.csv",
        mediaType: "text/csv",
        byteLength: 20,
        digest: zeroDigest,
      },
    },
  );

  const digests = createCaseVersionDigests(source);
  const receiptContent = {
    kind: "validated-case-import" as const,
    source,
    recordedVisibleBundleDigest: digests.visibleBundleDigest,
    recordedProtectedPackageDigest: digests.protectedPackageDigest,
  };
  return publishCase({
    ...receiptContent,
    validationDigest: sha256Digest(receiptContent),
  });
}

export function accessContext(
  caseVersionDigest: string,
  overrides: Partial<AssignmentAccessContext> = {},
): AssignmentAccessContext {
  return {
    assignmentId: "assignment-a",
    requestedAssignmentId: "assignment-a",
    caseId: "public-library-question-routing",
    caseVersionDigest,
    studentGithubUserId: "101",
    attemptNumber: 1,
    attemptStatus: "active",
    requiredBlindPolicy: {
      policyId: "blind-a",
      policyVersion: 1,
      assignmentId: "assignment-a",
      caseId: "public-library-question-routing",
      caseVersionDigest,
      mode: "none",
    },
    blindPolicy: {
      policyId: "blind-a",
      policyVersion: 1,
      assignmentId: "assignment-a",
      caseId: "public-library-question-routing",
      caseVersionDigest,
      mode: "none",
    },
    staffAuthorization: {
      authorizationId: "staff-a",
      githubUserId: "101",
      caseId: "public-library-question-routing",
      caseVersionDigest,
      allowedActions: ["staff-read-protected-case", "staff-evaluate"],
    },
    ...overrides,
  };
}

export class FixtureAuthorizationStore implements AssignmentAuthorizationStore {
  constructor(public snapshot: AuthorizationSnapshot) {}

  async readAuthorizationSnapshot(request: AuthorizationRequest): Promise<AuthorizationSnapshot> {
    void request;
    return structuredClone(this.snapshot);
  }

  async withLockedAuthorizationSnapshot<Result>(
    _request: AuthorizationRequest,
    run: (snapshot: AuthorizationSnapshot) => Promise<Result>,
  ): Promise<Result> {
    return run(structuredClone(this.snapshot));
  }
}

export function makeHarness() {
  const publishedCase = makeSyntheticCase();
  const caseVersionDigest = publishedCase.digests.caseVersionDigest;
  const authorizationStore = new FixtureAuthorizationStore({
    actor: {
      authUserId: "auth-101",
      githubUserId: "101",
      roles: ["student", "staff"],
    },
    context: accessContext(caseVersionDigest),
    attemptOneSubmissionAccepted: false,
  });
  const truthStateStore = new InMemoryTruthStateStore([
    createInitialTruthState({
      assignmentId: "assignment-a",
      attemptNumber: 1,
      caseVersionDigest,
      evaluationMarker: "human-evaluation-v7",
    }),
  ]);
  const operationStore = new InMemoryActionOperationStore();
  const engine = new TruthAndProviderEngine({
    authorizationStore,
    truthStateStore,
    operationStore,
    now: () => new Date("2026-09-04T18:00:00.000Z"),
  });
  return {
    publishedCase,
    caseVersionDigest,
    authorizationStore,
    truthStateStore,
    operationStore,
    engine,
  };
}

export function actionInput(
  caseVersionDigest: string,
  operationId: string,
  question: string,
  channel: "persona" | "evidence" | "collection" = "collection",
  targetId = channel === "collection" ? "collection" : "library-manager",
) {
  return {
    authUserId: "auth-101",
    assignmentId: "assignment-a",
    attemptNumber: 1,
    caseVersionDigest,
    expectedBlindPolicyVersion: 1,
    operationId,
    request: {
      assignmentId: "assignment-a",
      attemptNumber: 1,
      channel,
      targetId,
      question,
    },
  } as const;
}
