import { describe, expect, it, vi } from "vitest";
import { AccessDeniedError } from "@volta-sim/service-auth";
import {
  CaptureProvider,
  MockProvider,
  OPENAI_RESPONSES_ENDPOINT,
  PINNED_MODEL_IDS,
  createOpenAIResponsesAdapter,
  successfulMockAttempt,
  type OpenAIResponsesAdapterConfig,
  type OpenAITransportRequest,
  type ProviderPromptPackage,
  type ProviderRenderAttempt,
} from "../src/index.js";
import { actionInput, makeHarness } from "./fixture.js";

const modelA = PINNED_MODEL_IDS[0];
const modelB = PINNED_MODEL_IDS[1];

function exactSegments(prompt: ProviderPromptPackage) {
  return [
    ...prompt.officialFacts.map(({ id, claim }) => ({
      sourceKind: "fact" as const,
      sourceId: id,
      text: claim,
    })),
    ...prompt.responsePoints.map(({ id, text }) => ({
      sourceKind: "response-point" as const,
      sourceId: id,
      text,
    })),
  ];
}

describe("prompt-local truth selection", () => {
  it("captures only the current persona, selected facts, response points, and current turn", async () => {
    const harness = makeHarness();
    const provider = new CaptureProvider(modelA);
    const result = await harness.engine.executeAction(
      harness.publishedCase,
      actionInput(
        harness.caseVersionDigest,
        "persona-prompt-canaries",
        "What is the wait time?",
        "persona",
      ),
      provider,
    );

    expect(result.outcome.kind).toBe("applied");
    expect(provider.captured).toHaveLength(1);
    const promptText = JSON.stringify(provider.captured[0]);
    expect(promptText).toContain("median-wait");
    expect(promptText).toContain("What is the wait time?");
    expect(promptText).toContain("library-manager");
    expect(promptText).not.toContain("FULL_TRUTH_CANARY");
    expect(promptText).not.toContain("CALIBRATION_CANARY");
    expect(promptText).not.toContain("OTHER_ASSIGNMENT_OR_PERSONA_CANARY");
    expect(promptText).not.toContain("OTHER_PERSONA_VISIBLE_CANARY");
    expect(promptText).not.toContain("UNRELATED_FACT_CANARY");
    expect(promptText).not.toContain("UNRELATED_PROVENANCE_CANARY");
    expect(promptText).not.toContain("UNRELATED_EVIDENCE_CANARY");

    if (result.outcome.kind !== "applied") throw new Error("Expected an applied outcome");
    expect(result.outcome.authoritativeFacts).toEqual([
      {
        id: "median-wait",
        claim: "The synthetic desk log shows a median first response time of 18 minutes.",
        provenance: "Frozen public example desk log, rows 1-20",
      },
    ]);
    expect(result.outcome.provider).toMatchObject({
      providerId: "capture",
      modelId: modelA,
      calibration: "not-run",
      interactionId: "capture-1",
    });
    expect(result.outcome.generatedWordingIsAuthoritative).toBe(false);
  });

  it("returns out-of-universe as unavailable without calling a renderer or changing state", async () => {
    const harness = makeHarness();
    const provider = new MockProvider(modelA, (prompt) => successfulMockAttempt(prompt));
    const before = await harness.truthStateStore.read("assignment-a", 1);
    const result = await harness.engine.executeAction(
      harness.publishedCase,
      actionInput(harness.caseVersionDigest, "no-match", "collect a lunar sample"),
      provider,
    );
    const after = await harness.truthStateStore.read("assignment-a", 1);

    expect(result.outcome.kind).toBe("unavailable");
    expect(result.outcome.authoritativeFacts).toEqual([]);
    expect(result.outcome.releasedEvidenceIds).toEqual([]);
    expect(provider.callCount).toBe(0);
    expect(after).toEqual(before);
  });
});

