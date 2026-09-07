import type {
  ArtifactSnapshot,
  CalculationRecord,
  DecisionRecord,
  EvidenceRecord,
  EstimateRecord,
  LedgerEntry,
  ProviderProvenance,
  SubmissionDraft,
} from "@volta-sim/contracts";
import type {
  StudentCompletenessReport,
  SubmissionCompletenessContext,
} from "@volta-sim/core";

import type { RepositoryProof } from "./repository.js";

export interface RequirementStatus {
  readonly id: string;
  readonly title: string;
  readonly status: "addressed" | "not-yet" | "not-applicable" | "missing";
}

export interface ArtifactRequirement {
  readonly required: boolean;
  readonly satisfied: boolean;
  readonly minimumCount: 0 | 1;
}

export interface StudentSuccessCriterion {
  readonly metric: string;
  readonly baseline?: string;
  readonly baselinePlan?: string;
  readonly target: string;
  readonly targetDate: string;
  readonly failureThreshold: string;
}

export interface CriterionReasoningHistoryEntry {
  readonly kind: "criterion-recorded" | "criterion-removed";
  readonly operationId: string;
  readonly attemptNumber: number;
  readonly recordedAt: string;
  readonly criterionId: string;
  readonly criterion: StudentSuccessCriterion;
}

export interface CalculationHistoryEntry {
  readonly kind: "calculation-recorded" | "calculation-removed";
  readonly operationId: string;
  readonly attemptNumber: number;
  readonly recordedAt: string;
  readonly calculation: CalculationRecord;
}

export type StudentServiceErrorCode =
  | "ACTION_UNAVAILABLE"
  | "ATTEMPT_SUBMITTED"
  | "CRITERION_NOT_FOUND"
  | "CALCULATION_NOT_FOUND"
  | "INVALID_CALCULATION"
  | "INVALID_EVIDENCE_REFERENCE"
  | "INVALID_INPUT"
  | "LOGIN_REPLAY_UNAVAILABLE"
  | "OPERATION_ID_CONFLICT"
  | "REPOSITORY_MISMATCH"
  | "RETRY_SAME_OPERATION"
  | "SESSION_UNAVAILABLE";

export interface StudentAssignmentView {
  readonly assignmentId: string;
  readonly attemptNumber: number;
  readonly attemptStatus: "active" | "submitted";
  readonly reopenedFromAttempt?: number;
  readonly caseVersionDigest: string;
  readonly repository: {
    readonly slug: string;
    readonly commitSha: string;
    readonly sessionIgnoreBlobId: string;
  };
  readonly brief: string;
  readonly constraints: readonly string[];
  readonly unacceptableOutcomes: readonly string[];
  readonly responseFamilies: readonly string[];
  readonly difficulty: {
    readonly audience: string;
    readonly experienceLevel: "introductory" | "intermediate" | "advanced";
    readonly factors: readonly {
      readonly id: string;
      readonly dimension:
        | "ambiguity"
        | "data-availability"
        | "stakeholder-complexity"
        | "solution-risk"
        | "economic-uncertainty";
      readonly level: "low" | "medium" | "high";
      readonly rationale: string;
    }[];
  };
  readonly rubric: readonly { readonly id: string; readonly prompt: string }[];
  readonly requirements: readonly RequirementStatus[];
  readonly completeness: {
    readonly complete: boolean;
    readonly missingPaths: readonly string[];
  };
  readonly baseReadiness: StudentCompletenessReport;
  readonly readiness: StudentCompletenessReport;
  readonly artifactRequirement: ArtifactRequirement;
  readonly availablePersonas: readonly {
    readonly id: string;
    readonly name: string;
    readonly role: string;
    readonly brief: string;
    readonly description: string;
  }[];
  readonly availableEvidence: readonly {
    readonly id: string;
    readonly title: string;
    readonly kind: "file" | "dataset" | "system-query" | "collection-opportunity";
    readonly brief: string;
    readonly description: string;
  }[];
  readonly availableCollectionMethods: readonly {
    readonly id: string;
    readonly description: string;
  }[];
  readonly capturedLedger: readonly LedgerEntry[];
  readonly capturedEvidence: readonly EvidenceRecord[];
  readonly successCriteria: readonly {
    readonly criterionId: string;
    readonly metric: string;
    readonly baseline?: string;
    readonly baselinePlan?: string;
    readonly target: string;
    readonly targetDate: string;
    readonly failureThreshold: string;
    readonly valid: boolean;
  }[];
  readonly reasoningHistory: readonly CriterionReasoningHistoryEntry[];
  readonly calculations?: readonly CalculationRecord[];
  readonly calculationHistory?: readonly CalculationHistoryEntry[];
  readonly releasedEvidence: readonly {
    readonly factId: string;
    readonly claim: string;
    readonly provenance: string;
    readonly eventId: string;
  }[];
  readonly recentEvents: readonly {
    readonly eventId: string;
    readonly eventType: string;
    readonly message: string;
  }[];
  readonly stage: string;
  /** The case's own clock. Persona and evidence replies may advance it. */
  readonly simulatedAt: string;
  readonly pendingReview: boolean;
  readonly reviewUpdates: readonly {
    readonly topic: string;
    readonly status: "pending" | "resolved";
    readonly response?: string;
    readonly resolvedAt?: string;
  }[];
  readonly attemptHistory: readonly {
    readonly attemptNumber: number;
    readonly status: "submitted";
    readonly submissionDigest: string;
    readonly eventCount: number;
    readonly citedOfficialFactIds: readonly string[];
    readonly operationReceiptCount: number;
    readonly reasoningHistory: readonly CriterionReasoningHistoryEntry[];
    readonly calculationHistory?: readonly CalculationHistoryEntry[];
  }[];
}

