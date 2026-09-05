import { spawn, execFile, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

import {
  FileBackedMockStudentService,
  MockServiceError,
  reopenMockAttempt,
} from "../src/mock-service.js";
import { writePendingSubmission } from "../src/pending-submission.js";
import type { StudentServiceRequest } from "../src/types.js";
import {
  createStudentFixture,
  PROTECTED_SERVICE_CANARY,
  type StudentFixture,
} from "./fixture.js";

const execFileAsync = promisify(execFile);
const roots: string[] = [];
const servers: http.Server[] = [];
const canaryProcesses: ChildProcess[] = [];

const routeKinds = new Map([
  ["/v1/student/assignment/resume", "resume"],
  ["/v1/student/assignment/status", "status"],
  ["/v1/student/checkpoint", "checkpoint"],
  ["/v1/student/submission/prepare", "prepare-submission"],
]);

interface RunningService {
  readonly origin: string;
  readonly requests: unknown[];
}

async function startService(
  value: StudentFixture,
  interruptAfterCommit: ReadonlySet<string> = new Set(),
): Promise<RunningService> {
  const client = new FileBackedMockStudentService(value.serviceRoot, value.statePath, {
    now: () => new Date("2026-09-04T16:00:00.000Z"),
    interruptAfterCommit,
  });
  const requests: unknown[] = [];
  const server = http.createServer((request, response) => {
    void (async () => {
      try {
        const chunks: Buffer[] = [];
        for await (const chunk of request) chunks.push(Buffer.from(chunk));
        const body = Buffer.concat(chunks).toString("utf8");
        const parsed =
          body === ""
            ? { kind: routeKinds.get(request.url ?? "") }
            : (JSON.parse(body) as unknown);
        requests.push(parsed);
        const authorization = request.headers.authorization;
        const token = authorization?.startsWith("Bearer ") ? authorization.slice(7) : undefined;
        const result = await client.execute(parsed as StudentServiceRequest, token);
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify(result));
      } catch (error) {
        response.writeHead(400, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            ...(error instanceof MockServiceError ? { code: error.code } : {}),
            error: error instanceof Error ? error.message : "request failed",
          }),
        );
      }
    })();
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("test server failed");
  return { origin: `http://127.0.0.1:${address.port}`, requests };
}