describe("authored collection consequences", () => {
  it("applies exact complete, partial, biased, unusable, and unavailable paths", async () => {
    const harness = makeHarness();
    const expected = [
      ["complete", 10, 1],
      ["partial", 20, 2],
      ["biased", 30, 3],
      ["unusable", 40, 4],
      ["unavailable", 50, 5],
    ] as const;

    for (const [outcomeClass, minutes, credits] of expected) {
      const provider = new CaptureProvider(modelA);
      const result = await harness.engine.executeAction(
        harness.publishedCase,
        {
          ...actionInput(
            harness.caseVersionDigest,
            `outcome-${outcomeClass}`,
            `Please collect ${outcomeClass}`,
          ),
          ...(outcomeClass === "biased" ? { requestStaffReview: true } : {}),
        },
        provider,
      );
      expect(result.outcome.kind).toBe("applied");
      if (result.outcome.kind !== "applied") throw new Error("Expected an applied outcome");
      expect(result.outcome.outcomeClass).toBe(outcomeClass);
      expect(result.outcome.event.time).toEqual({ amount: minutes, unit: "minutes" });
      expect(result.outcome.event.resources).toEqual([
        { id: `${outcomeClass}-credits`, amount: credits, unit: "credits" },
      ]);
      if (outcomeClass === "unavailable" || outcomeClass === "unusable") {
        expect(result.outcome.authoritativeFacts).toEqual([]);
      } else {
        expect(result.outcome.authoritativeFacts.map(({ id }) => id)).toEqual([
          `${outcomeClass}-fact`,
        ]);
      }
    }

    const state = await harness.truthStateStore.read("assignment-a", 1);
    expect(state.elapsed.minutes).toBe(150);
    expect(state.officialEvents).toHaveLength(5);
    expect(state.reviewGuidance).toEqual([
      {
        eventId: "event-3",
        routeId: "collect-biased",
        guidance: {
          level: "high",
          suggested: true,
          requested: true,
          blocksSandboxWork: false,
        },
      },
    ]);
    expect(state.officialEvents[3]?.routeId).toBe("collect-unusable");
    expect(state.officialEvents[4]?.routeId).toBe("collect-unavailable");
  });

  it("records non-blocking review guidance and permits the next sandbox action", async () => {
    const harness = makeHarness();
    const biased = await harness.engine.executeAction(
      harness.publishedCase,
      {
        ...actionInput(harness.caseVersionDigest, "risk-one", "collect biased"),
        requestStaffReview: false,
      },
      new CaptureProvider(modelA),
    );
    const following = await harness.engine.executeAction(
      harness.publishedCase,
      actionInput(harness.caseVersionDigest, "risk-two", "collect complete"),
      new CaptureProvider(modelA),
    );

    expect(biased.outcome.kind).toBe("applied");
    expect(following.outcome.kind).toBe("applied");
    if (biased.outcome.kind !== "applied") throw new Error("Expected an applied outcome");
    expect(biased.outcome.event.reviewGuidance).toEqual({
      level: "high",
      suggested: true,
      requested: false,
      blocksSandboxWork: false,
    });
  });
});

describe("provider failures release nothing", () => {
  const failures: readonly [string, (prompt: ProviderPromptPackage) => ProviderRenderAttempt, string][] = [
    [
      "timeout",
      () => ({
        status: "failed",
        interactionId: "timeout-1",
        failureClass: "timeout",
        latencyMs: 15_000,
      }),
      "timeout",
    ],
    [
      "refusal",
      () => ({
        status: "failed",
        interactionId: "refusal-1",
        failureClass: "refusal",
        latencyMs: 2,
      }),
      "refusal",
    ],
    [
      "401",
      () => ({
        status: "failed",
        interactionId: "unauthorized-1",
        failureClass: "unauthorized",
        latencyMs: 2,
      }),
      "unauthorized",
    ],
    [
      "malformed",
      () => ({
        status: "success",
        interactionId: "malformed-1",
        output: { renderedText: "missing schema fields" },
        latencyMs: 1,
      }),
      "invalid-output",
    ],
    [
      "invented fact ID",
      (prompt) => ({
        status: "success",
        interactionId: "invented-id-1",
        output: {
          schemaVersion: "1",
          outputKind: "generated-non-authoritative-wording",
          renderedSegments: exactSegments(prompt),
          usedFactIds: [...prompt.officialFacts.map(({ id }) => id), "invented-fact"],
          usedResponsePointIds: prompt.responsePoints.map(({ id }) => id),
        },
        latencyMs: 1,
      }),
      "invalid-output",
    ],
    [
      "invented authority marker",
      (prompt) => ({
        status: "success",
        interactionId: "invented-authority-1",
        output: {
          schemaVersion: "1",
          outputKind: "generated-non-authoritative-wording",
          renderedSegments: exactSegments(prompt).map((segment) =>
            segment.sourceKind === "response-point"
              ? { ...segment, text: "[[fact:invented-fact]]" }
              : segment,
          ),
          usedFactIds: prompt.officialFacts.map(({ id }) => id),
          usedResponsePointIds: prompt.responsePoints.map(({ id }) => id),
        },
        latencyMs: 1,
      }),
      "invalid-output",
    ],
    [
      "oversized",
      (prompt) => ({
        status: "success",
        interactionId: "oversized-1",
        output: {
          schemaVersion: "1",
          outputKind: "generated-non-authoritative-wording",
          renderedSegments: [
            ...exactSegments(prompt),
            {
              sourceKind: "response-point",
              sourceId: "student-message",
              text: "x".repeat(21_000),
            },
          ],
          usedFactIds: prompt.officialFacts.map(({ id }) => id),
          usedResponsePointIds: prompt.responsePoints.map(({ id }) => id),
        },
        latencyMs: 1,
      }),
      "oversized-output",
    ],
  ];

  for (const [label, responder, expectedFailure] of failures) {
    it(`keeps official state unchanged for ${label}`, async () => {
      const harness = makeHarness();
      const before = await harness.truthStateStore.read("assignment-a", 1);
      const result = await harness.engine.executeAction(
        harness.publishedCase,
        actionInput(
          harness.caseVersionDigest,
          `failure-${label.replaceAll(" ", "-").toLowerCase()}`,
          "collect complete",
        ),
        new MockProvider(modelA, responder),
      );
      const after = await harness.truthStateStore.read("assignment-a", 1);

      expect(result.outcome.kind).toBe("provider-failed");
      if (result.outcome.kind !== "provider-failed") throw new Error("Expected provider failure");
      expect(result.outcome.failureClass).toBe(expectedFailure);
      expect(result.outcome.authoritativeFacts).toEqual([]);
      expect(result.outcome.releasedEvidenceIds).toEqual([]);
      expect(result.outcome.stateVersionAfter).toBe(result.outcome.stateVersionBefore);
      expect(after).toEqual(before);
      expect(
        await harness.operationStore.read(
          "assignment-a",
          1,
          `failure-${label.replaceAll(" ", "-").toLowerCase()}`,
        ),
      ).toEqual(result.outcome);
    });
  }
});

