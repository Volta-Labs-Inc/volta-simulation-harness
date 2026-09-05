import { createHash } from "node:crypto";
import { PinnedModelIdSchema, RenderedOutputSchema } from "./types.js";
import { prepareAction, prepareReplayPrompt } from "./prompt.js";
import { withAssignmentAuthorization } from "@volta-sim/service-auth";
import type { resolveAuthoredRequest } from "@volta-sim/core";
import { z } from "zod";
import type {
  ActionOutcomeRecord,
  EngineDependencies,
  ExecuteActionInput,
  ProviderAdapter,
  ProviderFailureClass,
  ProviderPromptPackage,
  ProviderProvenanceRecord,
  ProviderRenderAttempt,
  ReplayActionInput,
  ReplayOutcomeRecord,
  StoredOperationRecord,
} from "./types.js";

type PublishedCase = Parameters<typeof resolveAuthoredRequest>[0];

const operationIdPattern = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const interactionIdPattern = /^[A-Za-z0-9]+(?:[._-][A-Za-z0-9]+)*$/;
const providerIds = new Set(["openai-responses", "capture", "mock"]);
const calibrations = new Set(["passed", "flagged", "not-run"]);
const failureClasses = new Set<ProviderFailureClass>([
  "timeout",
  "refusal",
  "unauthorized",
  "invalid-output",
  "oversized-output",
  "redirect-blocked",
  "configuration-rejected",
  "provider-error",
]);
const ProviderUsageSchema = z
  .object({
    inputTokens: z.number().int().nonnegative().max(1_000_000_000).optional(),
    outputTokens: z.number().int().nonnegative().max(1_000_000_000).optional(),
  })
  .strict();
const ProviderAttemptSchema = z.discriminatedUnion("status", [
  z
    .object({
      status: z.literal("success"),
      interactionId: z.string().min(1).max(160).regex(interactionIdPattern),
      output: z.unknown(),
      latencyMs: z.number().int().nonnegative().max(300_000),
      usage: ProviderUsageSchema.optional(),
    })
    .strict(),
  z
    .object({
      status: z.literal("failed"),
      interactionId: z.string().min(1).max(160).regex(interactionIdPattern),
      failureClass: z.enum([
        "timeout",
        "refusal",
        "unauthorized",
        "invalid-output",
        "oversized-output",
        "redirect-blocked",
        "provider-error",
      ]),
      latencyMs: z.number().int().nonnegative().max(300_000),
      usage: ProviderUsageSchema.optional(),
    })
    .strict(),
]);

function assertOperationId(operationId: string): void {
  if (operationId.length > 160 || !operationIdPattern.test(operationId)) {
    throw new Error("Operation IDs must be stable lowercase identifiers");
  }
}

function assertInputBindings(input: ExecuteActionInput | ReplayActionInput, publishedCase: PublishedCase): void {
  assertOperationId(input.operationId);
  if (input.assignmentId.length === 0 || input.attemptNumber < 1 || !Number.isInteger(input.attemptNumber)) {
    throw new Error("The action needs one valid assignment attempt");
  }
  if (publishedCase.digests.caseVersionDigest !== input.caseVersionDigest) {
    throw new Error("The action is not bound to this frozen case version");
  }
  if ("request" in input) {
    if (
      input.request.assignmentId !== input.assignmentId ||
      input.request.attemptNumber !== input.attemptNumber
    ) {
      throw new Error("The interaction does not belong to the requested assignment attempt");
    }
  }
}

function sameUniqueIds(actual: readonly string[], expected: readonly string[]): boolean {
  if (new Set(actual).size !== actual.length || new Set(expected).size !== expected.length) {
    return false;
  }
  return JSON.stringify([...actual].sort()) === JSON.stringify([...expected].sort());
}

