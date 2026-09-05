import type { verifySubmissionRecord } from "@volta-sim/core";

import type {
  AcceptedSubmissionProjection,
  BaselineKind,
  ProviderDisplayRecord,
  ReplayComparisonView,
  ReopenResult,
  ResponseMode,
  ReviewRequestRecord,
  ReviewResponseRecord,
  StaffEvaluationRecord,
  SubmissionArtifactReceipt,
  TextArtifact,
  TrustedProviderRecordReceipt,
} from "./domain.js";

export interface StaffOfficialTimelineEvent {
  readonly assignmentId: string;
  readonly attemptNumber: number;
  readonly caseVersionDigest: string;
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
  readonly source: "official-event-store" | "file-backed-mock-student-service";
  readonly officialEventReceiptId?: string;
}

export interface StaffAssignmentProjection {
  readonly assignmentId: string;
  readonly caseId: string;
  readonly caseTitle: string;
  readonly studentLabel: string;
  readonly caseVersionDigest: string;
  readonly attemptNumber: number;
  readonly lifecycleState:
    | "provisioning"
    | "active"
    | "review-requested"
    | "submitted"
    | "reopened"
    | "closed";
  readonly repositoryReadback: "pending" | "ready" | "failed";
  readonly stateAuthority:
    | "persisted-service-and-provider-readback"
    | "file-backed-mock-student-service";
  readonly timeline: readonly StaffOfficialTimelineEvent[];
}

export const STAFF_DASHBOARD_API = Object.freeze({
  snapshot: "/api/staff-dashboard",
  reviewResponses: "/api/staff-dashboard/review-responses",
  evaluations: "/api/staff-dashboard/evaluations",
  replays: "/api/staff-dashboard/replays",
  reopens: "/api/staff-dashboard/reopens",
});

export interface StaffCaseRecord {
  readonly caseId: string;
  readonly title: string;
  readonly state:
    | "draft"
    | "needs-validation"
    | "needs-calibration"
    | "ready-for-approval"
    | "published";
  readonly version: string;
  readonly detail: string;
  readonly source: string;
}

export interface StaffSubmissionPacket {
  readonly submissionId: string;
  readonly submissionDigest: `sha256:${string}`;
  readonly responseMode: ResponseMode;
  readonly responseSummary: string;
  readonly baselineKind: BaselineKind;
  readonly baselineDetail: string;
  readonly facts: readonly { readonly id: string; readonly claim: string }[];
  readonly assumptions: readonly string[];
  readonly contradictions: readonly string[];
  readonly unknowns: readonly string[];
  readonly missingDataPlan: string;
  readonly successCriteria: readonly string[];
  readonly reasoning?: Pick<
    ReturnType<typeof verifySubmissionRecord>,
    | "ledger"
    | "evidence"
    | "decision"
    | "estimates"
    | "requirementAssessments"
    | "competencyClaims"
    | "successCriteria"
    | "calculations"
    | "economicRationale"
    | "responsePlan"
  >;
}

export interface ReleasedEvidenceRecord {
  readonly evidenceId: string;
  readonly title: string;
  readonly detail: string;
  readonly source: "FROZEN CASE UNIVERSE" | "FILE-BACKED MOCK STUDENT SERVICE";
  readonly contentType: "text/csv" | "application/json" | "text/markdown";
  readonly relativePath: string;
  readonly supportsOfficialFactIds: readonly string[];
  readonly content: string;
}

export interface StaffReviewHistoryItem {
  readonly reviewRequestId: string;
  readonly topic: string;
  readonly studentChoice: "continue" | "wait";
  readonly createdAt: string;
  readonly status: "pending" | "resolved";
  readonly response?: string;
  readonly resolvedAt?: string;
}

export interface StaffAssignmentBundle {
  readonly assignment: StaffAssignmentProjection;
  readonly blocked?: {
    readonly title: string;
    readonly detail: string;
  };
  readonly reviewRequest?: ReviewRequestRecord;
  readonly reviewPrompt?: string;
  readonly reviewHistory?: readonly StaffReviewHistoryItem[];
  readonly submission?: StaffSubmissionPacket;
  readonly acceptedSubmission?: AcceptedSubmissionProjection;
  readonly originalProviderRecord?: ProviderDisplayRecord;
  readonly replayProviderRecord?: ProviderDisplayRecord;
  readonly providerRecordReceipts?: readonly TrustedProviderRecordReceipt[];
  readonly artifacts?: readonly TextArtifact[];
  readonly artifactReceipts?: readonly SubmissionArtifactReceipt[];
  readonly releasedEvidence?: readonly ReleasedEvidenceRecord[];
  readonly replayUnavailableReason?: string;
  readonly attemptHistory?: readonly {
    readonly attemptNumber: number;
    readonly status: "submitted";
    readonly submissionId: string;
    readonly submissionDigest: string;
    readonly eventCount: number;
    readonly reviewResponse?: ReviewResponseRecord;
    readonly reviewResponses?: readonly ReviewResponseRecord[];
    readonly reviewHistory?: readonly StaffReviewHistoryItem[];
    readonly submission?: StaffSubmissionPacket;
    readonly evaluation?: StaffEvaluationRecord;
    readonly reopen?: StoredReopenRecord;
  }[];
}

export interface StoredReplayRecord {
  readonly operationId: string;
  readonly comparison: ReplayComparisonView;
}

export interface StoredReopenRecord {
  readonly operationId: string;
  readonly result: ReopenResult;
}

export interface StaffDashboardSnapshot {
  readonly adapterVersion: "staff-dashboard-v1";
  readonly environment: {
    readonly kind: "local-fixture" | "connected-local-student-state" | "live-service";
    readonly label: string;
  };
  readonly revision: number;
  readonly cases: readonly StaffCaseRecord[];
  readonly assignments: readonly StaffAssignmentBundle[];
  readonly operations: {
    readonly reviewResponses: Readonly<Record<string, ReviewResponseRecord>>;
    readonly evaluations: Readonly<Record<string, StaffEvaluationRecord>>;
    readonly replays: Readonly<Record<string, StoredReplayRecord>>;
    readonly reopens: Readonly<Record<string, StoredReopenRecord>>;
    readonly history: {
      readonly reviewResponses: Readonly<Record<string, readonly ReviewResponseRecord[]>>;
      readonly evaluations: Readonly<Record<string, readonly StaffEvaluationRecord[]>>;
      readonly reopens: Readonly<Record<string, readonly StoredReopenRecord[]>>;
    };
  };
}

export interface StaffDashboardAdapter {
  loadDashboard(): Promise<StaffDashboardSnapshot>;
  recordReviewResponse(input: {
    readonly assignmentId: string;
    readonly operationId: string;
    readonly reviewRequestId?: string;
    readonly responseText: string;
  }): Promise<StaffDashboardSnapshot>;
  recordEvaluation(input: {
    readonly assignmentId: string;
    readonly operationId: string;
    readonly draft: unknown;
  }): Promise<StaffDashboardSnapshot>;
  createReplay(input: {
    readonly assignmentId: string;
    readonly operationId: string;
  }): Promise<StaffDashboardSnapshot>;
  reopenAttempt(input: {
    readonly assignmentId: string;
    readonly operationId: string;
  }): Promise<StaffDashboardSnapshot>;
}
