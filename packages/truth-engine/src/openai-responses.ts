import { PinnedModelIdSchema } from "./types.js";
import type {
  PinnedModelId,
  ProviderAdapter,
  ProviderPromptPackage,
  ProviderRenderAttempt,
  ProviderUsage,
} from "./types.js";

export const OPENAI_RESPONSES_ENDPOINT = "https://api.openai.com/v1/responses" as const;
export const MAX_OPENAI_RESPONSE_BYTES = 1_000_000;

export interface OpenAITransportRequest {
  readonly url: typeof OPENAI_RESPONSES_ENDPOINT;
  readonly method: "POST";
  readonly headers: Readonly<{
    authorization: string;
    "content-type": "application/json";
  }>;
  readonly body: string;
  readonly redirect: "error";
  readonly signal: AbortSignal;
}

export interface OpenAITransportResponse {
  readonly status: number;
  readonly body: unknown;
  readonly bodyByteLength?: number;
  readonly bodyTooLarge?: boolean;
}

export type OpenAITransport = (
  request: OpenAITransportRequest,
) => Promise<OpenAITransportResponse>;

export interface OpenAIResponsesAdapterConfig {
  readonly modelId: PinnedModelId;
  readonly resolveApiKey: () => Promise<string>;
  readonly timeoutMs?: number;
  readonly transport?: OpenAITransport;
  readonly calibration?: ProviderAdapter["calibration"];
}

function assertOnlyConfigurationKeys(value: object): void {
  const allowed = new Set([
    "modelId",
    "resolveApiKey",
    "timeoutMs",
    "transport",
    "calibration",
  ]);
  const rejected = Object.keys(value).filter((key) => !allowed.has(key));
  if (rejected.length > 0) {
    throw new Error(`Unsupported provider configuration: ${rejected.sort().join(", ")}`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function textFromResponse(body: unknown): {
  interactionId: string;
  text?: string;
  refused: boolean;
  invalidTextSurfaces: boolean;
} {
  if (!isRecord(body)) {
    return {
      interactionId: "openai-invalid-response",
      refused: false,
      invalidTextSurfaces: false,
    };
  }
  const interactionId = typeof body.id === "string" ? body.id : "openai-missing-id";
  const topLevelText = typeof body.output_text === "string" ? body.output_text : undefined;
  const nestedTexts: string[] = [];
  let refused = false;
  let invalidTextSurfaces = false;
  const pending: unknown[] = [body];
  const visited = new WeakSet<object>();
  let visitedNodes = 0;
  while (pending.length > 0) {
    const candidate = pending.pop();
    if (typeof candidate !== "object" || candidate === null) continue;
    if (visited.has(candidate)) {
      invalidTextSurfaces = true;
      continue;
    }
    visited.add(candidate);
    visitedNodes += 1;
    if (visitedNodes > 10_000) {
      invalidTextSurfaces = true;
      break;
    }
    if (Array.isArray(candidate)) {
      pending.push(...candidate);
      continue;
    }
    if (!isRecord(candidate)) continue;
    if (candidate.type === "refusal") refused = true;
    if (candidate.type === "output_text" && typeof candidate.text === "string") {
      nestedTexts.push(candidate.text);
    }
    for (const value of Object.values(candidate)) {
      if (typeof value === "object" && value !== null) {
        pending.push(value);
      }
    }
  }
  nestedTexts.reverse();
  const nestedText = nestedTexts.length > 0 ? nestedTexts.join("") : undefined;
  if (topLevelText !== undefined && nestedText !== undefined && topLevelText !== nestedText) {
    invalidTextSurfaces = true;
  }
  const text = topLevelText ?? nestedText;
  return {
    interactionId,
    ...(text === undefined ? {} : { text }),
    refused,
    invalidTextSurfaces,
  };
}

function usageFromResponse(body: unknown): ProviderUsage | undefined {
  if (!isRecord(body) || !isRecord(body.usage)) return undefined;
  const inputTokens = body.usage.input_tokens;
  const outputTokens = body.usage.output_tokens;
  if (typeof inputTokens !== "number" && typeof outputTokens !== "number") return undefined;
  return {
    ...(typeof inputTokens === "number" ? { inputTokens } : {}),
    ...(typeof outputTokens === "number" ? { outputTokens } : {}),
  };
}

const outputJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "schemaVersion",
    "outputKind",
    "renderedSegments",
    "usedFactIds",
    "usedResponsePointIds",
  ],
  properties: {
    schemaVersion: { type: "string", const: "1" },
    outputKind: { type: "string", const: "generated-non-authoritative-wording" },
    renderedSegments: {
      type: "array",
      minItems: 1,
      maxItems: 130,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["sourceKind", "sourceId", "text"],
        properties: {
          sourceKind: { type: "string", enum: ["fact", "response-point"] },
          sourceId: {
            type: "string",
            pattern: "^[a-z0-9]+(?:[._-][a-z0-9]+)*$",
          },
          text: { type: "string", minLength: 1, maxLength: 5_000 },
        },
      },
    },
    usedFactIds: {
      type: "array",
      maxItems: 100,
      items: { type: "string", pattern: "^[a-z0-9]+(?:[._-][a-z0-9]+)*$" },
    },
    usedResponsePointIds: {
      type: "array",
      minItems: 1,
      maxItems: 30,
      items: { type: "string", pattern: "^[a-z0-9]+(?:[._-][a-z0-9]+)*$" },
    },
  },
} as const;

