import { z } from "zod";
import type { AssignmentAuthorizationStore } from "@volta-sim/service-auth";
import type { CaseRequest, TrustedReleasedState } from "@volta-sim/core";

export const PINNED_MODEL_IDS = [
  "gpt-5-mini-2025-08-07",
  "gpt-4.1-mini-2025-04-14",
] as const;

export const PinnedModelIdSchema = z.enum(PINNED_MODEL_IDS);
export type PinnedModelId = z.infer<typeof PinnedModelIdSchema>;

const IdentifierSchema = z
  .string()
  .min(1)
  .max(160)
  .regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/);

export const RenderedOutputSchema = z
  .object({
    schemaVersion: z.literal("1"),
    outputKind: z.literal("generated-non-authoritative-wording"),
    renderedSegments: z
      .array(
        z
          .object({
            sourceKind: z.enum(["fact", "response-point"]),
            sourceId: IdentifierSchema,
            text: z.string().min(1).max(5_000),
          })
          .strict(),
      )
      .min(1)
      .max(130),
    usedFactIds: z.array(IdentifierSchema).max(100),
    usedResponsePointIds: z.array(IdentifierSchema).min(1).max(30),
  })
  .strict();

export type RenderedOutput = z.infer<typeof RenderedOutputSchema>;

export interface PromptFact {
  readonly id: string;
  readonly claim: string;
}

export interface PromptResponsePoint {
  readonly id: string;
  readonly text: string;
}

export interface PromptPersona {
  readonly id: string;
  readonly name: string;
  readonly role: string;
  readonly studentBrief: string;
  readonly incentives: readonly string[];
  readonly uncertainties: readonly string[];
  readonly biases: readonly string[];
  readonly refusalBoundaries: readonly string[];
}

export interface ProviderPromptPackage {
  readonly schemaVersion: "1";
  readonly interaction: {
    readonly channel: "persona" | "evidence" | "collection";
    readonly targetId: string;
    readonly studentText: string;
  };
  readonly persona?: PromptPersona;
  readonly officialFacts: readonly PromptFact[];
  readonly responsePoints: readonly PromptResponsePoint[];
}

export type ProviderFailureClass =
  | "timeout"
  | "refusal"
  | "unauthorized"
  | "invalid-output"
  | "oversized-output"
  | "redirect-blocked"
  | "configuration-rejected"
  | "provider-error";

export interface ProviderUsage {
  readonly inputTokens?: number;
  readonly outputTokens?: number;
}

export type ProviderRenderAttempt =
  | {
      readonly status: "success";
      readonly interactionId: string;
      readonly output: unknown;
      readonly latencyMs: number;
      readonly usage?: ProviderUsage;
    }
  | {
      readonly status: "failed";
      readonly interactionId: string;
      readonly failureClass: Exclude<ProviderFailureClass, "configuration-rejected">;
      readonly latencyMs: number;
      readonly usage?: ProviderUsage;
    };

export interface ProviderAdapter {
  readonly providerId: "openai-responses" | "capture" | "mock";
  readonly modelId: PinnedModelId;
  readonly calibration: "passed" | "flagged" | "not-run";
  render(prompt: ProviderPromptPackage): Promise<ProviderRenderAttempt>;
}

export type ConsequenceOutcomeClass =
  | "complete"
  | "partial"
  | "biased"
  | "unusable"
  | "unavailable";

export interface TimeEffect {
  readonly amount: number;
  readonly unit: "minutes" | "hours" | "days";
}

export interface ResourceEffect {
  readonly id: string;
  readonly amount: number;
  readonly unit: string;
}

export interface ReviewGuidance {
  readonly level: "low" | "moderate" | "high";
  readonly suggested: boolean;
  readonly requested: boolean;
  readonly blocksSandboxWork: false;
}

export interface OfficialTruthEvent {
  readonly eventId: string;
  readonly operationId: string;
  readonly assignmentId: string;
  readonly attemptNumber: number;
  readonly caseVersionDigest: string;
  readonly sequence: number;
  readonly routeId: string;
  readonly outcomeClass: ConsequenceOutcomeClass;
  readonly officialFactIds: readonly string[];
  readonly releasedEvidenceIds: readonly string[];
  readonly time: TimeEffect;
  readonly resources: readonly ResourceEffect[];
  readonly reviewGuidance?: ReviewGuidance;
  readonly providerInteractionId: string;
  readonly occurredAt: string;
}

export interface SimulationTruthState extends TrustedReleasedState {
  readonly stateVersion: number;
  readonly officialEvents: readonly OfficialTruthEvent[];
  readonly elapsed: Readonly<Record<TimeEffect["unit"], number>>;
  readonly resources: Readonly<Record<string, { readonly amount: number; readonly unit: string }>>;
  readonly reviewGuidance: readonly {
    readonly eventId: string;
    readonly routeId: string;
    readonly guidance: ReviewGuidance;
  }[];
  /** Opaque marker used to prove provider replay never changes human evaluation state. */
  readonly evaluationMarker: string;
}

export interface ProviderProvenanceRecord {
  readonly interactionId: string;
  readonly providerId: ProviderAdapter["providerId"];
  readonly modelId: PinnedModelId;
  readonly calibration: ProviderAdapter["calibration"];
  readonly promptPackageDigest: `sha256:${string}`;
  readonly renderedAt: string;
  readonly latencyMs: number;
  readonly usage?: ProviderUsage;
  readonly failureClass?: ProviderFailureClass;
  readonly replayOfInteractionId?: string;
}

export interface AuthoritativeFactView {
  readonly id: string;
  readonly claim: string;
  readonly provenance: string;
}

