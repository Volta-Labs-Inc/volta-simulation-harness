import {
  EvidenceRecordSchema,
  CalculationRecordSchema,
  LedgerEntrySchema,
  SubmissionDraftSchema,
} from "@volta-sim/contracts";
import { z } from "zod";

import type {
  StudentServiceClient,
  StudentServiceErrorCode,
  StudentServiceRequest,
  StudentServiceResponse,
} from "./types.js";

export interface StudentHttpResponse {
  readonly ok: boolean;
  readonly status: number;
  readonly headers: { get(name: string): string | null };
  readonly body: ReadableStream<Uint8Array> | null;
}

export type StudentHttpTransport = (
  url: string,
  init: RequestInit,
) => Promise<StudentHttpResponse>;

export const MAX_SERVICE_RESPONSE_BYTES = 1_000_000;
export const SERVICE_RESPONSE_DEADLINE_MS = 10_000;

const DigestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const CompletenessSchema = z.object({
  complete: z.boolean(),
  missing: z.array(z.object({ path: z.string(), message: z.string() })),
  requirements: z.array(
    z.object({
      requirementId: z.string(),
      status: z.enum(["addressed", "not-yet", "not-applicable", "missing"]),
    }),
  ),
  provenance: z.object({
    citedOfficialFactCount: z.number().int().nonnegative(),
    unreleasedFactIds: z.array(z.string()),
  }),
});
const EventSchema = z.object({
  eventId: z.string(),
  sequence: z.number().int().nonnegative(),
  eventType: z.string(),
  message: z.string(),
  officialFactIds: z.array(z.string()),
  provenance: z.array(z.object({ factId: z.string(), source: z.string() })),
  simulatedAt: z.string().datetime({ offset: true }),
});
const ArtifactRequirementSchema = z.object({
  required: z.boolean(),
  satisfied: z.boolean(),
  minimumCount: z.union([z.literal(0), z.literal(1)]),
});
const CriterionSchema = z.object({
  metric: z.string(),
  baseline: z.string().optional(),
  baselinePlan: z.string().optional(),
  target: z.string(),
  targetDate: z.string(),
  failureThreshold: z.string(),
});
const CriterionReasoningHistorySchema = z.object({
  kind: z.enum(["criterion-recorded", "criterion-removed"]),
  operationId: z.string(),
  attemptNumber: z.number().int().positive(),
  recordedAt: z.string().datetime({ offset: true }),
  criterionId: z.string(),
  criterion: CriterionSchema,
});
const ViewSchema = z.object({
  calculations: z.array(CalculationRecordSchema).optional(),
  calculationHistory: z.array(z.object({
    kind: z.enum(["calculation-recorded", "calculation-removed"]), operationId: z.string(),
    attemptNumber: z.number().int().positive(), recordedAt: z.string().datetime({ offset: true }), calculation: CalculationRecordSchema,
  })).optional(),
  assignmentId: z.string(),
  attemptNumber: z.number().int().positive(),
  attemptStatus: z.enum(["active", "submitted"]),
  reopenedFromAttempt: z.number().int().positive().optional(),
  caseVersionDigest: DigestSchema,
  repository: z.object({
    slug: z.string(),
    commitSha: z.string().regex(/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/),
    sessionIgnoreBlobId: z.string().regex(/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/),
  }),
  brief: z.string(),
  constraints: z.array(z.string()),
  unacceptableOutcomes: z.array(z.string()),
  responseFamilies: z.array(z.string()),
  difficulty: z.object({
    audience: z.string(),
    experienceLevel: z.enum(["introductory", "intermediate", "advanced"]),
    factors: z.array(
      z.object({
        id: z.string(),
        dimension: z.enum([
          "ambiguity",
          "data-availability",
          "stakeholder-complexity",
          "solution-risk",
          "economic-uncertainty",
        ]),
        level: z.enum(["low", "medium", "high"]),
        rationale: z.string(),
      }),
    ),
  }),
  rubric: z.array(z.object({ id: z.string(), prompt: z.string() })),
  requirements: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      status: z.enum(["addressed", "not-yet", "not-applicable", "missing"]),
    }),
  ),
  completeness: z.object({ complete: z.boolean(), missingPaths: z.array(z.string()) }),
  baseReadiness: CompletenessSchema,
  readiness: CompletenessSchema,
  artifactRequirement: ArtifactRequirementSchema,
  availablePersonas: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      role: z.string(),
      brief: z.string(),
      description: z.string(),
    }),
  ),
  availableEvidence: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      kind: z.enum(["file", "dataset", "system-query", "collection-opportunity"]),
      brief: z.string(),
      description: z.string(),
    }),
  ),
  availableCollectionMethods: z.array(
    z.object({ id: z.string(), description: z.string() }),
  ),
  capturedLedger: z.array(LedgerEntrySchema),
  capturedEvidence: z.array(EvidenceRecordSchema),
  successCriteria: z.array(
    z.object({
      criterionId: z.string(),
      metric: z.string(),
      baseline: z.string().optional(),
      baselinePlan: z.string().optional(),
      target: z.string(),
      targetDate: z.string(),
      failureThreshold: z.string(),
      valid: z.boolean(),
    }),
  ),
  reasoningHistory: z.array(CriterionReasoningHistorySchema),
  releasedEvidence: z.array(
    z.object({
      factId: z.string(),
      claim: z.string(),
      provenance: z.string(),
      eventId: z.string(),
    }),
  ),
  recentEvents: z.array(
    z.object({ eventId: z.string(), eventType: z.string(), message: z.string() }),
  ),
  stage: z.string(),
  pendingReview: z.boolean(),
  simulatedAt: z.string().datetime({ offset: true }),
  reviewUpdates: z.array(
    z.object({
      topic: z.string(),
      status: z.enum(["pending", "resolved"]),
      response: z.string().optional(),
      resolvedAt: z.string().datetime({ offset: true }).optional(),
    }),
  ),
  attemptHistory: z.array(
    z.object({
      attemptNumber: z.number().int().positive(),
      status: z.literal("submitted"),
      submissionDigest: DigestSchema,
      eventCount: z.number().int().nonnegative(),
      citedOfficialFactIds: z.array(z.string()),
      operationReceiptCount: z.number().int().nonnegative(),
      reasoningHistory: z.array(CriterionReasoningHistorySchema),
      calculationHistory: z.array(z.object({
        kind: z.enum(["calculation-recorded", "calculation-removed"]), operationId: z.string(),
        attemptNumber: z.number().int().positive(), recordedAt: z.string().datetime({ offset: true }), calculation: CalculationRecordSchema,
      })).optional(),
    }),
  ),
});