describe("authorization, idempotency, and replay", () => {
  it("denies a cross-assignment request before prompt construction or provider use", async () => {
    const harness = makeHarness();
    const provider = new CaptureProvider(modelA);
    const input = actionInput(harness.caseVersionDigest, "cross-assignment", "collect complete");
    const crossAssignment = {
      ...input,
      assignmentId: "assignment-b",
      request: { ...input.request, assignmentId: "assignment-b" },
    };
    await expect(
      harness.engine.executeAction(harness.publishedCase, crossAssignment, provider),
    ).rejects.toBeInstanceOf(AccessDeniedError);
    expect(provider.captured).toEqual([]);
    expect((await harness.truthStateStore.read("assignment-a", 1)).officialEvents).toEqual([]);
  });

  it("deduplicates concurrent conversation and collection retries", async () => {
    const harness = makeHarness();
    const provider = new MockProvider(modelA, async (prompt, callNumber) => {
      await new Promise<void>((resolve) => setTimeout(resolve, 5));
      return successfulMockAttempt(prompt, `dedupe-${callNumber}`);
    });
    const collection = actionInput(
      harness.caseVersionDigest,
      "same-collection",
      "collect complete",
    );
    const [first, second] = await Promise.all([
      harness.engine.executeAction(harness.publishedCase, collection, provider),
      harness.engine.executeAction(harness.publishedCase, collection, provider),
    ]);
    expect(provider.callCount).toBe(1);
    expect([first.reused, second.reused].sort()).toEqual([false, true]);
    expect(first.outcome).toEqual(second.outcome);

    const personaProvider = new MockProvider(modelA, (prompt, callNumber) =>
      successfulMockAttempt(prompt, `persona-${callNumber}`),
    );
    const conversation = actionInput(
      harness.caseVersionDigest,
      "same-conversation",
      "What is the wait time?",
      "persona",
    );
    const originalConversation = await harness.engine.executeAction(
      harness.publishedCase,
      conversation,
      personaProvider,
    );
    const retriedConversation = await harness.engine.executeAction(
      harness.publishedCase,
      conversation,
      personaProvider,
    );
    expect(originalConversation.reused).toBe(false);
    expect(retriedConversation.reused).toBe(true);
    expect(personaProvider.callCount).toBe(1);

    const state = await harness.truthStateStore.read("assignment-a", 1);
    expect(state.officialEvents).toHaveLength(2);
    expect(state.elapsed.minutes).toBe(20);
  });

  it("creates linked replay records without changing truth, consequences, or evaluation", async () => {
    const harness = makeHarness();
    const original = await harness.engine.executeAction(
      harness.publishedCase,
      actionInput(harness.caseVersionDigest, "original-action", "collect complete"),
      new CaptureProvider(modelA),
    );
    expect(original.outcome.kind).toBe("applied");
    if (original.outcome.kind !== "applied") throw new Error("Expected applied original");
    const beforeReplay = await harness.truthStateStore.read("assignment-a", 1);

    const replayProvider = new MockProvider(modelB, (prompt, callNumber) =>
      successfulMockAttempt(prompt, `replay-${callNumber}`),
    );
    const replayInput = {
      authUserId: "auth-101",
      assignmentId: "assignment-a",
      attemptNumber: 1,
      caseVersionDigest: harness.caseVersionDigest,
      expectedBlindPolicyVersion: 1,
      operationId: "replay-action",
      originalOperationId: "original-action",
    } as const;
    const [firstReplay, duplicateReplay] = await Promise.all([
      harness.engine.replayAction(harness.publishedCase, replayInput, replayProvider),
      harness.engine.replayAction(harness.publishedCase, replayInput, replayProvider),
    ]);
    const afterReplay = await harness.truthStateStore.read("assignment-a", 1);

    expect(replayProvider.callCount).toBe(1);
    expect([firstReplay.reused, duplicateReplay.reused].sort()).toEqual([false, true]);
    expect(firstReplay.outcome.kind).toBe("replayed");
    if (firstReplay.outcome.kind !== "replayed") throw new Error("Expected replay");
    expect(firstReplay.outcome.originalInteractionId).toBe(original.outcome.provider.interactionId);
    expect(firstReplay.outcome.provider.replayOfInteractionId).toBe(
      original.outcome.provider.interactionId,
    );
    expect(firstReplay.outcome.authoritativeFacts).toEqual(original.outcome.authoritativeFacts);
    expect(firstReplay.outcome.releasedEvidenceIds).toEqual(original.outcome.releasedEvidenceIds);
    expect(afterReplay).toEqual(beforeReplay);
    expect(afterReplay.evaluationMarker).toBe("human-evaluation-v7");
    expect(
      await harness.operationStore.read("assignment-a", 1, "original-action"),
    ).toEqual(original.outcome);
    expect(await harness.operationStore.read("assignment-a", 1, "replay-action")).toEqual(
      firstReplay.outcome,
    );
    expect(firstReplay.outcome.generatedWordingIsAuthoritative).toBe(false);
  });

  it("does not let a read-only protected-case grant invoke replay", async () => {
    const harness = makeHarness();
    const original = await harness.engine.executeAction(
      harness.publishedCase,
      actionInput(harness.caseVersionDigest, "replay-readonly-original", "collect complete"),
      new CaptureProvider(modelA),
    );
    expect(original.outcome.kind).toBe("applied");
    const context = harness.authorizationStore.snapshot.context!;
    harness.authorizationStore.snapshot = {
      ...harness.authorizationStore.snapshot,
      context: {
        ...context,
        staffAuthorization: {
          ...context.staffAuthorization!,
          allowedActions: ["staff-read-protected-case"],
        },
      },
    };
    await expect(
      harness.engine.replayAction(
        harness.publishedCase,
        {
          authUserId: "auth-101",
          assignmentId: "assignment-a",
          attemptNumber: 1,
          caseVersionDigest: harness.caseVersionDigest,
          expectedBlindPolicyVersion: 1,
          operationId: "replay-readonly-denied",
          originalOperationId: "replay-readonly-original",
        },
        new CaptureProvider(modelB),
      ),
    ).rejects.toBeInstanceOf(AccessDeniedError);
    expect(await harness.operationStore.read("assignment-a", 1, "replay-readonly-denied")).toBe(
      undefined,
    );
  });

  it("prevents a renderer from mutating the authoritative prompt allowlist", async () => {
    const harness = makeHarness();
    const before = await harness.truthStateStore.read("assignment-a", 1);
    const malicious: ProviderRenderAttempt = {
      status: "failed",
      interactionId: "not-used",
      failureClass: "provider-error",
      latencyMs: 0,
    };
    const adapter = {
      providerId: "mock" as const,
      modelId: modelA,
      calibration: "not-run" as const,
      async render(prompt: ProviderPromptPackage) {
        const fact = prompt.officialFacts[0] as { id: string };
        fact.id = "invented-by-mutation";
        return malicious;
      },
    };
    const result = await harness.engine.executeAction(
      harness.publishedCase,
      actionInput(harness.caseVersionDigest, "mutating-renderer", "collect complete"),
      adapter,
    );
    expect(result.outcome.kind).toBe("provider-failed");
    if (result.outcome.kind !== "provider-failed") throw new Error("Expected failure");
    expect(result.outcome.failureClass).toBe("provider-error");
    expect(await harness.truthStateStore.read("assignment-a", 1)).toEqual(before);
  });
});