export type ActionOutcomeRecord =
  | {
      readonly kind: "applied";
      readonly operationId: string;
      readonly operationFingerprint: `sha256:${string}`;
      readonly assignmentId: string;
      readonly attemptNumber: number;
      readonly caseVersionDigest: string;
      readonly request: CaseRequest;
      readonly routeId: string;
      readonly outcomeClass: ConsequenceOutcomeClass;
      readonly authoritativeFacts: readonly AuthoritativeFactView[];
      readonly releasedEvidenceIds: readonly string[];
      readonly generatedWording: string;
      readonly generatedWordingIsAuthoritative: false;
      readonly provider: ProviderProvenanceRecord;
      readonly event: OfficialTruthEvent;
      readonly stateVersionBefore: number;
      readonly stateVersionAfter: number;
    }
  | {
      readonly kind: "unavailable" | "ambiguous";
      readonly operationId: string;
      readonly operationFingerprint: `sha256:${string}`;
      readonly assignmentId: string;
      readonly attemptNumber: number;
      readonly caseVersionDigest: string;
      readonly request: CaseRequest;
      readonly resolutionReason:
        | "out-of-universe"
        | "prerequisite-not-met"
        | "equal-top-priority";
      readonly studentMessage: string;
      readonly authoritativeFacts: readonly [];
      readonly releasedEvidenceIds: readonly [];
      readonly stateVersionBefore: number;
      readonly stateVersionAfter: number;
    }
  | {
      readonly kind: "provider-failed";
      readonly operationId: string;
      readonly operationFingerprint: `sha256:${string}`;
      readonly assignmentId: string;
      readonly attemptNumber: number;
      readonly caseVersionDigest: string;
      readonly request: CaseRequest;
      readonly routeId: string;
      readonly failureClass: ProviderFailureClass;
      readonly authoritativeFacts: readonly [];
      readonly releasedEvidenceIds: readonly [];
      readonly provider: ProviderProvenanceRecord;
      readonly stateVersionBefore: number;
      readonly stateVersionAfter: number;
    };

export type ReplayOutcomeRecord =
  | {
      readonly kind: "replayed";
      readonly operationId: string;
      readonly assignmentId: string;
      readonly attemptNumber: number;
      readonly caseVersionDigest: string;
      readonly operationFingerprint: `sha256:${string}`;
      readonly originalOperationId: string;
      readonly originalInteractionId: string;
      readonly authoritativeFacts: readonly AuthoritativeFactView[];
      readonly releasedEvidenceIds: readonly string[];
      readonly generatedWording: string;
      readonly generatedWordingIsAuthoritative: false;
      readonly provider: ProviderProvenanceRecord;
      readonly stateVersionBefore: number;
      readonly stateVersionAfter: number;
    }
  | {
      readonly kind: "provider-failed";
      readonly operationId: string;
      readonly assignmentId: string;
      readonly attemptNumber: number;
      readonly caseVersionDigest: string;
      readonly operationFingerprint: `sha256:${string}`;
      readonly originalOperationId: string;
      readonly originalInteractionId: string;
      readonly failureClass: ProviderFailureClass;
      readonly authoritativeFacts: readonly [];
      readonly releasedEvidenceIds: readonly [];
      readonly provider: ProviderProvenanceRecord;
      readonly stateVersionBefore: number;
      readonly stateVersionAfter: number;
    };

export type StoredOperationRecord = ActionOutcomeRecord | ReplayOutcomeRecord;

export interface OperationStoreBinding {
  readonly operationType: "action" | "replay";
  readonly operationFingerprint: `sha256:${string}`;
  readonly caseVersionDigest: string;
}

export interface ActionOperationStore {
  executeIdempotent(
    assignmentId: string,
    attemptNumber: number,
    operationId: string,
    binding: OperationStoreBinding,
    run: () => Promise<StoredOperationRecord>,
  ): Promise<{ readonly record: StoredOperationRecord; readonly reused: boolean }>;
  read(
    assignmentId: string,
    attemptNumber: number,
    operationId: string,
  ): Promise<StoredOperationRecord | undefined>;
}

export interface TruthStateStore {
  read(assignmentId: string, attemptNumber: number): Promise<SimulationTruthState>;
  commitEvent(input: {
    readonly assignmentId: string;
    readonly attemptNumber: number;
    readonly caseVersionDigest: string;
    readonly expectedStateVersion: number;
    /**
     * The hosted implementation must recheck this capability under the same lock or
     * transaction that appends the event. It cannot trust a capability captured before
     * async provider work.
     */
    readonly authorizationRecheck: {
      readonly actorGithubUserId: string;
      readonly action: "student-write";
      readonly blindPolicyVersion: number;
    };
    readonly event: Omit<OfficialTruthEvent, "eventId" | "sequence">;
  }): Promise<{ readonly state: SimulationTruthState; readonly event: OfficialTruthEvent }>;
}

export interface EngineDependencies {
  readonly authorizationStore: AssignmentAuthorizationStore;
  readonly truthStateStore: TruthStateStore;
  readonly operationStore: ActionOperationStore;
  readonly now?: () => Date;
}

export interface ExecuteActionInput {
  readonly authUserId: string | null;
  readonly assignmentId: string;
  readonly attemptNumber: number;
  readonly caseVersionDigest: string;
  readonly expectedBlindPolicyVersion: number;
  readonly operationId: string;
  readonly request: CaseRequest;
  readonly requestStaffReview?: boolean;
}

export interface ReplayActionInput {
  readonly authUserId: string | null;
  readonly assignmentId: string;
  readonly attemptNumber: number;
  readonly caseVersionDigest: string;
  readonly expectedBlindPolicyVersion: number;
  readonly operationId: string;
  readonly originalOperationId: string;
}
