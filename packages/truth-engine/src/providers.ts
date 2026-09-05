import { RenderedOutputSchema } from "./types.js";
import type {
  PinnedModelId,
  ProviderAdapter,
  ProviderPromptPackage,
  ProviderRenderAttempt,
  RenderedOutput,
} from "./types.js";

export type CapturedPrompt = Readonly<ProviderPromptPackage>;

function validOutputFor(prompt: ProviderPromptPackage): RenderedOutput {
  return {
    schemaVersion: "1",
    outputKind: "generated-non-authoritative-wording",
    renderedSegments: [
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
    ],
    usedFactIds: prompt.officialFacts.map(({ id }) => id),
    usedResponsePointIds: prompt.responsePoints.map(({ id }) => id),
  };
}

export class CaptureProvider implements ProviderAdapter {
  readonly providerId = "capture" as const;
  readonly calibration = "not-run" as const;
  readonly captured: CapturedPrompt[] = [];

  constructor(readonly modelId: PinnedModelId) {}

  async render(prompt: ProviderPromptPackage): Promise<ProviderRenderAttempt> {
    this.captured.push(structuredClone(prompt));
    return {
      status: "success",
      interactionId: `capture-${this.captured.length}`,
      output: validOutputFor(prompt),
      latencyMs: 0,
    };
  }
}

export class MockProvider implements ProviderAdapter {
  readonly providerId = "mock" as const;
  readonly calibration: ProviderAdapter["calibration"];

  constructor(
    readonly modelId: PinnedModelId,
    private readonly responder: (
      prompt: ProviderPromptPackage,
      callNumber: number,
    ) => ProviderRenderAttempt | Promise<ProviderRenderAttempt>,
    calibration: ProviderAdapter["calibration"] = "passed",
  ) {
    this.calibration = calibration;
  }

  private calls = 0;

  get callCount(): number {
    return this.calls;
  }

  async render(prompt: ProviderPromptPackage): Promise<ProviderRenderAttempt> {
    this.calls += 1;
    return this.responder(structuredClone(prompt), this.calls);
  }
}

export function successfulMockAttempt(
  prompt: ProviderPromptPackage,
  interactionId = "mock-interaction",
): ProviderRenderAttempt {
  return {
    status: "success",
    interactionId,
    output: validOutputFor(prompt),
    latencyMs: 1,
  };
}

export function parseRenderedOutput(value: unknown): RenderedOutput {
  return RenderedOutputSchema.parse(value);
}
