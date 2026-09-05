import { describe, expect, it } from "vitest";
import {
  MockProvider,
  MAX_OPENAI_RESPONSE_BYTES,
  createOpenAIResponsesAdapter,
  successfulMockAttempt,
  type ProviderAdapter,
  type ProviderPromptPackage,
} from "../src/index.js";
import { actionInput, makeHarness } from "./fixture.js";

const model = "gpt-5-mini-2025-08-07" as const;
const alternateModel = "gpt-4.1-mini-2025-04-14" as const;

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

describe("adversarial provider boundary probes", () => {
  it("turns a thrown provider error into an auditable zero-release failure", async () => {
    const harness = makeHarness();
    const before = await harness.truthStateStore.read("assignment-a", 1);
    const adapter = new MockProvider(model, () => {
      throw new Error("sensitive upstream detail that must not escape");
    });

    const result = await harness.engine.executeAction(
      harness.publishedCase,
      actionInput(harness.caseVersionDigest, "thrown-provider", "collect complete"),
      adapter,
    );

    expect(result.outcome.kind).toBe("provider-failed");
    if (result.outcome.kind !== "provider-failed") throw new Error("Expected provider failure");
    expect(result.outcome.failureClass).toBe("provider-error");
    expect(JSON.stringify(result.outcome)).not.toContain("sensitive upstream detail");
    expect(await harness.truthStateStore.read("assignment-a", 1)).toEqual(before);
    expect(await harness.operationStore.read("assignment-a", 1, "thrown-provider")).toEqual(
      result.outcome,
    );
  });

  it("turns a non-object provider return into an auditable zero-release failure", async () => {
    const harness = makeHarness();
    const adapter = {
      providerId: "mock",
      modelId: model,
      calibration: "not-run",
      async render() {
        return null;
      },
    } as unknown as ProviderAdapter;

    const result = await harness.engine.executeAction(
      harness.publishedCase,
      actionInput(harness.caseVersionDigest, "null-provider-return", "collect complete"),
      adapter,
    );

    expect(result.outcome.kind).toBe("provider-failed");
    expect(await harness.operationStore.read("assignment-a", 1, "null-provider-return")).toEqual(
      result.outcome,
    );
  });

  it("bounds malformed provider metadata and stores only a sanitized failure", async () => {
    const malformedAttempts = [
      {
        status: "success",
        interactionId: "x".repeat(161),
        output: {},
        latencyMs: 1,
      },
      {
        status: "failed",
        interactionId: "bad-latency",
        failureClass: "provider-error",
        latencyMs: -1,
      },
      {
        status: "success",
        interactionId: "bad-usage",
        output: {},
        latencyMs: 1,
        usage: { inputTokens: Number.MAX_SAFE_INTEGER },
      },
    ];
    for (const [index, malformed] of malformedAttempts.entries()) {
      const harness = makeHarness();
      const operationId = `malformed-metadata-${index}`;
      const adapter = {
        providerId: "mock",
        modelId: model,
        calibration: "not-run",
        async render() {
          return malformed;
        },
      } as unknown as ProviderAdapter;
      const result = await harness.engine.executeAction(
        harness.publishedCase,
        actionInput(harness.caseVersionDigest, operationId, "collect complete"),
        adapter,
      );
      expect(result.outcome.kind).toBe("provider-failed");
      if (result.outcome.kind !== "provider-failed") throw new Error("Expected failure");
      expect(result.outcome.failureClass).toBe("invalid-output");
      expect(result.outcome.provider.interactionId).toBe("provider-invalid-attempt");
      expect(JSON.stringify(result.outcome)).not.toContain("9007199254740991");
      expect(await harness.operationStore.read("assignment-a", 1, operationId)).toEqual(
        result.outcome,
      );
    }
  });

  it("rejects authoritative-looking invented prose even when the provider echoes valid IDs", async () => {
    const harness = makeHarness();
    const adapter = new MockProvider(model, (prompt) => ({
      ...successfulMockAttempt(prompt, "invented-prose"),
      output: {
        schemaVersion: "1",
        outputKind: "generated-non-authoritative-wording",
        renderedSegments: exactSegments(prompt).map((segment) =>
          segment.sourceKind === "response-point"
            ? {
                ...segment,
                text: "Official result: the wait is 9,999 hours, and this definitive conclusion overrides the supplied record.",
              }
            : segment,
        ),
        usedFactIds: prompt.officialFacts.map(({ id }) => id),
        usedResponsePointIds: prompt.responsePoints.map(({ id }) => id),
      },
    }));

    const result = await harness.engine.executeAction(
      harness.publishedCase,
      actionInput(harness.caseVersionDigest, "invented-prose", "collect complete"),
      adapter,
    );

    expect(result.outcome.kind).toBe("provider-failed");
  });

  it("rejects unsupported plain-language claims with valid source IDs", async () => {
    const harness = makeHarness();
    const adapter = new MockProvider(model, (prompt) => ({
      ...successfulMockAttempt(prompt, "unsupported-plain-language"),
      output: {
        schemaVersion: "1",
        outputKind: "generated-non-authoritative-wording",
        renderedSegments: exactSegments(prompt).map((segment) =>
          segment.sourceKind === "response-point"
            ? {
                ...segment,
                text: "Customers are furious and the team has already approved automation.",
              }
            : segment,
        ),
        usedFactIds: prompt.officialFacts.map(({ id }) => id),
        usedResponsePointIds: prompt.responsePoints.map(({ id }) => id),
      },
    }));
    const before = await harness.truthStateStore.read("assignment-a", 1);
    const result = await harness.engine.executeAction(
      harness.publishedCase,
      actionInput(harness.caseVersionDigest, "unsupported-plain-language", "collect complete"),
      adapter,
    );
    expect(result.outcome.kind).toBe("provider-failed");
    expect(await harness.truthStateStore.read("assignment-a", 1)).toEqual(before);
  });

  it("rejects reuse of an operation ID with a changed request payload", async () => {
    const harness = makeHarness();
    const provider = new MockProvider(model, (prompt, call) =>
      successfulMockAttempt(prompt, `changed-payload-${call}`),
    );
    await harness.engine.executeAction(
      harness.publishedCase,
      actionInput(harness.caseVersionDigest, "changed-payload", "collect complete"),
      provider,
    );

    await expect(
      harness.engine.executeAction(
        harness.publishedCase,
        actionInput(harness.caseVersionDigest, "changed-payload", "collect biased"),
        provider,
      ),
    ).rejects.toThrow(/operation.*different|idempot/i);
    expect(provider.callCount).toBe(1);
  });

  it("binds operation IDs to model and staff-review choice", async () => {
    const harness = makeHarness();
    const firstProvider = new MockProvider(model, (prompt) => successfulMockAttempt(prompt));
    const alternateProvider = new MockProvider(alternateModel, (prompt) =>
      successfulMockAttempt(prompt),
    );
    const baseInput = actionInput(
      harness.caseVersionDigest,
      "model-fingerprint",
      "collect complete",
    );
    await harness.engine.executeAction(harness.publishedCase, baseInput, firstProvider);
    await expect(
      harness.engine.executeAction(harness.publishedCase, baseInput, alternateProvider),
    ).rejects.toThrow(/idempotent.*different|different consequential/i);
    expect(alternateProvider.callCount).toBe(0);

    const reviewProvider = new MockProvider(model, (prompt) => successfulMockAttempt(prompt));
    const reviewInput = actionInput(
      harness.caseVersionDigest,
      "review-fingerprint",
      "collect biased",
    );
    await harness.engine.executeAction(harness.publishedCase, reviewInput, reviewProvider);
    await expect(
      harness.engine.executeAction(
        harness.publishedCase,
        { ...reviewInput, requestStaffReview: true },
        reviewProvider,
      ),
    ).rejects.toThrow(/idempotent.*different|different consequential/i);
    expect(reviewProvider.callCount).toBe(1);
  });

  it("enforces timeout even when a transport ignores the abort signal and answers late", async () => {
    const harness = makeHarness();
    const before = await harness.truthStateStore.read("assignment-a", 1);
    const adapter = createOpenAIResponsesAdapter({
      modelId: model,
      timeoutMs: 250,
      resolveApiKey: async () => "synthetic-token-not-live",
      transport: async (request) => {
        await new Promise<void>((resolve) => setTimeout(resolve, 300));
        const body = JSON.parse(request.body) as {
          input: [unknown, { content: [{ text: string }] }];
        };
        const prompt = JSON.parse(body.input[1].content[0].text) as ProviderPromptPackage;
        return {
          status: 200,
          body: {
            id: "late-success",
            output_text: JSON.stringify({
              schemaVersion: "1",
              outputKind: "generated-non-authoritative-wording",
              renderedSegments: exactSegments(prompt),
              usedFactIds: prompt.officialFacts.map(({ id }) => id),
              usedResponsePointIds: prompt.responsePoints.map(({ id }) => id),
            }),
          },
        };
      },
    });

    const result = await harness.engine.executeAction(
      harness.publishedCase,
      actionInput(harness.caseVersionDigest, "late-provider", "collect complete"),
      adapter,
    );

    expect(result.outcome.kind).toBe("provider-failed");
    if (result.outcome.kind !== "provider-failed") throw new Error("Expected a timeout failure");
    expect(result.outcome.failureClass).toBe("timeout");
    await new Promise<void>((resolve) => setTimeout(resolve, 80));
    expect(await harness.truthStateStore.read("assignment-a", 1)).toEqual(before);
    expect(await harness.operationStore.read("assignment-a", 1, "late-provider")).toEqual(
      result.outcome,
    );
  });

  it("contains a late transport rejection after the timeout outcome is final", async () => {
    const harness = makeHarness();
    const before = await harness.truthStateStore.read("assignment-a", 1);
    const adapter = createOpenAIResponsesAdapter({
      modelId: model,
      timeoutMs: 250,
      resolveApiKey: async () => "synthetic-token-not-live",
      transport: async () => {
        await new Promise<void>((resolve) => setTimeout(resolve, 300));
        throw new Error("late synthetic transport rejection");
      },
    });

    const result = await harness.engine.executeAction(
      harness.publishedCase,
      actionInput(harness.caseVersionDigest, "late-provider-rejection", "collect complete"),
      adapter,
    );

    expect(result.outcome.kind).toBe("provider-failed");
    if (result.outcome.kind !== "provider-failed") throw new Error("Expected a timeout failure");
    expect(result.outcome.failureClass).toBe("timeout");
    await new Promise<void>((resolve) => setTimeout(resolve, 80));
    expect(await harness.truthStateStore.read("assignment-a", 1)).toEqual(before);
    expect(
      await harness.operationStore.read("assignment-a", 1, "late-provider-rejection"),
    ).toEqual(result.outcome);
  });

  it("enforces the same deadline when the key resolver ignores cancellation", async () => {
    const harness = makeHarness();
    const transportCalls: string[] = [];
    const adapter = createOpenAIResponsesAdapter({
      modelId: model,
      timeoutMs: 250,
      resolveApiKey: async () => {
        await new Promise<void>((resolve) => setTimeout(resolve, 300));
        return "synthetic-token-not-live";
      },
      transport: async () => {
        transportCalls.push("called");
        return { status: 500, body: null };
      },
    });
    const result = await harness.engine.executeAction(
      harness.publishedCase,
      actionInput(harness.caseVersionDigest, "late-key-resolver", "collect complete"),
      adapter,
    );
    expect(result.outcome.kind).toBe("provider-failed");
    if (result.outcome.kind !== "provider-failed") throw new Error("Expected failure");
    expect(result.outcome.failureClass).toBe("timeout");
    await new Promise<void>((resolve) => setTimeout(resolve, 80));
    expect(transportCalls).toEqual([]);
    expect((await harness.truthStateStore.read("assignment-a", 1)).officialEvents).toEqual([]);
  });

  it("rejects provider-level incomplete status and oversized raw bodies", async () => {
    for (const [operationId, body, expectedFailure] of [
      [
        "provider-incomplete",
        {
          id: "incomplete-response",
          status: "incomplete",
          output_text: JSON.stringify({
            schemaVersion: "1",
            outputKind: "generated-non-authoritative-wording",
            renderedSegments: [
              {
                sourceKind: "fact",
                sourceId: "complete-fact",
                text: "The complete collection produced its authored synthetic observation.",
              },
              {
                sourceKind: "response-point",
                sourceId: "student-message",
                text: "The complete result is ready.",
              },
            ],
            usedFactIds: ["complete-fact"],
            usedResponsePointIds: ["student-message"],
          }),
        },
        "provider-error",
      ],
      ["oversized-raw-body", "x".repeat(MAX_OPENAI_RESPONSE_BYTES + 1), "oversized-output"],
    ] as const) {
      const harness = makeHarness();
      const before = await harness.truthStateStore.read("assignment-a", 1);
      const adapter = createOpenAIResponsesAdapter({
        modelId: model,
        resolveApiKey: async () => "synthetic-token-not-live",
        transport: async () => ({ status: 200, body }),
      });
      const result = await harness.engine.executeAction(
        harness.publishedCase,
        actionInput(harness.caseVersionDigest, operationId, "collect complete"),
        adapter,
      );
      expect(result.outcome.kind).toBe("provider-failed");
      if (result.outcome.kind !== "provider-failed") throw new Error("Expected failure");
      expect(result.outcome.failureClass).toBe(expectedFailure);
      expect(await harness.truthStateStore.read("assignment-a", 1)).toEqual(before);
    }
  });

  it("treats a nested refusal as final even when top-level text looks valid", async () => {
    const harness = makeHarness();
    const before = await harness.truthStateStore.read("assignment-a", 1);
    const adapter = createOpenAIResponsesAdapter({
      modelId: model,
      resolveApiKey: async () => "synthetic-token-not-live",
      transport: async (request) => {
        const requestBody = JSON.parse(request.body) as {
          input: [unknown, { content: [{ text: string }] }];
        };
        const prompt = JSON.parse(
          requestBody.input[1].content[0].text,
        ) as ProviderPromptPackage;
        const apparentlyValidText = JSON.stringify({
          schemaVersion: "1",
          outputKind: "generated-non-authoritative-wording",
          renderedSegments: exactSegments(prompt),
          usedFactIds: prompt.officialFacts.map(({ id }) => id),
          usedResponsePointIds: prompt.responsePoints.map(({ id }) => id),
        });
        return {
          status: 200,
          body: {
            id: "contradictory-refusal",
            status: "completed",
            output_text: apparentlyValidText,
            output: [
              {
                type: "message",
                content: [{ type: "refusal", refusal: "Synthetic refusal" }],
              },
            ],
          },
        };
      },
    });

    const result = await harness.engine.executeAction(
      harness.publishedCase,
      actionInput(harness.caseVersionDigest, "nested-refusal", "collect complete"),
      adapter,
    );

    expect(result.outcome.kind).toBe("provider-failed");
    if (result.outcome.kind !== "provider-failed") throw new Error("Expected refusal");
    expect(result.outcome.failureClass).toBe("refusal");
    expect(result.outcome.authoritativeFacts).toEqual([]);
    expect(result.outcome.releasedEvidenceIds).toEqual([]);
    expect(result.outcome.stateVersionAfter).toBe(result.outcome.stateVersionBefore);
    expect(await harness.truthStateStore.read("assignment-a", 1)).toEqual(before);
    expect(await harness.operationStore.read("assignment-a", 1, "nested-refusal")).toEqual(
      result.outcome,
    );
  });

  it("fails closed when top-level and nested text surfaces conflict", async () => {
    const harness = makeHarness();
    const before = await harness.truthStateStore.read("assignment-a", 1);
    const adapter = createOpenAIResponsesAdapter({
      modelId: model,
      resolveApiKey: async () => "synthetic-token-not-live",
      transport: async () => ({
        status: 200,
        body: {
          id: "conflicting-text-surfaces",
          status: "completed",
          output_text: "{}",
          output: [
            {
              type: "message",
              content: [{ type: "output_text", text: '{"different":true}' }],
            },
          ],
        },
      }),
    });

    const result = await harness.engine.executeAction(
      harness.publishedCase,
      actionInput(harness.caseVersionDigest, "conflicting-text", "collect complete"),
      adapter,
    );

    expect(result.outcome.kind).toBe("provider-failed");
    if (result.outcome.kind !== "provider-failed") throw new Error("Expected failure");
    expect(result.outcome.failureClass).toBe("invalid-output");
    expect(await harness.truthStateStore.read("assignment-a", 1)).toEqual(before);
    expect(await harness.operationStore.read("assignment-a", 1, "conflicting-text")).toEqual(
      result.outcome,
    );
  });

  it("accepts a bounded synthetic completed response without contacting a live provider", async () => {
    const harness = makeHarness();
    const adapter = createOpenAIResponsesAdapter({
      modelId: model,
      resolveApiKey: async () => "synthetic-token-not-live",
      transport: async (request) => {
        const body = JSON.parse(request.body) as {
          input: [unknown, { content: [{ text: string }] }];
        };
        const prompt = JSON.parse(body.input[1].content[0].text) as ProviderPromptPackage;
        return {
          status: 200,
          body: {
            id: "synthetic-completed-response",
            status: "completed",
            output_text: JSON.stringify({
              schemaVersion: "1",
              outputKind: "generated-non-authoritative-wording",
              renderedSegments: exactSegments(prompt),
              usedFactIds: prompt.officialFacts.map(({ id }) => id),
              usedResponsePointIds: prompt.responsePoints.map(({ id }) => id),
            }),
          },
        };
      },
    });

    const result = await harness.engine.executeAction(
      harness.publishedCase,
      actionInput(harness.caseVersionDigest, "synthetic-completed", "collect complete"),
      adapter,
    );

    expect(result.outcome.kind).toBe("applied");
    if (result.outcome.kind !== "applied") throw new Error("Expected applied result");
    expect(result.outcome.provider).toMatchObject({
      providerId: "openai-responses",
      interactionId: "synthetic-completed-response",
      modelId: model,
    });
  });

  it("keeps replay records independently bound to the attempt and frozen case", async () => {
    const harness = makeHarness();
    await harness.engine.executeAction(
      harness.publishedCase,
      actionInput(harness.caseVersionDigest, "binding-original", "collect complete"),
      new MockProvider(model, (prompt) => successfulMockAttempt(prompt, "binding-original-i")),
    );
    const replay = await harness.engine.replayAction(
      harness.publishedCase,
      {
        authUserId: "auth-101",
        assignmentId: "assignment-a",
        attemptNumber: 1,
        caseVersionDigest: harness.caseVersionDigest,
        expectedBlindPolicyVersion: 1,
        operationId: "binding-replay",
        originalOperationId: "binding-original",
      },
      new MockProvider(model, (prompt) => successfulMockAttempt(prompt, "binding-replay-i")),
    );
    const record = replay.outcome as unknown as Record<string, unknown>;

    expect(record.attemptNumber).toBe(1);
    expect(record.caseVersionDigest).toBe(harness.caseVersionDigest);
  });

  it("binds a replay operation ID to its original operation", async () => {
    const harness = makeHarness();
    for (const [operationId, question] of [
      ["replay-source-a", "collect complete"],
      ["replay-source-b", "collect partial"],
    ] as const) {
      await harness.engine.executeAction(
        harness.publishedCase,
        actionInput(harness.caseVersionDigest, operationId, question),
        new MockProvider(model, (prompt) => successfulMockAttempt(prompt, `${operationId}-i`)),
      );
    }
    const replayProvider = new MockProvider(model, (prompt) => successfulMockAttempt(prompt));
    const replayBase = {
      authUserId: "auth-101",
      assignmentId: "assignment-a",
      attemptNumber: 1,
      caseVersionDigest: harness.caseVersionDigest,
      expectedBlindPolicyVersion: 1,
      operationId: "replay-fingerprint",
    } as const;
    await harness.engine.replayAction(
      harness.publishedCase,
      { ...replayBase, originalOperationId: "replay-source-a" },
      replayProvider,
    );
    await expect(
      harness.engine.replayAction(
        harness.publishedCase,
        { ...replayBase, originalOperationId: "replay-source-b" },
        replayProvider,
      ),
    ).rejects.toThrow(/idempotent.*different|different consequential/i);
    expect(replayProvider.callCount).toBe(1);
  });

  it("retains request and resolution reason for unavailable and ambiguous operations", async () => {
    for (const [operationId, question, kind, reason] of [
      ["record-unavailable", "collect a lunar sample", "unavailable", "out-of-universe"],
      ["record-ambiguous", "collect conflict", "ambiguous", "equal-top-priority"],
    ] as const) {
      const harness = makeHarness();
      const input = actionInput(harness.caseVersionDigest, operationId, question);
      const result = await harness.engine.executeAction(
        harness.publishedCase,
        input,
        new MockProvider(model, (prompt) => successfulMockAttempt(prompt)),
      );
      expect(result.outcome.kind).toBe(kind);
      if (result.outcome.kind !== "unavailable" && result.outcome.kind !== "ambiguous") {
        throw new Error("Expected deterministic no-release result");
      }
      expect(result.outcome.request).toEqual(input.request);
      expect(result.outcome.resolutionReason).toBe(reason);
      expect(await harness.operationStore.read("assignment-a", 1, operationId)).toEqual(
        result.outcome,
      );
    }
  });

  it("rejects an action/replay operation-ID collision before a second provider call", async () => {
    const harness = makeHarness();
    await harness.engine.executeAction(
      harness.publishedCase,
      actionInput(harness.caseVersionDigest, "collision-original", "collect complete"),
      new MockProvider(model, (prompt) => successfulMockAttempt(prompt, "collision-original-i")),
    );
    await harness.engine.executeAction(
      harness.publishedCase,
      actionInput(harness.caseVersionDigest, "collision-occupied", "collect partial"),
      new MockProvider(model, (prompt) => successfulMockAttempt(prompt, "collision-occupied-i")),
    );
    const replayProvider = new MockProvider(model, (prompt) => successfulMockAttempt(prompt));

    await expect(
      harness.engine.replayAction(
        harness.publishedCase,
        {
          authUserId: "auth-101",
          assignmentId: "assignment-a",
          attemptNumber: 1,
          caseVersionDigest: harness.caseVersionDigest,
          expectedBlindPolicyVersion: 1,
          operationId: "collision-occupied",
          originalOperationId: "collision-original",
        },
        replayProvider,
      ),
    ).rejects.toThrow("already bound to a different operation type");
    expect(replayProvider.callCount).toBe(0);
  });

  it("lets only one concurrent transition commit against one state version", async () => {
    const harness = makeHarness();
    let releaseBoth!: () => void;
    const bothStarted = new Promise<void>((resolve) => {
      releaseBoth = resolve;
    });
    let starts = 0;
    const provider = new MockProvider(model, async (prompt, call) => {
      starts += 1;
      if (starts === 2) releaseBoth();
      await bothStarted;
      return successfulMockAttempt(prompt, `concurrent-${call}`);
    });

    const results = await Promise.allSettled([
      harness.engine.executeAction(
        harness.publishedCase,
        actionInput(harness.caseVersionDigest, "concurrent-a", "collect complete"),
        provider,
      ),
      harness.engine.executeAction(
        harness.publishedCase,
        actionInput(harness.caseVersionDigest, "concurrent-b", "collect partial"),
        provider,
      ),
    ]);
    const state = await harness.truthStateStore.read("assignment-a", 1);

    expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    expect(results.filter(({ status }) => status === "rejected")).toHaveLength(1);
    expect(state.stateVersion).toBe(1);
    expect(state.officialEvents).toHaveLength(1);
  });

  it("rechecks locked authorization after async rendering and before truth commit", async () => {
    const harness = makeHarness();
    const before = await harness.truthStateStore.read("assignment-a", 1);
    const provider = new MockProvider(model, (prompt) => {
      const actor = harness.authorizationStore.snapshot.actor!;
      harness.authorizationStore.snapshot = {
        ...harness.authorizationStore.snapshot,
        actor: { ...actor, githubUserId: "999" },
      };
      return successfulMockAttempt(prompt, "revoked-before-commit");
    });

    await expect(
      harness.engine.executeAction(
        harness.publishedCase,
        actionInput(harness.caseVersionDigest, "revoked-before-commit", "collect complete"),
        provider,
      ),
    ).rejects.toBeInstanceOf(Error);
    expect(await harness.truthStateStore.read("assignment-a", 1)).toEqual(before);
    expect(
      await harness.operationStore.read("assignment-a", 1, "revoked-before-commit"),
    ).toBe(undefined);
  });
});