async function defaultTransport(request: OpenAITransportRequest): Promise<OpenAITransportResponse> {
  const response = await fetch(request.url, {
    method: request.method,
    headers: request.headers,
    body: request.body,
    redirect: request.redirect,
    signal: request.signal,
  });
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_OPENAI_RESPONSE_BYTES) {
    await response.body?.cancel();
    return { status: response.status, body: null, bodyTooLarge: true };
  }
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  if (response.body !== null) {
    const reader = response.body.getReader();
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      byteLength += chunk.value.byteLength;
      if (byteLength > MAX_OPENAI_RESPONSE_BYTES) {
        await reader.cancel();
        return { status: response.status, body: null, bodyTooLarge: true };
      }
      chunks.push(chunk.value);
    }
  }
  const rawBody = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf8");
  let body: unknown = null;
  try {
    body = rawBody.length === 0 ? null : JSON.parse(rawBody);
  } catch {
    body = null;
  }
  return { status: response.status, body, bodyByteLength: byteLength };
}

function responseBodyTooLarge(response: OpenAITransportResponse): boolean {
  if (response.bodyTooLarge === true) return true;
  if (
    response.bodyByteLength !== undefined &&
    (!Number.isInteger(response.bodyByteLength) ||
      response.bodyByteLength < 0 ||
      response.bodyByteLength > MAX_OPENAI_RESPONSE_BYTES)
  ) {
    return true;
  }
  if (typeof response.body === "string") {
    return Buffer.byteLength(response.body, "utf8") > MAX_OPENAI_RESPONSE_BYTES;
  }
  try {
    const encoded = JSON.stringify(response.body) ?? "";
    return Buffer.byteLength(encoded, "utf8") > MAX_OPENAI_RESPONSE_BYTES;
  } catch {
    return true;
  }
}

function providerStatusIsCompleted(body: unknown): boolean {
  return isRecord(body) && body.status === "completed";
}

function requestBody(modelId: PinnedModelId, prompt: ProviderPromptPackage): string {
  return JSON.stringify({
    model: modelId,
    store: false,
    input: [
      {
        role: "system",
        content: [
          {
            type: "input_text",
            text:
              "Return only exact, unedited segments copied from the supplied officialFacts claims and responsePoints text. You may order those segments, but you may not paraphrase, add connective text, add facts, add evidence, assert provenance, make decisions, or describe state changes. Return the required JSON object and label it generated-non-authoritative-wording.",
          },
        ],
      },
      {
        role: "user",
        content: [{ type: "input_text", text: JSON.stringify(prompt) }],
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "simulation_render",
        strict: true,
        schema: outputJsonSchema,
      },
    },
  });
}