function validateAdapter(adapter: ProviderAdapter): ProviderFailureClass | undefined {
  if (!providerIds.has(adapter.providerId) || !calibrations.has(adapter.calibration)) {
    return "configuration-rejected";
  }
  const model = PinnedModelIdSchema.safeParse(adapter.modelId);
  return model.success ? undefined : "configuration-rejected";
}

function assertProviderAdapter(adapter: ProviderAdapter): void {
  if (validateAdapter(adapter) !== undefined) {
    throw new Error("Unsupported provider configuration");
  }
}

function deterministicDigest(value: unknown): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

function actionFingerprint(input: ExecuteActionInput, adapter: ProviderAdapter): `sha256:${string}` {
  return deterministicDigest({
    operationType: "action",
    authUserId: input.authUserId,
    assignmentId: input.assignmentId,
    attemptNumber: input.attemptNumber,
    caseVersionDigest: input.caseVersionDigest,
    expectedBlindPolicyVersion: input.expectedBlindPolicyVersion,
    request: {
      assignmentId: input.request.assignmentId,
      attemptNumber: input.request.attemptNumber,
      channel: input.request.channel,
      targetId: input.request.targetId,
      question: input.request.question,
    },
    requestStaffReview: input.requestStaffReview ?? false,
    provider: {
      providerId: adapter.providerId,
      modelId: adapter.modelId,
      calibration: adapter.calibration,
    },
  });
}

function replayFingerprint(input: ReplayActionInput, adapter: ProviderAdapter): `sha256:${string}` {
  return deterministicDigest({
    operationType: "replay",
    authUserId: input.authUserId,
    assignmentId: input.assignmentId,
    attemptNumber: input.attemptNumber,
    caseVersionDigest: input.caseVersionDigest,
    expectedBlindPolicyVersion: input.expectedBlindPolicyVersion,
    originalOperationId: input.originalOperationId,
    provider: {
      providerId: adapter.providerId,
      modelId: adapter.modelId,
      calibration: adapter.calibration,
    },
  });
}

interface ValidatedAttempt {
  readonly succeeded: boolean;
  readonly renderedText?: string;
  readonly failureClass?: ProviderFailureClass;
  readonly provenance: ProviderProvenanceRecord;
}

function provenanceFor(
  adapter: ProviderAdapter,
  attempt: {
    readonly interactionId: string;
    readonly latencyMs: number;
    readonly usage?: {
      readonly inputTokens?: number | undefined;
      readonly outputTokens?: number | undefined;
    } | undefined;
  },
  promptDigest: `sha256:${string}`,
  renderedAt: string,
  failureClass?: ProviderFailureClass,
  replayOfInteractionId?: string,
): ProviderProvenanceRecord {
  const usage =
    attempt.usage === undefined
      ? undefined
      : {
          ...(attempt.usage.inputTokens === undefined
            ? {}
            : { inputTokens: attempt.usage.inputTokens }),
          ...(attempt.usage.outputTokens === undefined
            ? {}
            : { outputTokens: attempt.usage.outputTokens }),
        };
  return {
    interactionId: attempt.interactionId,
    providerId: adapter.providerId,
    modelId: adapter.modelId,
    calibration: adapter.calibration,
    promptPackageDigest: promptDigest,
    renderedAt,
    latencyMs: attempt.latencyMs,
    ...(usage === undefined ? {} : { usage }),
    ...(failureClass === undefined ? {} : { failureClass }),
    ...(replayOfInteractionId === undefined ? {} : { replayOfInteractionId }),
  };
}

