import fs from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  FileBackedMockStudentService,
  reopenMockAttempt,
} from "../src/mock-service.js";
import {
  HttpStudentServiceClient,
  type StudentHttpTransport,
} from "../src/http-client.js";
import { runCli } from "../src/cli.js";
import type { MockStudentServiceState } from "../src/types.js";
import { createStudentFixture } from "./fixture.js";

const roots: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function fixture() {
  const value = createStudentFixture();
  roots.push(value.root, value.serviceRoot);
  return value;
}

async function login(
  service: FileBackedMockStudentService,
  operationId: string,
): Promise<string> {
  const response = await service.execute({ kind: "login", operationId });
  if (response.kind !== "login") throw new Error("login failed");
  return response.token;
}

function writeState(value: ReturnType<typeof createStudentFixture>): void {
  fs.writeFileSync(
    `${value.serviceRoot}/${value.statePath}`,
    `${JSON.stringify(value.state, null, 2)}\n`,
    { mode: 0o600 },
  );
}

function httpResponse(value: unknown, ok = true, status = 200) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  return {
    ok,
    status,
    headers: {
      get: (name: string) =>
        name.toLowerCase() === "content-length" ? String(bytes.byteLength) : null,
    },
    body: new ReadableStream({
      start: (controller) => {
        controller.enqueue(bytes);
        controller.close();
      },
    }),
  };
}