export function createOpenAIResponsesAdapter(
  input: OpenAIResponsesAdapterConfig,
): ProviderAdapter {
  assertOnlyConfigurationKeys(input);
  const modelId = PinnedModelIdSchema.parse(input.modelId);
  if (typeof input.resolveApiKey !== "function") {
    throw new Error("The provider credential must come from the hosted secret resolver");
  }
  const timeoutMs = input.timeoutMs ?? 15_000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 250 || timeoutMs > 30_000) {
    throw new Error("The provider timeout must be between 250 and 30000 milliseconds");
  }
  const transport = input.transport ?? defaultTransport;
  const calibration = input.calibration ?? "not-run";

  return {
    providerId: "openai-responses",
    modelId,
    calibration,
    async render(prompt: ProviderPromptPackage): Promise<ProviderRenderAttempt> {
      const startedAt = Date.now();
      const controller = new AbortController();
      const timeoutAttempt = (): ProviderRenderAttempt => ({
        status: "failed",
        interactionId: "openai-timeout",
        failureClass: "timeout",
        latencyMs: Math.min(Date.now() - startedAt, 300_000),
      });
      const work = (async (): Promise<ProviderRenderAttempt> => {
        try {
          const apiKey = await input.resolveApiKey();
          if (controller.signal.aborted) return timeoutAttempt();
          if (apiKey.trim().length < 10 || /[\r\n]/u.test(apiKey)) {
            return {
              status: "failed",
              interactionId: "openai-credential-rejected",
              failureClass: "unauthorized",
              latencyMs: Date.now() - startedAt,
            };
          }
          const response = await transport({
            url: OPENAI_RESPONSES_ENDPOINT,
            method: "POST",
            headers: {
              authorization: `Bearer ${apiKey}`,
              "content-type": "application/json",
            },
            body: requestBody(modelId, prompt),
            redirect: "error",
            signal: controller.signal,
          });
          if (controller.signal.aborted) return timeoutAttempt();
          if (responseBodyTooLarge(response)) {
            return {
              status: "failed",
              interactionId: "openai-oversized-response",
              failureClass: "oversized-output",
              latencyMs: Date.now() - startedAt,
            };
          }
          const extracted = textFromResponse(response.body);
          const usage = usageFromResponse(response.body);
          if (response.status >= 300 && response.status < 400) {
            return {
              status: "failed",
              interactionId: extracted.interactionId,
              failureClass: "redirect-blocked",
              latencyMs: Date.now() - startedAt,
              ...(usage === undefined ? {} : { usage }),
            };
          }
          if (response.status === 401 || response.status === 403) {
            return {
              status: "failed",
              interactionId: extracted.interactionId,
              failureClass: "unauthorized",
              latencyMs: Date.now() - startedAt,
              ...(usage === undefined ? {} : { usage }),
            };
          }
          if (extracted.refused) {
            return {
              status: "failed",
              interactionId: extracted.interactionId,
              failureClass: "refusal",
              latencyMs: Date.now() - startedAt,
              ...(usage === undefined ? {} : { usage }),
            };
          }
          if (extracted.invalidTextSurfaces) {
            return {
              status: "failed",
              interactionId: extracted.interactionId,
              failureClass: "invalid-output",
              latencyMs: Date.now() - startedAt,
              ...(usage === undefined ? {} : { usage }),
            };
          }
          if (
            response.status < 200 ||
            response.status >= 300 ||
            !providerStatusIsCompleted(response.body) ||
            extracted.text === undefined
          ) {
            return {
              status: "failed",
              interactionId: extracted.interactionId,
              failureClass: "provider-error",
              latencyMs: Date.now() - startedAt,
              ...(usage === undefined ? {} : { usage }),
            };
          }
          let output: unknown;
          try {
            output = JSON.parse(extracted.text);
          } catch {
            output = extracted.text;
          }
          return {
            status: "success",
            interactionId: extracted.interactionId,
            output,
            latencyMs: Date.now() - startedAt,
            ...(usage === undefined ? {} : { usage }),
          };
        } catch (error) {
          const timedOut =
            controller.signal.aborted || (error instanceof Error && error.name === "AbortError");
          return timedOut
            ? timeoutAttempt()
            : {
                status: "failed",
                interactionId: "openai-request-failed",
                failureClass: "provider-error",
                latencyMs: Date.now() - startedAt,
              };
        }
      })();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const deadline = new Promise<ProviderRenderAttempt>((resolve) => {
        timer = setTimeout(() => {
          controller.abort();
          resolve(timeoutAttempt());
        }, timeoutMs);
      });
      try {
        return await Promise.race([work, deadline]);
      } finally {
        if (timer !== undefined) clearTimeout(timer);
      }
    },
  };
}