function validateAttempt(
  adapter: ProviderAdapter,
  attemptInput: unknown,
  prompt: ProviderPromptPackage,
  promptDigest: `sha256:${string}`,
  renderedAt: string,
  replayOfInteractionId?: string,
): ValidatedAttempt {
  const parsedAttempt = ProviderAttemptSchema.safeParse(attemptInput);
  const missingSuccessOutput =
    parsedAttempt.success &&
    parsedAttempt.data.status === "success" &&
    (typeof attemptInput !== "object" ||
      attemptInput === null ||
      !Object.prototype.hasOwnProperty.call(attemptInput, "output"));
  if (!parsedAttempt.success || missingSuccessOutput) {
    const safeAttempt: ProviderRenderAttempt = {
      status: "failed",
      interactionId: "provider-invalid-attempt",
      failureClass: "provider-error",
      latencyMs: 0,
    };
    return {
      succeeded: false,
      failureClass: "invalid-output",
      provenance: provenanceFor(
        adapter,
        safeAttempt,
        promptDigest,
        renderedAt,
        "invalid-output",
        replayOfInteractionId,
      ),
    };
  }
  const attempt = parsedAttempt.data;
  if (attempt.status === "failed") {
    const failureClass = failureClasses.has(attempt.failureClass)
      ? attempt.failureClass
      : "provider-error";
    return {
      succeeded: false,
      failureClass,
      provenance: provenanceFor(
        adapter,
        attempt,
        promptDigest,
        renderedAt,
        failureClass,
        replayOfInteractionId,
      ),
    };
  }

  let encoded: string;
  try {
    encoded = JSON.stringify(attempt.output) ?? "";
  } catch {
    encoded = "";
  }
  if (Buffer.byteLength(encoded, "utf8") > 20_000) {
    return {
      succeeded: false,
      failureClass: "oversized-output",
      provenance: provenanceFor(
        adapter,
        attempt,
        promptDigest,
        renderedAt,
        "oversized-output",
        replayOfInteractionId,
      ),
    };
  }
  const parsed = RenderedOutputSchema.safeParse(attempt.output);
  const expectedFactIds = prompt.officialFacts.map(({ id }) => id);
  const expectedPointIds = prompt.responsePoints.map(({ id }) => id);
  const allowedSegments = new Map([
    ...prompt.officialFacts.map(({ id, claim }) => [`fact:${id}`, claim] as const),
    ...prompt.responsePoints.map(({ id, text }) => [`response-point:${id}`, text] as const),
  ]);
  const renderedSegments = parsed.success ? parsed.data.renderedSegments : [];
  const renderedSegmentKeys = renderedSegments.map(
    ({ sourceKind, sourceId }) => `${sourceKind}:${sourceId}`,
  );
  const expectedSegmentKeys = [...allowedSegments.keys()];
  const renderedText = renderedSegments.map(({ text }) => text).join(" ");
  if (
    !parsed.success ||
    Buffer.byteLength(renderedText, "utf8") > 10_000 ||
    !sameUniqueIds(renderedSegmentKeys, expectedSegmentKeys) ||
    renderedSegments.some(
      ({ sourceKind, sourceId, text }) =>
        allowedSegments.get(`${sourceKind}:${sourceId}`) !== text,
    ) ||
    !sameUniqueIds(parsed.data.usedFactIds, expectedFactIds) ||
    !sameUniqueIds(parsed.data.usedResponsePointIds, expectedPointIds)
  ) {
    return {
      succeeded: false,
      failureClass: "invalid-output",
      provenance: provenanceFor(
        adapter,
        attempt,
        promptDigest,
        renderedAt,
        "invalid-output",
        replayOfInteractionId,
      ),
    };
  }
  return {
    succeeded: true,
    renderedText,
    provenance: provenanceFor(
      adapter,
      attempt,
      promptDigest,
      renderedAt,
      undefined,
      replayOfInteractionId,
    ),
  };
}

async function renderSafely(
  adapter: ProviderAdapter,
  prompt: ProviderPromptPackage,
): Promise<unknown> {
  const providerPrompt = deepFreeze(structuredClone(prompt));
  try {
    return await adapter.render(providerPrompt);
  } catch {
    return {
      status: "failed",
      interactionId: "provider-threw",
      failureClass: "provider-error",
      latencyMs: 0,
    };
  }
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}