describe("adversarial completion repairs", () => {
  it("scopes operation receipts to one attempt and preserves prior receipts on reopen", async () => {
    const value = fixture();
    const service = new FileBackedMockStudentService(value.serviceRoot, value.statePath, {
      now: () => new Date("2026-09-04T16:00:00.000Z"),
    });
    const firstToken = await login(service, "login-attempt-1");
    await service.execute(
      {
        kind: "ledger",
        operationId: "shared-operation",
        entry: {
          kind: "fact",
          statement: "Attempt 1 records the released median.",
          officialFactIds: ["median-wait"],
        },
      },
      firstToken,
    );
    const submitted = await service.execute(
      {
        kind: "submit",
        operationId: "submit-attempt-1",
        draft: value.draft,
        artifacts: [],
        repository: {
          repositorySlug: value.state.expectedRepository.slug,
          commitSha: value.commitSha,
          sessionIgnoreBlobId: value.sessionIgnoreBlobId,
          selectedBlobs: [],
        },
        mode: "no-build",
      },
      firstToken,
    );
    expect(submitted).toMatchObject({ kind: "submission", accepted: true });
    await reopenMockAttempt(
      value.serviceRoot,
      value.statePath,
      "2026-09-05T13:00:00.000Z",
    );

    const secondToken = await login(service, "login-attempt-2");
    const second = await service.execute(
      {
        kind: "ledger",
        operationId: "shared-operation",
        entry: {
          kind: "unknown",
          statement: "Attempt 2 still needs an accuracy baseline.",
          officialFactIds: [],
        },
      },
      secondToken,
    );
    expect(second).toMatchObject({ kind: "action", replayed: false });
    const saved = JSON.parse(
      fs.readFileSync(`${value.serviceRoot}/${value.statePath}`, "utf8"),
    ) as MockStudentServiceState;
    expect(saved.operations).toHaveProperty("shared-operation");
    expect(saved.attemptHistory[0]?.operations).toHaveProperty("shared-operation");
    expect(saved.attemptHistory[0]?.attempt.attemptNumber).toBe(1);
    expect(saved.attempt.attemptNumber).toBe(2);
  });

  it("never replays a login token after it is revoked, expired, or superseded", async () => {
    const revokedValue = fixture();
    const revokedNow = new Date("2026-09-04T15:00:00.000Z");
    const revokedService = new FileBackedMockStudentService(
      revokedValue.serviceRoot,
      revokedValue.statePath,
      { now: () => revokedNow },
    );
    const revokedToken = await login(revokedService, "login-revoked");
    await revokedService.execute(
      { kind: "logout", operationId: "logout-revoked" },
      revokedToken,
    );
    await expect(login(revokedService, "login-revoked")).rejects.toMatchObject({
      code: "LOGIN_REPLAY_UNAVAILABLE",
    });

    const expiredValue = fixture();
    let expiredNow = new Date("2026-09-04T15:00:00.000Z");
    const expiredService = new FileBackedMockStudentService(
      expiredValue.serviceRoot,
      expiredValue.statePath,
      { now: () => expiredNow },
    );
    await login(expiredService, "login-expired");
    expiredNow = new Date("2026-09-04T15:16:00.000Z");
    await expect(login(expiredService, "login-expired")).rejects.toMatchObject({
      code: "LOGIN_REPLAY_UNAVAILABLE",
    });

    const replacedValue = fixture();
    const replacedService = new FileBackedMockStudentService(
      replacedValue.serviceRoot,
      replacedValue.statePath,
    );
    await login(replacedService, "login-old");
    await login(replacedService, "login-new");
    await expect(login(replacedService, "login-old")).rejects.toMatchObject({
      code: "LOGIN_REPLAY_UNAVAILABLE",
    });
  });

  it("separates base readiness from a missing build artifact while preserving no-build readiness", async () => {
    const buildValue = fixture();
    buildValue.state.workingDraft = structuredClone(buildValue.draft);
    (buildValue.state.workingDraft.responsePlan as { mode: string }).mode = "build";
    writeState(buildValue);
    const buildService = new FileBackedMockStudentService(
      buildValue.serviceRoot,
      buildValue.statePath,
    );
    const buildToken = await login(buildService, "login-build-readiness");
    const buildStatus = await buildService.execute({ kind: "status" }, buildToken);
    const buildPreparation = await buildService.execute(
      { kind: "prepare-submission" },
      buildToken,
    );
    expect(buildStatus).toMatchObject({
      kind: "view",
      view: {
        baseReadiness: { complete: true },
        readiness: {
          complete: false,
          missing: [{ path: "responsePlan.artifactSnapshots" }],
        },
        artifactRequirement: { required: true, selected: false, minimumCount: 1 },
      },
    });
    expect(buildPreparation).toMatchObject({
      kind: "preparation",
      baseReady: true,
      ready: false,
      requestedMode: "build",
      artifactRequirement: { required: true, selected: false, minimumCount: 1 },
    });

    const noBuildValue = fixture();
    noBuildValue.state.workingDraft = structuredClone(noBuildValue.draft);
    writeState(noBuildValue);
    const noBuildService = new FileBackedMockStudentService(
      noBuildValue.serviceRoot,
      noBuildValue.statePath,
    );
    const noBuildToken = await login(noBuildService, "login-no-build-readiness");
    await expect(
      noBuildService.execute({ kind: "prepare-submission" }, noBuildToken),
    ).resolves.toMatchObject({
      kind: "preparation",
      baseReady: true,
      ready: true,
      requestedMode: "no-build",
      artifactRequirement: { required: false, selected: true, minimumCount: 0 },
    });
  });

  it("keeps the full criterion and its removal in immutable attempt-scoped reasoning history", async () => {
    const value = fixture();
    const service = new FileBackedMockStudentService(value.serviceRoot, value.statePath);
    const token = await login(service, "login-history");
    const criterion = {
      metric: "Median response time",
      baseline: "18 minutes",
      target: "12 minutes",
      targetDate: "2026-10-31T00:00:00.000Z",
      failureThreshold: "Above 18 minutes",
    } as const;
    await service.execute(
      { kind: "criterion", operationId: "criterion-history", criterion },
      token,
    );
    await service.execute(
      {
        kind: "criterion-remove",
        operationId: "remove-history",
        criterionId: "criterion-criterion-history",
      },
      token,
    );
    const current = await service.execute({ kind: "status" }, token);
    expect(current).toMatchObject({
      kind: "view",
      view: {
        reasoningHistory: [
          {
            kind: "criterion-recorded",
            attemptNumber: 1,
            criterionId: "criterion-criterion-history",
            criterion,
          },
          {
            kind: "criterion-removed",
            attemptNumber: 1,
            criterionId: "criterion-criterion-history",
            criterion,
          },
        ],
      },
    });

    await service.execute(
      {
        kind: "submit",
        operationId: "submit-history",
        draft: value.draft,
        artifacts: [],
        repository: {
          repositorySlug: value.state.expectedRepository.slug,
          commitSha: value.commitSha,
          sessionIgnoreBlobId: value.sessionIgnoreBlobId,
          selectedBlobs: [],
        },
        mode: "no-build",
      },
      token,
    );
    await reopenMockAttempt(
      value.serviceRoot,
      value.statePath,
      "2026-09-05T13:00:00.000Z",
    );
    const reopenedToken = await login(service, "login-history-2");
    const reopened = await service.execute({ kind: "status" }, reopenedToken);
    expect(reopened).toMatchObject({
      kind: "view",
      view: {
        reasoningHistory: [],
        attemptHistory: [
          {
            attemptNumber: 1,
            reasoningHistory: [
              { kind: "criterion-recorded", criterion },
              { kind: "criterion-removed", criterion },
            ],
          },
        ],
      },
    });
  });

  it("shows every authored student-visible guidance field without protected case content", async () => {
    const value = fixture();
    const service = new FileBackedMockStudentService(value.serviceRoot, value.statePath);
    const token = await login(service, "login-guidance");
    const response = await service.execute({ kind: "status" }, token);
    expect(response.kind).toBe("view");
    if (response.kind !== "view") return;
    const visible = value.state.submissionContext.publishedCase.source.visible;
    expect(response.view.constraints).toEqual(visible.constraints);
    expect(response.view.unacceptableOutcomes).toEqual(visible.unacceptableOutcomes);
    expect(response.view.responseFamilies).toEqual(visible.nonExhaustiveResponseFamilies);
    expect(response.view.difficulty).toEqual(visible.difficulty);
    expect(response.view.availablePersonas).toEqual(
      visible.personas.map(({ id, name, role, studentBrief }) => ({
        id,
        name,
        role,
        brief: studentBrief,
        description: `${name}, ${role}`,
      })),
    );
    expect(response.view.availableEvidence).toEqual(
      visible.evidenceSources.map(({ id, title, kind, studentBrief }) => ({
        id,
        title,
        kind,
        brief: studentBrief,
        description: title,
      })),
    );
    expect(JSON.stringify(response)).not.toContain("PROTECTED-SERVICE-TRUTH-CANARY");
  });

  it("uses only allowlisted error codes and never exposes arbitrary service text", async () => {
    const transport = vi.fn<StudentHttpTransport>(async () =>
      httpResponse(
        {
          code: "CRITERION_NOT_FOUND",
          error: "PRIVATE-SERVICE-DETAIL",
        },
        false,
        400,
      ),
    );
    const client = new HttpStudentServiceClient("https://simulation.example", transport);
    await expect(
      client.execute(
        {
          kind: "criterion-remove",
          operationId: "remove-missing",
          criterionId: "criterion-missing",
        },
        "opaque-token-with-enough-entropy",
      ),
    ).rejects.toThrow(/run status.*criterion id/i);
    await expect(
      client.execute(
        {
          kind: "criterion-remove",
          operationId: "remove-missing-2",
          criterionId: "criterion-missing",
        },
        "opaque-token-with-enough-entropy",
      ),
    ).rejects.not.toThrow(/PRIVATE-SERVICE-DETAIL/);

    const unknownTransport = vi.fn<StudentHttpTransport>(async () =>
      httpResponse(
        { code: "NEW_PRIVATE_ERROR", error: "PRIVATE-UNKNOWN-DETAIL" },
        false,
        400,
      ),
    );
    const unknownClient = new HttpStudentServiceClient(
      "https://simulation.example",
      unknownTransport,
    );
    await expect(
      unknownClient.execute({ kind: "status" }, "opaque-token-with-enough-entropy"),
    ).rejects.toThrow("The request is unavailable. Check your session and assignment, then retry");
  });

  it("lists the request alias in global help", async () => {
    const stdout: string[] = [];
    const result = await runCli(["--help"], {
      io: { writeOut: (value) => stdout.push(value), writeError: () => undefined },
    });
    expect(result).toBe(0);
    expect(stdout.join("\n")).toMatch(/^\s+request\s+/m);
  });
});