export interface OfficialActionEvent {
  readonly eventId: string;
  readonly sequence: number;
  readonly eventType: string;
  readonly message: string;
  readonly officialFactIds: readonly string[];
  readonly provenance: readonly { readonly factId: string; readonly source: string }[];
  readonly simulatedAt: string;
}

export type StudentServiceRequest =
  | { readonly kind: "login"; readonly operationId: string }
  | { readonly kind: "resume" }
  | { readonly kind: "status" }
  | {
      readonly kind: "talk";
      readonly operationId: string;
      readonly personaId: string;
      readonly question: string;
    }
  | {
      readonly kind: "evidence";
      readonly operationId: string;
      readonly evidenceSourceId: string;
      readonly question: string;
    }
  | {
      readonly kind: "collect";
      readonly operationId: string;
      readonly methodId: string;
      readonly plan: string;
    }
  | {
      readonly kind: "advance";
      readonly operationId: string;
      readonly days: number;
      readonly reason: string;
    }
  | {
      readonly kind: "ledger";
      readonly operationId: string;
      readonly entry: Omit<LedgerEntry, "id" | "createdAt">;
    }
  | {
      readonly kind: "decision";
      readonly operationId: string;
      readonly decision: Omit<DecisionRecord, "id" | "createdAt">;
    }
  | {
      readonly kind: "estimate";
      readonly operationId: string;
      readonly estimate: Omit<EstimateRecord, "id" | "createdAt">;
    }
  | {
      readonly kind: "requirement";
      readonly operationId: string;
      readonly requirementId: string;
      readonly status: "addressed" | "not-yet" | "not-applicable";
      readonly rationale: string;
      readonly evidenceIds: readonly string[];
    }
  | {
      readonly kind: "claim";
      readonly operationId: string;
      readonly competencyId:
        | "problem-viability"
        | "evidence-sufficiency"
        | "response-feasibility"
        | "objective-success-criteria";
      readonly rationale: string;
      readonly evidenceIds: readonly string[];
    }
  | {
      readonly kind: "draft";
      readonly operationId: string;
      readonly mode: "build" | "pilot" | "buy" | "no-build" | "data-collection";
      readonly rationale: string;
      readonly feasibility: string;
      readonly risks: readonly string[];
      readonly missingDataPlan: string;
      readonly economicRationale: string;
    }
  | {
      readonly kind: "criterion";
      readonly operationId: string;
      readonly criterion: {
        readonly metric: string;
        readonly baseline?: string;
        readonly baselinePlan?: string;
        readonly target: string;
        readonly targetDate: string;
        readonly failureThreshold: string;
      };
    }
  | {
      readonly kind: "criterion-remove";
      readonly operationId: string;
      readonly criterionId: string;
    }
  | {
      readonly kind: "calculation";
      readonly operationId: string;
      readonly calculation: Omit<CalculationRecord, "id">;
    }
  | { readonly kind: "checkpoint" }
  | { readonly kind: "calculation-remove"; readonly operationId: string; readonly calculationId: string }
  | { readonly kind: "prepare-submission" }
  | {
      readonly kind: "review-request";
      readonly operationId: string;
      readonly topic: string;
      readonly studentChoice: "continue" | "wait" | "decline";
    }
  | {
      readonly kind: "submit";
      readonly operationId: string;
      readonly draft: SubmissionDraft;
      readonly artifacts: readonly ArtifactSnapshot[];
      readonly repository: RepositoryProof;
      readonly mode: "build" | "pilot" | "buy" | "no-build" | "data-collection";
    }
  | { readonly kind: "logout"; readonly operationId: string };

