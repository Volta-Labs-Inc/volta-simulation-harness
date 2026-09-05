import fs from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { SubmissionDraft } from "@volta-sim/contracts";

import { runCli } from "../src/cli.js";
import { FileBackedMockStudentService } from "../src/mock-service.js";
import type { StudentServiceClient, StudentServiceRequest } from "../src/types.js";
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

function io() {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    stdout,
    stderr,
    value: {
      writeOut: (message: string) => stdout.push(message),
      writeError: (message: string) => stderr.push(message),
    },
  };
}

async function login(service: FileBackedMockStudentService) {
  const response = await service.execute({ kind: "login", operationId: "login-1" });
  if (response.kind !== "login") throw new Error("login failed");
  return response.token;
}

describe("student completion controls", () => {
  it("offers global and per-command help without reading a session or contacting the service", async () => {
    const execute = vi.fn<StudentServiceClient["execute"]>();
    const global = io();
    const command = io();

    await expect(
      runCli(["--help"], { client: { execute }, io: global.value }),
    ).resolves.toBe(0);
    await expect(
      runCli(["decision", "--help"], { client: { execute }, io: command.value }),
    ).resolves.toBe(0);

    expect(global.stdout.join("\n")).toContain("Available commands");
    expect(global.stdout.join("\n")).toContain("criterion-remove");
    expect(command.stdout.join("\n")).toContain(
      "continue | pivot | buy | collect-more-evidence | stop",
    );
    expect(command.stdout.join("\n")).toContain(
      "description|source-or-method|decision-use",
    );
    expect(command.stdout.join("\n")).toContain("Example:");
    for (const name of [
      "login",
      "resume",
      "status",
      "talk",
      "evidence",
      "request",
      "collect",
      "advance",
      "ledger",
      "decision",
      "estimate",
      "requirement",
      "claim",
      "criterion",
      "criterion-remove",
      "calculation",
      "draft",
      "checkpoint",
      "review-request",
      "submit",
      "logout",
    ]) {
      const current = io();
      await expect(
        runCli(["help", name], { client: { execute }, io: current.value }),
      ).resolves.toBe(0);
      expect(current.stdout.join("\n"), name).toContain("Usage:");
      expect(current.stdout.join("\n"), name).toContain("Example:");
    }
    expect(execute).not.toHaveBeenCalled();
  });

  it("rejects bad target dates locally and normalizes a calendar date before recording", async () => {
    const value = fixture();
    const service = new FileBackedMockStudentService(value.serviceRoot, value.statePath, {
      now: () => new Date("2026-09-04T16:00:00.000Z"),
    });
    const loginIo = io();
    expect(
      await runCli(["login", "--operation-id", "login-date"], {
        assignmentRoot: value.root,
        client: service,
        io: loginIo.value,
      }),
    ).toBe(0);

    const invalidIo = io();
    const invalid = await runCli(
      [
        "criterion",
        "--operation-id",
        "criterion-invalid",
        "--metric",
        "Median response time",
        "--baseline",
        "18 minutes",
        "--target",
        "12 minutes",
        "--target-date",
        "2026-09-31",
        "--failure-threshold",
        "Above 18 minutes",
      ],
      { assignmentRoot: value.root, client: service, io: invalidIo.value },
    );
    expect(invalid).toBe(1);
    expect(invalidIo.stderr.join("\n")).toMatch(/yyyy-mm-dd/i);

    const validIo = io();
    const valid = await runCli(
      [
        "criterion",
        "--operation-id",
        "criterion-calendar-date",
        "--metric",
        "Median response time",
        "--baseline",
        "18 minutes",
        "--target",
        "12 minutes",
        "--target-date",
        "2026-10-31",
        "--failure-threshold",
        "Above 18 minutes",
      ],
      { assignmentRoot: value.root, client: service, io: validIo.value },
    );
    expect(valid).toBe(0);
    const saved = JSON.parse(
      fs.readFileSync(`${value.serviceRoot}/${value.statePath}`, "utf8"),
    ) as { workingDraft: { successCriteria?: { targetDate: string }[] } };
    expect(saved.workingDraft.successCriteria?.[0]?.targetDate).toBe(
      "2026-10-31T00:00:00.000Z",
    );
  });

  it("returns exact citation identifiers and shows the student's captured records in status", async () => {
    const value = fixture();
    const service = new FileBackedMockStudentService(value.serviceRoot, value.statePath);
    const token = await login(service);

    const recorded = await service.execute(
      {
        kind: "ledger",
        operationId: "ledger-visible",
        entry: {
          kind: "fact",
          statement: "The median first response time is 18 minutes.",
          officialFactIds: ["median-wait"],
        },
      },
      token,
    );
    expect(recorded).toMatchObject({
      kind: "action",
      recorded: {
        kind: "ledger",
        ledgerEntryId: "ledger-ledger-visible",
        evidenceIds: ["evidence-ledger-visible-median-wait"],
      },
    });

    const status = await service.execute({ kind: "status" }, token);
    expect(status).toMatchObject({
      kind: "view",
      view: {
        capturedLedger: [{ id: "ledger-ledger-visible", officialFactIds: ["median-wait"] }],
        capturedEvidence: [
          {
            id: "evidence-ledger-visible-median-wait",
            officialFactId: "median-wait",
            sourceEventId: "event-8",
          },
        ],
        availableCollectionMethods: [{ id: "sample-audit" }],
      },
    });
  });

  it("removes an erroneous criterion from the working draft while retaining its action history", async () => {
    const value = fixture();
    const service = new FileBackedMockStudentService(value.serviceRoot, value.statePath, {
      interruptAfterCommit: new Set(["criterion-remove-wrong"]),
    });
    const token = await login(service);

    const created = await service.execute(
      {
        kind: "criterion",
        operationId: "criterion-wrong",
        criterion: {
          metric: "Median response time",
          baseline: "18 minutes",
          target: "25 minutes",
          targetDate: "2026-10-31T00:00:00.000Z",
          failureThreshold: "30 minutes",
        },
      },
      token,
    );
    expect(created).toMatchObject({
      recorded: { kind: "criterion", criterionId: "criterion-criterion-wrong" },
    });

    const removeRequest = {
      kind: "criterion-remove",
      operationId: "criterion-remove-wrong",
      criterionId: "criterion-criterion-wrong",
    } as const satisfies StudentServiceRequest;
    await expect(service.execute(removeRequest, token)).rejects.toThrow(/interrupted/i);
    const removed = await service.execute(removeRequest, token);
    expect(removed).toMatchObject({
      kind: "action",
      replayed: true,
      recorded: { kind: "criterion-removal", criterionId: "criterion-criterion-wrong" },
    });

    const status = await service.execute({ kind: "status" }, token);
    expect(status).toMatchObject({ kind: "view", view: { successCriteria: [] } });
    const saved = JSON.parse(
      fs.readFileSync(`${value.serviceRoot}/${value.statePath}`, "utf8"),
    ) as { operations: Record<string, unknown>; workingDraft: { successCriteria?: unknown[] } };
    expect(saved.workingDraft.successCriteria).toEqual([]);
    expect(saved.operations).toHaveProperty("criterion-wrong");
    expect(saved.operations).toHaveProperty("criterion-remove-wrong");
  });

  it("uses the same readiness report for status and submission preparation even with a bad draft item", async () => {
    const value = fixture();
    const damaged = structuredClone(value.draft) as SubmissionDraft;
    damaged.successCriteria[0]!.targetDate = "2026-09-18";
    value.state.workingDraft = damaged;
    fs.writeFileSync(
      `${value.serviceRoot}/${value.statePath}`,
      `${JSON.stringify(value.state, null, 2)}\n`,
      { mode: 0o600 },
    );
    const service = new FileBackedMockStudentService(value.serviceRoot, value.statePath);
    const token = await login(service);

    const status = await service.execute({ kind: "status" }, token);
    const preparation = await service.execute({ kind: "prepare-submission" }, token);
    expect(status.kind).toBe("view");
    expect(preparation.kind).toBe("preparation");
    if (status.kind !== "view" || preparation.kind !== "preparation") return;
    expect(status.view.readiness).toEqual(preparation.report);
    expect(status.view.successCriteria[0]).toMatchObject({
      criterionId: "criterion-1",
      targetDate: "2026-09-18",
      valid: false,
    });
    expect(status.view.requirements.map(({ id, status: requirementStatus }) => ({
      requirementId: id,
      status: requirementStatus,
    }))).toEqual(preparation.report.requirements);
    expect(preparation.report.requirements[0]?.status).toBe("addressed");
    expect(preparation.report.provenance.citedOfficialFactCount).toBeGreaterThan(0);
    expect(preparation.report.missing).toContainEqual({
      path: "successCriteria.0.targetDate",
      message: "Invalid datetime",
    });
  });
});
