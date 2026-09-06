import { describe, expect, it, vi } from "vitest";

import {
  HttpStudentServiceClient,
  type StudentHttpResponse,
  type StudentHttpTransport,
} from "../src/http-client.js";

function httpResponse(value: unknown, ok = true, status = 200) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  return {
    ok,
    status,
    headers: { get: (name: string) => (name.toLowerCase() === "content-length" ? String(bytes.byteLength) : null) },
    body: new ReadableStream({ start: (controller) => { controller.enqueue(bytes); controller.close(); } }),
  };
}

describe("allowlisted HTTP student service client", () => {
  it("uses only the fixed route and strips newly added protected response fields", async () => {
    const transport = vi.fn<StudentHttpTransport>(async () =>
      httpResponse({
        kind: "view",
        protectedTruth: "PRIVATE-CANARY",
        view: {
          assignmentId: "assignment-1",
          attemptNumber: 1,
          attemptStatus: "active",
          caseVersionDigest: `sha256:${"a".repeat(64)}`,
          repository: {
            slug: "Volta-Labs-Inc/assignment-1",
            commitSha: "a".repeat(40),
            sessionIgnoreBlobId: "b".repeat(40),
          },
          brief: "Investigate the fictional routing delay.",
          constraints: ["Use only released evidence."],
          unacceptableOutcomes: ["Do not invent private facts."],
          responseFamilies: ["Collect more evidence."],
          difficulty: {
            audience: "New analysts",
            experienceLevel: "introductory",
            factors: [
              {
                id: "factor-1",
                dimension: "ambiguity",
                level: "low",
                rationale: "The assignment is bounded.",
              },
            ],
          },
          rubric: [],
          requirements: [],
          completeness: { complete: false, missingPaths: ["ledger"] },
          baseReadiness: {
            complete: false,
            missing: [{ path: "ledger", message: "Required" }],
            requirements: [],
            provenance: { citedOfficialFactCount: 0, unreleasedFactIds: [] },
          },
          readiness: {
            complete: false,
            missing: [{ path: "ledger", message: "Required" }],
            requirements: [],
            provenance: { citedOfficialFactCount: 0, unreleasedFactIds: [] },
          },
          artifactRequirement: { required: false, satisfied: true, minimumCount: 0 },
          availablePersonas: [],
          availableEvidence: [],
          availableCollectionMethods: [],
          capturedLedger: [],
          capturedEvidence: [],
          successCriteria: [],
          reasoningHistory: [],
          releasedEvidence: [],
          recentEvents: [],
          stage: "discovery",
          simulatedAt: "2026-09-04T12:00:00.000Z",
          pendingReview: false,
          reviewUpdates: [
            {
              topic: "Review the bounded observation",
              status: "resolved",
              response: "Proceed only with the fictional sample.",
              resolvedAt: "2026-09-04T17:00:00.000Z",
              protectedAnalysis: "PRIVATE-CANARY",
            },
          ],
          attemptHistory: [],
          evaluationAnchor: "PRIVATE-CANARY",
        },
      }),
    );
    const client = new HttpStudentServiceClient("https://simulation.example", transport);

    const result = await client.execute(
      { kind: "resume" },
      "opaque-token-with-enough-entropy",
    );

    expect(transport).toHaveBeenCalledOnce();
    expect(transport.mock.calls[0]?.[0]).toBe(
      "https://simulation.example/v1/student/assignment/resume",
    );
    expect(transport.mock.calls[0]?.[1]).toMatchObject({
      method: "GET",
      redirect: "error",
      headers: { authorization: "Bearer opaque-token-with-enough-entropy" },
    });
    expect(JSON.stringify(result)).not.toContain("PRIVATE-CANARY");
    expect(JSON.stringify(result)).not.toContain("evaluationAnchor");
    expect(JSON.stringify(result)).not.toContain("protectedAnalysis");
    expect(JSON.stringify(result)).toContain("Proceed only with the fictional sample.");
  });

  it.each([
    "http://simulation.example",
    "https://user:password@simulation.example",
    "https://simulation.example/arbitrary-path",
    "https://simulation.example?redirect=https://canary.invalid",
  ])("rejects an unsafe configured service origin: %s", (origin) => {
    expect(() => new HttpStudentServiceClient(origin, vi.fn())).toThrow(/service origin/i);
  });

  it("permits plain HTTP only for loopback development and refuses redirects", async () => {
    const transport = vi.fn<StudentHttpTransport>(async () =>
      httpResponse({ location: "https://canary.invalid" }, false, 302),
    );
    const client = new HttpStudentServiceClient("http://127.0.0.1:55821", transport);
    await expect(
      client.execute({ kind: "status" }, "opaque-token-with-enough-entropy"),
    ).rejects.toThrow(
      /unavailable/i,
    );
    expect(transport.mock.calls[0]?.[1]).toMatchObject({ redirect: "error" });
  });

  it("never accepts a caller-supplied path or destination in an action", async () => {
    const transport = vi.fn<StudentHttpTransport>(async () =>
      httpResponse({
        kind: "action",
        message: "Recorded.",
        checkpointPrompts: [],
        reviewSuggested: false,
        sandboxWorkBlocked: false,
        replayed: false,
        protectedUrl: "https://canary.invalid",
      }),
    );
    const client = new HttpStudentServiceClient("https://simulation.example", transport);
    const result = await client.execute(
      {
        kind: "collect",
        operationId: "collect-1",
        methodId: "sample-audit",
        plan: "Review ten fictional records.",
      },
      "opaque-token-with-enough-entropy",
    );
    expect(transport.mock.calls[0]?.[0]).toBe(
      "https://simulation.example/v1/student/actions/collect",
    );
    expect(JSON.stringify(result)).not.toContain("canary.invalid");
  });

  it("rejects an accepted submission response without its immutable receipt digest", async () => {
    const transport = vi.fn<StudentHttpTransport>(async () =>
      httpResponse({
        kind: "submission",
        accepted: true,
        attemptNumber: 1,
        report: {
          complete: true,
          missing: [],
          requirements: [],
          provenance: { citedOfficialFactCount: 1, unreleasedFactIds: [] },
        },
        replayed: false,
      }),
    );
    const client = new HttpStudentServiceClient("https://simulation.example", transport);
    await expect(
      client.execute({ kind: "status" }, "opaque-token-with-enough-entropy"),
    ).rejects.toThrow(/unusable response/i);
  });

  it("cancels an oversized response before parsing it", async () => {
    const cancel = vi.fn();
    let reads = 0;
    const chunk = new Uint8Array(600_000);
    const transport = vi.fn<StudentHttpTransport>(async () => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      body: new ReadableStream({
        pull: (controller) => {
          reads += 1;
          controller.enqueue(chunk);
        },
        cancel,
      }),
    }));
    const client = new HttpStudentServiceClient("https://simulation.example", transport);
    await expect(
      client.execute({ kind: "status" }, "opaque-token-with-enough-entropy"),
    ).rejects.toThrow(/unusable response/i);
    expect(cancel).toHaveBeenCalledOnce();
    expect(reads).toBeGreaterThanOrEqual(2);
  });

  it("aborts when response headers do not arrive before the hard deadline", async () => {
    let signal: AbortSignal | undefined;
    const transport = vi.fn<StudentHttpTransport>(async (_url, init) => {
      signal = init.signal ?? undefined;
      return new Promise<StudentHttpResponse>(() => undefined);
    });
    const client = new HttpStudentServiceClient("https://simulation.example", transport, 10);
    await expect(
      client.execute({ kind: "status" }, "opaque-token-with-enough-entropy"),
    ).rejects.toThrow(/unavailable/i);
    expect(signal?.aborted).toBe(true);
  });

  it("cancels a body that stalls past the same hard deadline", async () => {
    const cancel = vi.fn();
    const transport = vi.fn<StudentHttpTransport>(async () => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      body: new ReadableStream({ cancel }),
    }));
    const client = new HttpStudentServiceClient("https://simulation.example", transport, 10);
    await expect(
      client.execute({ kind: "status" }, "opaque-token-with-enough-entropy"),
    ).rejects.toThrow(/unusable response/i);
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("cancels a body that keeps trickling bytes past the absolute deadline", async () => {
    let interval: ReturnType<typeof setInterval> | undefined;
    const cancel = vi.fn(() => {
      if (interval !== undefined) clearInterval(interval);
    });
    const transport = vi.fn<StudentHttpTransport>(async () => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      body: new ReadableStream({
        start: (controller) => {
          interval = setInterval(() => controller.enqueue(new Uint8Array([123])), 2);
        },
        cancel,
      }),
    }));
    const client = new HttpStudentServiceClient("https://simulation.example", transport, 15);
    await expect(
      client.execute({ kind: "status" }, "opaque-token-with-enough-entropy"),
    ).rejects.toThrow(/unusable response/i);
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("does not let disposal of a rejected response outlive the hard deadline", async () => {
    let signal: AbortSignal | undefined;
    const cancel = vi.fn(() => new Promise<void>(() => undefined));
    const transport = vi.fn<StudentHttpTransport>(async (_url, init) => {
      signal = init.signal ?? undefined;
      return {
        ok: false,
        status: 503,
        headers: { get: () => null },
        body: new ReadableStream({ cancel }),
      };
    });
    const client = new HttpStudentServiceClient("https://simulation.example", transport, 10);
    await expect(
      client.execute({ kind: "status" }, "opaque-token-with-enough-entropy"),
    ).rejects.toThrow(/unavailable/i);
    expect(signal?.aborted).toBe(true);
    expect(cancel).toHaveBeenCalledOnce();
  });
});