describe("pinned provider boundary", () => {
  it("keeps official facts identical across both pinned model configurations", async () => {
    const firstHarness = makeHarness();
    const secondHarness = makeHarness();
    const first = await firstHarness.engine.executeAction(
      firstHarness.publishedCase,
      actionInput(firstHarness.caseVersionDigest, "model-a", "collect complete"),
      new CaptureProvider(modelA),
    );
    const second = await secondHarness.engine.executeAction(
      secondHarness.publishedCase,
      actionInput(secondHarness.caseVersionDigest, "model-b", "collect complete"),
      new CaptureProvider(modelB),
    );
    expect(first.outcome.kind).toBe("applied");
    expect(second.outcome.kind).toBe("applied");
    if (first.outcome.kind !== "applied" || second.outcome.kind !== "applied") {
      throw new Error("Expected both actions to apply");
    }
    expect(first.outcome.authoritativeFacts).toEqual(second.outcome.authoritativeFacts);
    expect(first.outcome.releasedEvidenceIds).toEqual(second.outcome.releasedEvidenceIds);
    expect(first.outcome.routeId).toBe(second.outcome.routeId);
    expect(first.outcome.provider.promptPackageDigest).toBe(
      second.outcome.provider.promptPackageDigest,
    );
    expect(first.outcome.provider.modelId).toBe(modelA);
    expect(second.outcome.provider.modelId).toBe(modelB);
  });

  it("rejects arbitrary base URLs, models, headers, and redirect configuration before transport", () => {
    const transport = vi.fn();
    const base = {
      modelId: modelA,
      resolveApiKey: async () => "synthetic-token-not-live",
      transport,
    };
    for (const extra of [
      { baseUrl: "https://attacker.invalid" },
      { headers: { "x-forwarded-host": "attacker.invalid" } },
      { redirect: "follow" },
    ]) {
      expect(() =>
        createOpenAIResponsesAdapter({
          ...base,
          ...extra,
        } as unknown as OpenAIResponsesAdapterConfig),
      ).toThrow(/Unsupported provider configuration/);
    }
    expect(() =>
      createOpenAIResponsesAdapter({
        ...base,
        modelId: "student-selected-model",
      } as unknown as OpenAIResponsesAdapterConfig),
    ).toThrow();
    expect(transport).not.toHaveBeenCalled();
  });

  it("rejects an adapter with an unpinned runtime model before it can receive a prompt", async () => {
    const harness = makeHarness();
    const render = vi.fn(async (prompt: ProviderPromptPackage) => successfulMockAttempt(prompt));
    await expect(
      harness.engine.executeAction(
        harness.publishedCase,
        actionInput(harness.caseVersionDigest, "runtime-model-reject", "collect complete"),
        {
          providerId: "mock",
          modelId: "not-pinned",
          calibration: "not-run",
          render,
        } as unknown as MockProvider,
      ),
    ).rejects.toThrow("Unsupported provider configuration");
    expect(render).not.toHaveBeenCalled();
    expect((await harness.truthStateStore.read("assignment-a", 1)).officialEvents).toEqual([]);
  });

  it("uses only the fixed Responses API request shape and treats redirects as zero release", async () => {
    const harness = makeHarness();
    const requests: OpenAITransportRequest[] = [];
    const adapter = createOpenAIResponsesAdapter({
      modelId: modelA,
      resolveApiKey: async () => "synthetic-token-not-live",
      transport: async (request) => {
        requests.push(request);
        return { status: 302, body: { id: "redirect-attempt" } };
      },
    });
    const before = await harness.truthStateStore.read("assignment-a", 1);
    const result = await harness.engine.executeAction(
      harness.publishedCase,
      actionInput(harness.caseVersionDigest, "redirect-zero-release", "collect complete"),
      adapter,
    );
    const after = await harness.truthStateStore.read("assignment-a", 1);

    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe(OPENAI_RESPONSES_ENDPOINT);
    expect(requests[0]?.redirect).toBe("error");
    expect(Object.keys(requests[0]?.headers ?? {}).sort()).toEqual([
      "authorization",
      "content-type",
    ]);
    expect(requests[0]!.body).not.toContain("synthetic-token-not-live");
    expect(JSON.parse(requests[0]!.body)).toMatchObject({ model: modelA, store: false });
    expect(result.outcome.kind).toBe("provider-failed");
    if (result.outcome.kind !== "provider-failed") throw new Error("Expected failure");
    expect(result.outcome.failureClass).toBe("redirect-blocked");
    expect(after).toEqual(before);
  });
});