const ResponseSchema = z.union([
  z.object({
    kind: z.literal("login"),
    token: z.string().min(24),
    assignmentId: z.string(),
    repository: z.object({
      slug: z.string(),
      commitSha: z.string().regex(/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/),
      sessionIgnoreBlobId: z.string().regex(/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/),
    }),
  }),
  z.object({ kind: z.literal("view"), view: ViewSchema }),
  z.object({
    kind: z.literal("action"),
    message: z.string(),
    event: EventSchema.optional(),
    checkpointPrompts: z.array(z.string()),
    reviewSuggested: z.boolean(),
    reviewSuggestion: z.object({ reason: z.string(), nextStep: z.string() }).optional(),
    simulatedTime: z
      .object({
        advancedBy: z.object({
          amount: z.number().int().nonnegative(),
          unit: z.enum(["minutes", "hours", "days"]),
        }),
        now: z.string().datetime({ offset: true }),
      })
      .optional(),
    guidance: z.string().optional(),
    sandboxWorkBlocked: z.literal(false),
    replayed: z.boolean(),
    recorded: z
      .discriminatedUnion("kind", [
        z.object({
          kind: z.literal("ledger"),
          ledgerEntryId: z.string(),
          evidenceIds: z.array(z.string()),
        }),
        z.object({ kind: z.literal("criterion"), criterionId: z.string() }),
        z.object({ kind: z.literal("criterion-removal"), criterionId: z.string() }),
        z.object({ kind: z.literal("calculation"), calculationId: z.string() }),
        z.object({ kind: z.literal("calculation-removal"), calculationId: z.string() }),
        z.object({ kind: z.literal("estimate"), estimateId: z.string() }),
        z.object({ kind: z.literal("decision"), decisionId: z.string() }),
        z.object({ kind: z.literal("requirement"), requirementId: z.string() }),
        z.object({ kind: z.literal("claim"), competencyId: z.string() }),
        z.object({ kind: z.literal("draft"), mode: z.string() }),
      ])
      .optional(),
  }),
  z.object({ kind: z.literal("checkpoint"), prompts: z.array(z.string()) }),
  z
    .object({
      kind: z.literal("preparation"),
      ready: z.boolean(),
      baseReady: z.boolean(),
      submissionBase: SubmissionDraftSchema.optional(),
      requestedMode: z
        .enum(["build", "pilot", "buy", "no-build", "data-collection"])
        .optional(),
      baseReport: CompletenessSchema,
      report: CompletenessSchema,
      artifactRequirement: ArtifactRequirementSchema,
    })
    .superRefine((value, context) => {
      if (
        value.baseReady !==
        (value.submissionBase !== undefined && value.requestedMode !== undefined)
      ) {
        context.addIssue({ code: z.ZodIssueCode.custom, message: "Invalid preparation response" });
      }
      if (value.ready && (!value.baseReady || value.artifactRequirement.required)) {
        context.addIssue({ code: z.ZodIssueCode.custom, message: "Invalid ready response" });
      }
    }),
  z
    .object({
      kind: z.literal("submission"),
      accepted: z.boolean(),
      attemptNumber: z.number().int().positive(),
      submissionDigest: DigestSchema.optional(),
      report: CompletenessSchema,
      replayed: z.boolean(),
    })
    .superRefine((value, context) => {
      if (value.accepted !== (value.submissionDigest !== undefined)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "An accepted submission requires exactly one immutable receipt digest",
        });
      }
    }),
  z.object({ kind: z.literal("logout"), replayed: z.boolean() }),
]);