function isActionRecord(record: StoredOperationRecord): record is ActionOutcomeRecord {
  return record.kind !== "replayed" && !("originalOperationId" in record);
}

function isReplayRecord(record: StoredOperationRecord): record is ReplayOutcomeRecord {
  return record.kind === "replayed" || "originalOperationId" in record;
}

export class TruthAndProviderEngine {
  private readonly now: () => Date;

  constructor(private readonly dependencies: EngineDependencies) {
    this.now = dependencies.now ?? (() => new Date());
  }

  async executeAction(
    publishedCase: PublishedCase,
    input: ExecuteActionInput,
    adapter: ProviderAdapter,
  ): Promise<{ readonly outcome: ActionOutcomeRecord; readonly reused: boolean }> {
    assertProviderAdapter(adapter);
    const frozenCase = deepFreeze(structuredClone(publishedCase));
    assertInputBindings(input, frozenCase);
    const operationFingerprint = actionFingerprint(input, adapter);
    const authorizationRequest = {
      authUserId: input.authUserId,
      assignmentId: input.assignmentId,
      action: "student-write" as const,
      expectedBlindPolicyVersion: input.expectedBlindPolicyVersion,
      expectedCaseVersionDigest: input.caseVersionDigest,
      expectedAttemptNumber: input.attemptNumber,
    };

    await withAssignmentAuthorization(
      this.dependencies.authorizationStore,
      authorizationRequest,
      async (capability) => {
        if (capability.assignmentId !== input.assignmentId) {
          throw new Error("The elevated capability belongs to a different assignment");
        }
      },
    );

    const result = await this.dependencies.operationStore.executeIdempotent(
      input.assignmentId,
      input.attemptNumber,
      input.operationId,
      {
        operationType: "action",
        operationFingerprint,
        caseVersionDigest: input.caseVersionDigest,
      },
      async () => {
        const preparedState = await withAssignmentAuthorization(
          this.dependencies.authorizationStore,
          authorizationRequest,
          async (capability) => {
            if (capability.assignmentId !== input.assignmentId) {
              throw new Error("The elevated capability belongs to a different assignment");
            }
            const state = await this.dependencies.truthStateStore.read(
              input.assignmentId,
              input.attemptNumber,
            );
            if (state.caseVersionDigest !== input.caseVersionDigest) {
              throw new Error("Trusted state belongs to a different case version");
            }
            return { state, prepared: prepareAction(frozenCase, input.request, state) };
          },
        );
        const { state, prepared } = preparedState;
        if (prepared.status !== "ready") {
          return {
            kind: prepared.status,
            operationId: input.operationId,
            operationFingerprint,
            assignmentId: input.assignmentId,
            attemptNumber: input.attemptNumber,
            caseVersionDigest: input.caseVersionDigest,
            request: structuredClone(input.request),
            resolutionReason: prepared.reason,
            studentMessage: prepared.studentMessage,
            authoritativeFacts: [],
            releasedEvidenceIds: [],
            stateVersionBefore: state.stateVersion,
            stateVersionAfter: state.stateVersion,
          } satisfies ActionOutcomeRecord;
        }

        const attempt = await renderSafely(adapter, prepared.plan.prompt);
        const renderedAt = this.now().toISOString();
        const validated = validateAttempt(
          adapter,
          attempt,
          prepared.plan.prompt,
          prepared.plan.promptPackageDigest,
          renderedAt,
        );
        if (!validated.succeeded) {
          return {
            kind: "provider-failed",
            operationId: input.operationId,
            operationFingerprint,
            assignmentId: input.assignmentId,
            attemptNumber: input.attemptNumber,
            caseVersionDigest: input.caseVersionDigest,
            request: structuredClone(input.request),
            routeId: prepared.plan.route.id,
            failureClass: validated.failureClass!,
            authoritativeFacts: [],
            releasedEvidenceIds: [],
            provider: validated.provenance,
            stateVersionBefore: state.stateVersion,
            stateVersionAfter: state.stateVersion,
          } satisfies ActionOutcomeRecord;
        }

        const reviewGuidance =
          prepared.plan.reviewGuidance === undefined
            ? undefined
            : {
                ...prepared.plan.reviewGuidance,
                requested: input.requestStaffReview ?? false,
              };
        const committed = await withAssignmentAuthorization(
          this.dependencies.authorizationStore,
          authorizationRequest,
          async (capability) =>
            this.dependencies.truthStateStore.commitEvent({
              assignmentId: input.assignmentId,
              attemptNumber: input.attemptNumber,
              caseVersionDigest: input.caseVersionDigest,
              expectedStateVersion: state.stateVersion,
              authorizationRecheck: {
                actorGithubUserId: capability.actorGithubUserId,
                action: "student-write",
                blindPolicyVersion: capability.blindPolicyVersion,
              },
              event: {
                operationId: input.operationId,
                assignmentId: input.assignmentId,
                attemptNumber: input.attemptNumber,
                caseVersionDigest: input.caseVersionDigest,
                routeId: prepared.plan.route.id,
                outcomeClass: prepared.plan.outcomeClass,
                officialFactIds: prepared.plan.authoritativeFacts.map(({ id }) => id),
                releasedEvidenceIds: prepared.plan.releasedEvidenceIds,
                time: prepared.plan.time,
                resources: prepared.plan.resources,
                ...(reviewGuidance === undefined ? {} : { reviewGuidance }),
                providerInteractionId: validated.provenance.interactionId,
                occurredAt: renderedAt,
              },
            }),
        );
        return {
          kind: "applied",
          operationId: input.operationId,
          operationFingerprint,
          assignmentId: input.assignmentId,
          attemptNumber: input.attemptNumber,
          caseVersionDigest: input.caseVersionDigest,
          request: structuredClone(input.request),
          routeId: prepared.plan.route.id,
          outcomeClass: prepared.plan.outcomeClass,
          authoritativeFacts: prepared.plan.authoritativeFacts,
          releasedEvidenceIds: prepared.plan.releasedEvidenceIds,
          generatedWording: validated.renderedText!,
          generatedWordingIsAuthoritative: false,
          provider: validated.provenance,
          event: committed.event,
          stateVersionBefore: state.stateVersion,
          stateVersionAfter: committed.state.stateVersion,
        } satisfies ActionOutcomeRecord;
      },
    );
    if (!isActionRecord(result.record)) {
      throw new Error("The operation ID is already bound to a different operation type");
    }
    return { outcome: result.record, reused: result.reused };
  }