async function runCli(
  value: StudentFixture,
  service: RunningService,
  auditPath: string,
  command: string,
  flags: readonly string[] = [],
) {
  try {
    const result = await execFileAsync(
      process.execPath,
      [
        "--import",
        path.resolve("packages/student-cli/test/fixtures/audit-preload.mjs"),
        path.resolve("packages/student-cli/test/fixtures/cli-runner.mjs"),
        service.origin,
        command,
        ...flags,
      ],
      {
        cwd: value.root,
        env: {
          PATH: process.env.PATH,
          VOLTA_SIM_AUDIT_LOG: auditPath,
          PRIVATE_ENV_CANARY: "PRIVATE-ENV-CANARY",
        },
      },
    );
    return { stdout: result.stdout, stderr: result.stderr, exitCode: 0 };
  } catch (error) {
    const failed = error as { readonly code?: number | string; readonly stdout?: string; readonly stderr?: string };
    if (typeof failed.code !== "number") throw error;
    return {
      stdout: failed.stdout ?? "",
      stderr: failed.stderr ?? "",
      exitCode: failed.code,
    };
  }
}

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) => new Promise<void>((resolve) => server.close(() => resolve())),
    ),
  );
  for (const child of canaryProcesses.splice(0)) child.kill();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("student CLI subprocess journey", () => {
  it("completes discovery, reasoning, review, no-build submission, logout, and reopened resume without private leakage", async () => {
    const value = createStudentFixture();
    roots.push(value.root, value.serviceRoot);
    const service = await startService(value, new Set(["submit-1"]));
    const auditPath = path.join(value.serviceRoot, "student-audit.log");
    fs.mkdirSync(path.join(value.root, ".claude"));
    fs.writeFileSync(path.join(value.root, ".claude", "transcript.txt"), "AGENT-TRANSCRIPT-CANARY");
    fs.writeFileSync(path.join(value.root, ".zsh_history"), "SHELL-HISTORY-CANARY");
    fs.writeFileSync(path.join(value.root, "AGENTS.md"), "AGENT-CONFIG-CANARY");
    const parentCanary = path.join(path.dirname(value.root), `${path.basename(value.root)}-parent-canary`);
    roots.push(parentCanary);
    fs.writeFileSync(parentCanary, "PARENT-PATH-CANARY");
    canaryProcesses.push(
      spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)", "PROCESS-ARG-CANARY"], {
        stdio: "ignore",
      }),
    );

    const outputs: string[] = [];
    const invoke = async (command: string, flags: readonly string[] = []) => {
      const output = await runCli(value, service, auditPath, command, flags);
      outputs.push(output.stdout, output.stderr);
      return output;
    };

    await invoke("login", ["--operation-id", "login-1"]);
    await invoke("resume");
    const status = await invoke("status");
    expect(status.stdout).not.toMatch(/rating|score|quality|expected answer/i);
    await invoke("talk", [
      "--operation-id",
      "talk-1",
      "--persona",
      "library-manager",
      "--question",
      "What is the wait time?",
    ]);
    await invoke("evidence", [
      "--operation-id",
      "evidence-1",
      "--source",
      "desk-log",
      "--question",
      "What response time does the log show?",
    ]);
    const collection = await invoke("collect", [
      "--operation-id",
      "collect-1",
      "--method",
      "sample-audit",
      "--plan",
      "Review a bounded fictional sample.",
    ]);
    expect(collection.stdout).toContain('"sandboxWorkBlocked": false');
    await invoke("advance", [
      "--operation-id",
      "advance-1",
      "--days",
      "2",
      "--reason",
      "Wait for the sample.",
    ]);
    await invoke("ledger", [
      "--operation-id",
      "ledger-1",
      "--kind",
      "fact",
      "--statement",
      "The median first response time is 18 minutes.",
      "--fact-id",
      "median-wait",
    ]);
    const evidenceId = "evidence-ledger-1-median-wait";
    await invoke("decision", [
      "--operation-id",
      "decision-1",
      "--choice",
      "collect-more-evidence",
      "--rationale",
      "Accuracy is unknown, so measure it before building.",
      "--evidence-id",
      evidenceId,
      "--expected-evidence",
      "A bounded accuracy sample|Observe the next synthetic sample|Decide whether a routing aid is warranted",
      "--pivot-condition",
      "stop|Sampled accuracy declines|A faster response cannot reduce answer accuracy",
    ]);
    await invoke("estimate", [
      "--operation-id",
      "estimate-1",
      "--subject",
      "Observation time",
      "--low",
      "2",
      "--high",
      "4",
      "--unit",
      "hours",
      "--assumption",
      "The frozen log format remains available.",
      "--confidence",
      "0.6",
    ]);
    await invoke("requirement", [
      "--operation-id",
      "requirement-1",
      "--id",
      "patron-wait",
      "--status",
      "addressed",
      "--rationale",
      "The released log supplies the baseline.",
      "--evidence-id",
      evidenceId,
    ]);
    for (const competency of [
      "problem-viability",
      "evidence-sufficiency",
      "response-feasibility",
      "objective-success-criteria",
    ]) {
      await invoke("claim", [
        "--operation-id",
        `claim-${competency}`,
        "--competency",
        competency,
        "--rationale",
        `My evidence-led rationale for ${competency}.`,
        "--evidence-id",
        evidenceId,
      ]);
    }
    await invoke("criterion", [
      "--operation-id",
      "criterion-1",
      "--metric",
      "Median first response time with accurate answer",
      "--baseline",
      "18 minutes; accuracy baseline not yet available",
      "--target",
      "At most 12 minutes with no reduction in sampled accuracy",
      "--target-date",
      "2026-09-18T14:00:00.000Z",
      "--failure-threshold",
      "Stop if sampled answer accuracy declines at all",
    ]);
    const removedCriterion = await invoke("criterion-remove", [
      "--operation-id",
      "criterion-remove-1",
      "--id",
      "criterion-criterion-1",
    ]);
    expect(removedCriterion.exitCode).toBe(0);
    expect(removedCriterion.stdout).toContain('"kind": "criterion-removal"');
    await invoke("criterion", [
      "--operation-id",
      "criterion-2",
      "--metric",
      "Median first response time with accurate answer",
      "--baseline",
      "18 minutes; accuracy baseline not yet available",
      "--target",
      "At most 12 minutes with no reduction in sampled accuracy",
      "--target-date",
      "2026-09-18",
      "--failure-threshold",
      "Stop if sampled answer accuracy declines at all",
    ]);
    await invoke("calculation", [
      "--operation-id",
      "calculation-1",
      "--name",
      "Bounded observation cost",
      "--input",
      "observation-hours|4|hours|student estimate",
      "--input",
      "hourly-cost|75|CAD per hour|student assumption",
      "--operation",
      "product",
      "--input-name",
      "observation-hours",
      "--input-name",
      "hourly-cost",
      "--result",
      "300",
      "--result-unit",
      "CAD",
      "--rationale",
      "This bounds the cost of collecting the missing accuracy evidence.",
    ]);
    await invoke("draft", [
      "--operation-id",
      "draft-1",
      "--mode",
      "no-build",
      "--rationale",
      "Collect accuracy before deciding whether a build is warranted.",
      "--feasibility",
      "The bounded observation uses the frozen example data.",
      "--risk",
      "The small sample may not represent another period.",
      "--missing-data-plan",
      "Sample answer accuracy alongside wait time before deciding to build.",
      "--economic-rationale",
      "Estimate observation time only; do not invent savings.",
    ]);
    const checkpoint = await invoke("checkpoint");
    expect(checkpoint.stdout).toContain("What estimate would you make now");
    await invoke("review-request", [
      "--operation-id",
      "review-1",
      "--topic",
      "Check the proposed bounded observation.",
      "--choice",
      "continue",
    ]);
    const rejectedArtifact = await invoke("submit", [
      "--operation-id",
      "submit-with-no-build-artifact",
      "--artifact",
      "results/answer.md",
    ]);
    expect(rejectedArtifact.exitCode).toBe(1);
    expect(rejectedArtifact.stderr).toMatch(/no-build response cannot include an artifact/i);
    expect(
      service.requests.filter(
        (request) => typeof request === "object" && request !== null && "kind" in request && request.kind === "submit",
      ),
    ).toHaveLength(0);

    const interruptedSubmission = await invoke("submit", [
      "--operation-id",
      "submit-1",
    ]);
    expect(interruptedSubmission.exitCode).toBe(1);
    expect(interruptedSubmission.stderr).toMatch(/request is unavailable/i);
    expect(fs.existsSync(path.join(value.root, ".volta-sim/pending-submission.json"))).toBe(true);
    const committedState = JSON.parse(
      fs.readFileSync(path.join(value.serviceRoot, value.statePath), "utf8"),
    ) as StudentFixture["state"];
    expect(committedState.attempt.status).toBe("submitted");

    const submission = await invoke("submit", [
      "--operation-id",
      "submit-1",
    ]);
    expect(submission.exitCode).toBe(0);
    expect(submission.stdout).toContain('"accepted": true');
    expect(submission.stdout).toContain('"replayed": true');
    expect(fs.existsSync(path.join(value.root, ".volta-sim/pending-submission.json"))).toBe(false);
    const submitRequests = service.requests.filter(
      (request) => typeof request === "object" && request !== null && "kind" in request && request.kind === "submit",
    );
    expect(submitRequests).toHaveLength(2);
    expect(submitRequests[1]).toEqual(submitRequests[0]);
    await invoke("logout", ["--operation-id", "logout-1"]);

    await reopenMockAttempt(value.serviceRoot, value.statePath, "2026-09-05T13:00:00.000Z");
    await invoke("login", ["--operation-id", "login-2"]);
    const reopened = await invoke("resume");
    expect(reopened.stdout).toContain('"attemptNumber": 2');
    expect(reopened.stdout).toContain('"reopenedFromAttempt": 1');
    expect(reopened.stdout).toContain('"attemptHistory"');
    expect(reopened.stdout).toContain('"submissionDigest"');

    const combined = outputs.join("\n");
    for (const canary of [
      PROTECTED_SERVICE_CANARY,
      "AGENT-TRANSCRIPT-CANARY",
      "SHELL-HISTORY-CANARY",
      "AGENT-CONFIG-CANARY",
      "PRIVATE-ENV-CANARY",
      "PROCESS-ARG-CANARY",
      "PARENT-PATH-CANARY",
      "UNSELECTED-CANARY",
    ]) {
      expect(combined).not.toContain(canary);
      expect(JSON.stringify(service.requests)).not.toContain(canary);
    }
    const audit = fs.readFileSync(auditPath, "utf8");
    expect(audit).not.toContain(".claude");
    expect(audit).not.toContain(".zsh_history");
    expect(audit).not.toContain("AGENTS.md");
    expect(audit).not.toContain(parentCanary);
    expect(audit).not.toContain("unselected.txt");
    expect(audit).not.toContain("results/answer.md");
    expect(audit.match(/^network\t/gm)?.length).toBeGreaterThan(0);
    expect(audit).not.toContain("canary.invalid");
    expect(fs.readFileSync(path.join(value.root, ".gitignore"), "utf8")).toContain(".volta-sim/");
    expect(JSON.stringify(fs.readdirSync(value.root))).not.toContain(PROTECTED_SERVICE_CANARY);
  }, 30_000);

  it("returns a failing process result when the service rejects a pending submission", async () => {
    const value = createStudentFixture();
    roots.push(value.root, value.serviceRoot);
    const service = await startService(value);
    const auditPath = path.join(value.serviceRoot, "rejected-submission-audit.log");
    await runCli(value, service, auditPath, "login", ["--operation-id", "login-rejected"]);
    await writePendingSubmission(value.root, {
      kind: "submit",
      operationId: "submit-rejected",
      draft: { ...value.draft, assignmentId: "wrong-assignment", gitCommitSha: value.commitSha },
      artifacts: [],
      repository: {
        repositorySlug: "Volta-Labs-Inc/assignment-1",
        commitSha: value.commitSha,
        sessionIgnoreBlobId: value.sessionIgnoreBlobId,
        selectedBlobs: [],
      },
      mode: "no-build",
    });

    const result = await runCli(value, service, auditPath, "submit", [
      "--operation-id",
      "submit-rejected",
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain('"accepted": false');
    expect(fs.existsSync(path.join(value.root, ".volta-sim/pending-submission.json"))).toBe(false);
  });

  it("submits a selected text build whose bytes match the service-pinned blob", async () => {
    const value = createStudentFixture();
    roots.push(value.root, value.serviceRoot);
    const service = await startService(value);
    const auditPath = path.join(value.serviceRoot, "build-audit.log");
    await runCli(value, service, auditPath, "login", ["--operation-id", "login-build"]);
    const tokenSession = fs.readFileSync(path.join(value.root, value.sessionPath), "utf8");
    expect(tokenSession).not.toContain(PROTECTED_SERVICE_CANARY);
    const directService = new FileBackedMockStudentService(value.serviceRoot, value.statePath, {
      now: () => new Date("2026-09-04T16:00:00.000Z"),
    });
    const session = JSON.parse(tokenSession) as { token: string };
    for (const request of [
      {
        kind: "ledger" as const,
        operationId: "build-ledger",
        entry: {
          kind: "fact" as const,
          statement: "The median first response time is 18 minutes.",
          officialFactIds: ["median-wait"],
        },
      },
      {
        kind: "decision" as const,
        operationId: "build-decision",
        decision: {
          choice: "continue" as const,
          rationale: "A bounded local prototype can test the response.",
          supportingEvidenceIds: ["evidence-build-ledger-median-wait"],
          expectedEvidence: [
            {
              description: "Pilot accuracy observations",
              sourceOrMethod: "Bounded fictional pilot",
              decisionUse: "Decide whether to continue the build",
            },
          ],
          pivotOrStopConditions: [
            { action: "stop" as const, condition: "Accuracy declines", rationale: "Protect advice" },
          ],
        },
      },
      {
        kind: "estimate" as const,
        operationId: "build-estimate",
        estimate: {
          subject: "Prototype time",
          low: 2,
          high: 4,
          unit: "hours",
          assumptions: ["The frozen file remains available"],
          confidence: 0.6,
        },
      },
    ]) {
      await directService.execute(request, session.token);
    }
    for (const competencyId of [
      "problem-viability",
      "evidence-sufficiency",
      "response-feasibility",
      "objective-success-criteria",
    ] as const) {
      await directService.execute(
        {
          kind: "claim",
          operationId: `build-claim-${competencyId}`,
          competencyId,
          rationale: `Student rationale for ${competencyId}`,
          evidenceIds: ["evidence-build-ledger-median-wait"],
        },
        session.token,
      );
    }
    await directService.execute(
      {
        kind: "requirement",
        operationId: "build-requirement",
        requirementId: "patron-wait",
        status: "addressed",
        rationale: "The log supplies a baseline.",
        evidenceIds: ["evidence-build-ledger-median-wait"],
      },
      session.token,
    );
    await directService.execute(
      {
        kind: "criterion",
        operationId: "build-criterion",
        criterion: {
          metric: "Response time with accurate answer",
          baseline: "18 minutes; accuracy unknown",
          target: "12 minutes without lower sampled accuracy",
          targetDate: "2026-09-18T14:00:00.000Z",
          failureThreshold: "Stop if accuracy declines",
        },
      },
      session.token,
    );
    await directService.execute(
      {
        kind: "calculation",
        operationId: "build-calculation",
        calculation: {
          name: "Records reviewed",
          inputs: [{ name: "records", value: 20, unit: "records", source: "desk-log" }],
          formula: { operation: "sum", inputNames: ["records"] },
          result: { value: 20, unit: "records" },
          rationale: "Keep the sample explicit.",
        },
      },
      session.token,
    );
    await directService.execute(
      {
        kind: "draft",
        operationId: "build-draft",
        mode: "build",
        rationale: "Use a bounded text prototype.",
        feasibility: "The artifact is local text only.",
        risks: ["The sample is small."],
        missingDataPlan: "Measure answer accuracy during the pilot.",
        economicRationale: "Limit the experiment to four hours.",
      },
      session.token,
    );
    const result = await runCli(value, service, auditPath, "submit", [
      "--operation-id",
      "submit-build",
      "--artifact",
      "results/answer.md",
    ]);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain('"accepted": true');
    expect(JSON.stringify(service.requests)).toContain(value.blobId);
    expect(JSON.stringify(service.requests)).toContain("# Proposed observation");
  }, 20_000);
});