const ErrorCodeSchema = z.enum([
  "ACTION_UNAVAILABLE",
  "ATTEMPT_SUBMITTED",
  "CRITERION_NOT_FOUND",
  "CALCULATION_NOT_FOUND",
  "INVALID_CALCULATION",
  "INVALID_EVIDENCE_REFERENCE",
  "INVALID_INPUT",
  "LOGIN_REPLAY_UNAVAILABLE",
  "OPERATION_ID_CONFLICT",
  "REPOSITORY_MISMATCH",
  "RETRY_SAME_OPERATION",
  "SESSION_UNAVAILABLE",
] satisfies readonly [StudentServiceErrorCode, ...StudentServiceErrorCode[]]);

const SAFE_SERVICE_ERRORS: Readonly<Record<StudentServiceErrorCode, string>> = {
  ACTION_UNAVAILABLE: "That action is unavailable. Run status and use one of the listed IDs.",
  ATTEMPT_SUBMITTED: "This attempt is already submitted. Resume the reopened attempt to continue.",
  CRITERION_NOT_FOUND: "That criterion was not found. Run status and use the exact criterion ID.",
  CALCULATION_NOT_FOUND: "That calculation was not found. Run status and use its exact ID.",
  INVALID_CALCULATION: "The calculation result or units do not match its inputs and formula. Correct them and retry; no calculation was saved.",
  INVALID_EVIDENCE_REFERENCE: "That evidence reference is unavailable. Run status and use an exact captured evidence ID.",
  INVALID_INPUT: "The service rejected this input. Check the command help and correct the flagged fields.",
  LOGIN_REPLAY_UNAVAILABLE: "That login can no longer be replayed. Sign in with a new operation ID.",
  OPERATION_ID_CONFLICT: "That operation ID was used for a different action in this attempt. Use a new operation ID.",
  REPOSITORY_MISMATCH: "The selected files do not match the assigned checkout. Capture them again and retry.",
  RETRY_SAME_OPERATION: "The request is unavailable. Your work may already be saved; retry the same operation ID.",
  SESSION_UNAVAILABLE: "Your session is unavailable. Sign in again, then retry.",
};

function safeServiceError(value: unknown): string | undefined {
  const parsed = z.object({ code: ErrorCodeSchema }).safeParse(value);
  return parsed.success ? SAFE_SERVICE_ERRORS[parsed.data.code] : undefined;
}

const ROUTES: Record<StudentServiceRequest["kind"], { readonly method: "GET" | "POST"; readonly path: string }> = {
  login: { method: "POST", path: "/v1/student/pair" },
  resume: { method: "GET", path: "/v1/student/assignment/resume" },
  status: { method: "GET", path: "/v1/student/assignment/status" },
  talk: { method: "POST", path: "/v1/student/actions/talk" },
  evidence: { method: "POST", path: "/v1/student/actions/evidence" },
  collect: { method: "POST", path: "/v1/student/actions/collect" },
  advance: { method: "POST", path: "/v1/student/actions/advance" },
  ledger: { method: "POST", path: "/v1/student/reasoning/ledger" },
  decision: { method: "POST", path: "/v1/student/reasoning/decision" },
  estimate: { method: "POST", path: "/v1/student/reasoning/estimate" },
  requirement: { method: "POST", path: "/v1/student/reasoning/requirement" },
  claim: { method: "POST", path: "/v1/student/reasoning/claim" },
  draft: { method: "POST", path: "/v1/student/reasoning/draft" },
  criterion: { method: "POST", path: "/v1/student/reasoning/criterion" },
  "criterion-remove": { method: "POST", path: "/v1/student/reasoning/criterion/remove" },
  calculation: { method: "POST", path: "/v1/student/reasoning/calculation" },
  "calculation-remove": { method: "POST", path: "/v1/student/reasoning/calculation/remove" },
  checkpoint: { method: "GET", path: "/v1/student/checkpoint" },
  "prepare-submission": { method: "GET", path: "/v1/student/submission/prepare" },
  "review-request": { method: "POST", path: "/v1/student/review-request" },
  submit: { method: "POST", path: "/v1/student/submit" },
  logout: { method: "POST", path: "/v1/student/logout" },
};