  async replayAction(
    publishedCase: PublishedCase,
    input: ReplayActionInput,
    adapter: ProviderAdapter,
  ): Promise<{ readonly outcome: ReplayOutcomeRecord; readonly reused: boolean }> {
    assertProviderAdapter(adapter);
    const frozenCase = deepFreeze(structuredClone(publishedCase));
    assertInputBindings(input, frozenCase);
    assertOperationId(input.originalOperationId);
    if (input.operationId === input.originalOperationId) {
      throw new Error("A replay needs a new idempotent operation ID");
    }
    const operationFingerprint = replayFingerprint(input, adapter);
    const authorizationRequest = {
      authUserId: input.authUserId,
      assignmentId: input.assignmentId,
      action: "staff-evaluate" as const,
      expectedBlindPolicyVersion: input.expectedBlindPolicyVersion,
      expectedCaseVersionDigest: input.caseVersionDigest,
      expectedAttemptNumber: input.attemptNumber,
    };
    await withAssignmentAuthorization(
      this.dependencies.authorizationStore,
      authorizationRequest,
      async (capability) => {
        if (capability.assignmentId !== input.assignmentId) {
          throw new Error("The replay capability belongs to a different assignment");
        }
      },
    );
    const result = await this.dependencies.operationStore.executeIdempotent(
      input.assignmentId,
      input.attemptNumber,
      input.operationId,
      {
        operationType: "replay",
        operationFingerprint,
        caseVersionDigest: input.caseVersionDigest,
      },
      async () => {
        const replayPlan = await withAssignmentAuthorization(
          this.dependencies.authorizationStore,
          authorizationRequest,
          async (capability) => {
            if (capability.assignmentId !== input.assignmentId) {
              throw new Error("The replay capability belongs to a different assignment");
            }
            const original = await this.dependencies.operationStore.read(
              input.assignmentId,
              input.attemptNumber,
              input.originalOperationId,
            );
            if (original === undefined || original.kind !== "applied") {
              throw new Error("The original successful action is not available for replay");
            }
            if (original.caseVersionDigest !== input.caseVersionDigest) {
              throw new Error("Replay cannot cross a frozen case-version boundary");
            }
            const state = await this.dependencies.truthStateStore.read(
              input.assignmentId,
              input.attemptNumber,
            );
            if (state.caseVersionDigest !== input.caseVersionDigest) {
              throw new Error("Trusted state belongs to a different case version");
            }
            const prepared = prepareReplayPrompt(frozenCase, {
              routeId: original.routeId,
              request: original.request,
              authoritativeFacts: original.authoritativeFacts,
              releasedEvidenceIds: original.releasedEvidenceIds,
              expectedPromptPackageDigest: original.provider.promptPackageDigest,
            });
            return { original, prepared };
          },
        );
        const attempt = await renderSafely(adapter, replayPlan.prepared.prompt);
        const renderedAt = this.now().toISOString();
        const validated = validateAttempt(
          adapter,
          attempt,
          replayPlan.prepared.prompt,
          replayPlan.prepared.digest,
          renderedAt,
          replayPlan.original.provider.interactionId,
        );
        const finalState = await withAssignmentAuthorization(
          this.dependencies.authorizationStore,
          authorizationRequest,
          async () => {
            const state = await this.dependencies.truthStateStore.read(
              input.assignmentId,
              input.attemptNumber,
            );
            if (state.caseVersionDigest !== input.caseVersionDigest) {
              throw new Error("Trusted state belongs to a different case version");
            }
            return state;
          },
        );
        if (!validated.succeeded) {
          return {
            kind: "provider-failed",
            operationId: input.operationId,
            operationFingerprint,
            assignmentId: input.assignmentId,
            attemptNumber: input.attemptNumber,
            caseVersionDigest: input.caseVersionDigest,
            originalOperationId: input.originalOperationId,
            originalInteractionId: replayPlan.original.provider.interactionId,
            failureClass: validated.failureClass!,
            authoritativeFacts: [],
            releasedEvidenceIds: [],
            provider: validated.provenance,
            stateVersionBefore: finalState.stateVersion,
            stateVersionAfter: finalState.stateVersion,
          } satisfies ReplayOutcomeRecord;
        }
        return {
          kind: "replayed",
          operationId: input.operationId,
          operationFingerprint,
          assignmentId: input.assignmentId,
          attemptNumber: input.attemptNumber,
          caseVersionDigest: input.caseVersionDigest,
          originalOperationId: input.originalOperationId,
          originalInteractionId: replayPlan.original.provider.interactionId,
          authoritativeFacts: replayPlan.original.authoritativeFacts,
          releasedEvidenceIds: replayPlan.original.releasedEvidenceIds,
          generatedWording: validated.renderedText!,
          generatedWordingIsAuthoritative: false,
          provider: validated.provenance,
          stateVersionBefore: finalState.stateVersion,
          stateVersionAfter: finalState.stateVersion,
        } satisfies ReplayOutcomeRecord;
      },
    );
    if (!isReplayRecord(result.record)) {
      throw new Error("The operation ID is already bound to a different operation type");
    }
    return { outcome: result.record, reused: result.reused };
  }
}