describe("student CLI privacy implementation", () => {
  it("contains no workspace enumeration, environment inspection, process inspection, shell, or GitHub token lookup", () => {
    const source = fs
      .readdirSync(path.resolve("packages/student-cli/src"))
      // The local server lock reads only its own private lock-owner directory.
      // The separate reachability check below keeps that code out of both CLIs.
      .filter((file) => file.endsWith(".ts") && file !== "state-lock.ts")
      .map((file) => fs.readFileSync(path.resolve("packages/student-cli/src", file), "utf8"))
      .join("\n");
    expect(source).not.toMatch(/\breaddir(?:Sync)?\b|\bopendir\b|process\.env|\/proc\//);
    expect(source).not.toMatch(/\.claude|\.cursor|\.codex|zsh_history|bash_history|gho_|github_token/i);
    expect(source).not.toMatch(/\bexecSync\(|\bspawn\(|\bshell\s*:/);
  });

  it("neither student entry point imports local-service process or lock inspection", () => {
    const root = path.resolve("packages/student-cli/src");
    const visited = new Set<string>();
    const visit = (file: string): void => {
      if (visited.has(file)) return;
      visited.add(file);
      const source = fs.readFileSync(file, "utf8");
      for (const match of source.matchAll(/(?:from\s*|import\s*)["'](\.[^"']+)\.js["']/g)) {
        visit(path.resolve(path.dirname(file), `${match[1]}.ts`));
      }
    };
    visit(path.join(root, "bin.ts"));
    visit(path.join(root, "local-bin.ts"));
    expect(visited.has(path.join(root, "state-lock.ts"))).toBe(false);
    for (const file of visited) {
      expect(fs.readFileSync(file, "utf8")).not.toMatch(/process\.kill|\breaddir(?:Sync)?\b|\bopendir\b/);
    }
  });
});