export type StudentServiceResponse =
  | {
      readonly kind: "login";
      readonly token: string;
      readonly assignmentId: string;
      readonly repository: {
        readonly slug: string;
        readonly commitSha: string;
        readonly sessionIgnoreBlobId: string;
      };
    }
  | { readonly kind: "view"; readonly view: StudentAssignmentView }
  | {
      readonly kind: "action";
      readonly message: string;
      readonly event?: OfficialActionEvent;
      readonly checkpointPrompts: readonly string[];
      readonly reviewSuggested: boolean;
      /** Present whenever reviewSuggested is true: why, and what the student can do about it. */
      readonly reviewSuggestion?: { readonly reason: string; readonly nextStep: string };
      /** Present when the action advanced the simulated clock. */
      readonly simulatedTime?: {
        readonly advancedBy: { readonly amount: number; readonly unit: "minutes" | "hours" | "days" };
        readonly now: string;
      };
      /** Plain-language note on what the reply means for the student's next move. */
      readonly guidance?: string;
      readonly sandboxWorkBlocked: false;
      readonly replayed: boolean;
      readonly recorded?:
        | {
            readonly kind: "ledger";
            readonly ledgerEntryId: string;
            readonly evidenceIds: readonly string[];
          }
        | { readonly kind: "criterion"; readonly criterionId: string }
        | { readonly kind: "criterion-removal"; readonly criterionId: string }
        | { readonly kind: "calculation" | "calculation-removal"; readonly calculationId: string }
        | { readonly kind: "estimate"; readonly estimateId: string }
        | { readonly kind: "decision"; readonly decisionId: string }
        | { readonly kind: "requirement"; readonly requirementId: string }
        | { readonly kind: "claim"; readonly competencyId: string }
        | { readonly kind: "draft"; readonly mode: string };
    }
  | { readonly kind: "checkpoint"; readonly prompts: readonly string[] }
  | {
      readonly kind: "preparation";
      readonly ready: boolean;
      readonly baseReady: boolean;
      readonly submissionBase?: SubmissionDraft;
      readonly requestedMode?: "build" | "pilot" | "buy" | "no-build" | "data-collection";
      readonly baseReport: StudentCompletenessReport;
      readonly report: StudentCompletenessReport;
      readonly artifactRequirement: ArtifactRequirement;
    }
  | {
      readonly kind: "submission";
      readonly accepted: boolean;
      readonly attemptNumber: number;
      readonly submissionDigest?: string;
      readonly report: StudentCompletenessReport;
      readonly replayed: boolean;
    }
  | { readonly kind: "logout"; readonly replayed: boolean };

export interface StudentServiceClient {
  execute(request: StudentServiceRequest, token?: string): Promise<StudentServiceResponse>;
}

export interface ScriptedOfficialAction {
  readonly action: "talk" | "evidence" | "collect";
  readonly targetId: string;
  readonly message: string;
  readonly officialFactIds: readonly string[];
  readonly reviewSuggested?: boolean;
  readonly simulatedDays?: number;
  readonly provider?: Omit<ProviderProvenance, "eventId" | "renderedAt">;
}

export interface MockOfficialEvent extends OfficialActionEvent {
  readonly interview?: { readonly personaId: string; readonly question: string };
  readonly providerInteractionId?: string;
  readonly releasedEvidenceIds?: readonly string[];
}

export interface MockStudentServiceState {
  readonly version: 1;
  readonly assignmentId: string;
  readonly studentGithubUserId: string;
  attempt: {
    assignmentId: string;
    studentGithubUserId: string;
    caseVersionDigest: string;
    attemptNumber: number;
    openedAt: string;
    status: "active" | "submitted";
    submission?: unknown;
  };
  reopenedFromAttempt?: number;
  attemptHistory: {
    readonly attempt: MockStudentServiceState["attempt"];
    readonly events: readonly MockOfficialEvent[];
    readonly providerProvenance: readonly ProviderProvenance[];
    readonly reviewRequests: readonly MockStudentServiceState["reviewRequests"][number][];
    readonly operations: MockStudentServiceState["operations"];
    readonly reasoningHistory: readonly CriterionReasoningHistoryEntry[];
    readonly calculationHistory?: readonly CalculationHistoryEntry[];
  }[];
  readonly submissionContext: SubmissionCompletenessContext;
  readonly expectedRepository: {
    readonly slug: string;
    readonly commitSha: string;
    readonly sessionIgnoreBlobId: string;
    readonly selectedBlobs: Readonly<Record<string, string>>;
  };
  workingDraft: Record<string, unknown>;
  successCriterionIds?: string[];
  reasoningHistory?: CriterionReasoningHistoryEntry[];
  calculationHistory?: CalculationHistoryEntry[];
  readonly useAuthoredRoutes?: boolean;
  stage: string;
  simulatedAt: string;
  readonly scriptedActions: readonly ScriptedOfficialAction[];
  events: MockOfficialEvent[];
  providerProvenance: ProviderProvenance[];
  reviewRequests: {
    readonly reviewRequestId?: string;
    readonly topic: string;
    readonly studentChoice: "continue" | "wait";
    readonly createdAt: string;
    status: "pending" | "resolved";
    response?: string;
    resolvedAt?: string;
  }[];
  operations: Record<
    string,
    {
      readonly attemptNumber: number;
      readonly fingerprint: string;
      readonly response: Exclude<StudentServiceResponse, { kind: "login" }>;
    }
  >;
  loginOperations: Record<string, { readonly fingerprint: string; readonly tokenDigest: string }>;
  activeTokenDigest?: string;
  tokenExpiresAt?: string;
  tokenRevokedAt?: string;
}