function validateOrigin(input: string): string {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error("The configured service origin is invalid");
  }
  const loopback = url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "[::1]";
  if (
    (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) ||
    url.username !== "" ||
    url.password !== "" ||
    (url.pathname !== "" && url.pathname !== "/") ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new Error("The configured service origin is not allowed");
  }
  return url.origin;
}

async function defaultTransport(url: string, init: RequestInit): Promise<StudentHttpResponse> {
  return fetch(url, init);
}

async function boundedJson(
  response: StudentHttpResponse,
  signal: AbortSignal,
): Promise<unknown> {
  const declaredLength = response.headers.get("content-length");
  if (
    declaredLength !== null &&
    (!/^\d+$/.test(declaredLength) || Number(declaredLength) > MAX_SERVICE_RESPONSE_BYTES)
  ) {
    await response.body?.cancel("response too large");
    throw new Error("response too large");
  }
  if (response.body === null) throw new Error("response body missing");
  const reader = response.body.getReader();
  const aborted = new Promise<never>((_resolve, reject) => {
    signal.addEventListener(
      "abort",
      () => {
        void reader.cancel("response deadline exceeded").catch(() => undefined);
        reject(new Error("response deadline exceeded"));
      },
      { once: true },
    );
  });
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const chunk = await Promise.race([reader.read(), aborted]);
    if (chunk.done) break;
    if (chunk.value === undefined) throw new Error("response body invalid");
    total += chunk.value.byteLength;
    if (total > MAX_SERVICE_RESPONSE_BYTES) {
      await reader.cancel("response too large");
      throw new Error("response too large");
    }
    chunks.push(chunk.value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
}

export class HttpStudentServiceClient implements StudentServiceClient {
  readonly #origin: string;

  constructor(
    origin: string,
    private readonly transport: StudentHttpTransport = defaultTransport,
    private readonly deadlineMs = SERVICE_RESPONSE_DEADLINE_MS,
  ) {
    this.#origin = validateOrigin(origin);
    if (!Number.isInteger(deadlineMs) || deadlineMs < 1 || deadlineMs > 60_000) {
      throw new Error("The service response deadline is invalid");
    }
  }

  async execute(
    request: StudentServiceRequest,
    token?: string,
  ): Promise<StudentServiceResponse> {
    if (request.kind !== "login" && (token === undefined || token.length < 24)) {
      throw new Error("The request is unavailable. Sign in again, then retry");
    }
    const route = ROUTES[request.kind];
    const headers: Record<string, string> = { accept: "application/json" };
    if (token !== undefined) headers.authorization = `Bearer ${token}`;
    const controller = new AbortController();
    const init: RequestInit = {
      method: route.method,
      headers,
      redirect: "error",
      signal: controller.signal,
    };
    if (route.method === "POST") {
      headers["content-type"] = "application/json";
      init.body = JSON.stringify(request);
    }

    let response: StudentHttpResponse;
    let rejectDeadline: ((error: Error) => void) | undefined;
    const deadline = new Promise<never>((_resolve, reject) => {
      rejectDeadline = reject;
    });
    const timer = setTimeout(() => {
      controller.abort();
      rejectDeadline?.(new Error("response deadline exceeded"));
    }, this.deadlineMs);
    try {
      response = await Promise.race([
        this.transport(`${this.#origin}${route.path}`, init),
        deadline,
      ]);
    } catch {
      clearTimeout(timer);
      throw new Error("The service is unavailable. Your local work is unchanged; retry when online");
    }
    if (!response.ok) {
      let safeMessage: string | undefined;
      try {
        const body = await Promise.race([boundedJson(response, controller.signal), deadline]);
        safeMessage = safeServiceError(body);
      } catch {
        // Unusable rejected response details fall back to the fixed generic message.
      } finally {
        clearTimeout(timer);
      }
      throw new Error(
        safeMessage ?? "The request is unavailable. Check your session and assignment, then retry",
      );
    }
    try {
      return ResponseSchema.parse(
        await Promise.race([boundedJson(response, controller.signal), deadline]),
      ) as StudentServiceResponse;
    } catch {
      throw new Error("The service returned an unusable response. No local work was changed");
    } finally {
      clearTimeout(timer);
    }
  }
}
