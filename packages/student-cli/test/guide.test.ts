import fs from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

import { runCli } from "../src/cli.js";
import {
  agentInstructionsMarkdown,
  missingOperationIdMessage,
  missingSessionMessage,
  readinessNextSteps,
  studentGuideMarkdown,
} from "../src/guide.js";
import { localCommandName } from "../src/local-cli.js";
import { FileBackedMockStudentService } from "../src/mock-service.js";
import type { StudentServiceClient } from "../src/types.js";
import { createStudentFixture } from "./fixture.js";

const roots: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

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

/** Every path the readiness report can list as missing on a fresh attempt. */
const FRESH_MISSING_PATHS = [
  "ledger",
  "evidence",
  "decision",
  "estimates",
  "missingDataPlan",
  "requirementAssessments",
  "competencyClaims",
  "successCriteria",
  "calculations",
  "economicRationale",
  "responsePlan",
];

describe("student onboarding guide", () => {
  it("explains the simulation without any case truth or judgment", () => {
    const guide = studentGuideMarkdown();
    for (const heading of [
      "# Start here",
      "## What you are being asked to do",
      "## What is in this folder",
      "## How the simulation works",
      "## Your first three commands",
      "## Operation IDs",
      "## What \"not available\" means",
      "## Saving your work",
      "## What is recorded",
    ]) {
      expect(guide).toContain(heading);
    }
    for (const outcome of ["continue", "pivot", "buy", "collect more evidence", "stop"]) {
      expect(guide).toContain(`**${outcome}**`);
    }
    expect(guide).toContain("volta-sim login --operation-id login-1");
    expect(guide).toContain("volta-sim status");
    expect(guide).toContain("Never commit them");
    expect(guide).not.toMatch(/expected answer|correct answer is|score/i);
  });

  it("uses the launcher's command form and note when supplied", () => {
    const guide = studentGuideMarkdown({
      commandName: "node local-bin.js --manifest .volta-sim/local-pilot.json",
      launcherNote: "Local pilot only.",
    });
    expect(guide).toContain("> Local pilot only.");
    expect(guide).toContain(
      "node local-bin.js --manifest .volta-sim/local-pilot.json login --operation-id login-1",
    );
    expect(guide).not.toContain("volta-sim login");
  });

  it("keeps a coding agent in the assistant's seat", () => {
    const instructions = agentInstructionsMarkdown();
    expect(instructions).toContain("Their judgment is what is being assessed, not yours");
    const neverRun = /Never run (.*) unless the student has confirmed/u.exec(instructions)?.[1] ?? "";
    for (const command of ["decision", "claim", "draft", "requirement", "criterion", "submit"]) {
      expect(neverRun, command).toContain(`\`${command}\``);
    }
    expect(instructions).toContain("That information is not available in this simulation");
    expect(instructions).toContain("Never commit, read aloud, copy, or transmit anything under `.volta-sim/`");
    expect(instructions).toContain("volta-sim status");
    expect(instructions).toContain("START-HERE.md");
    expect(instructions).not.toMatch(/expected answer|correct answer is|score/i);
  });

  it("maps every fresh-attempt readiness gap to a command in working order", () => {
    const steps = readinessNextSteps({
      missing: FRESH_MISSING_PATHS.map((path) => ({ path, message: "Required" })),
      requirements: [{ requirementId: "patron-wait", status: "missing" }],
      artifactRequirement: { required: false, selected: true },
    });
    const commandsInOrder = steps.map((step) => /: volta-sim (\S+)/u.exec(step)?.[1]);
    expect(commandsInOrder).toEqual([
      "ledger",
      "ledger",
      "estimate",
      "calculation",
      "decision",
      "criterion",
      "draft",
      "draft",
      "draft",
      "claim",
      "requirement",
    ]);
    expect(steps.every((step) => step.includes("--operation-id"))).toBe(true);
    expect(steps.at(-1)).toContain("--id patron-wait");
  });

  it("names the artifact rule for build responses and the submit command when complete", () => {
    expect(
      readinessNextSteps({
        missing: [],
        artifactRequirement: { required: true, selected: false },
      }),
    ).toEqual([expect.stringContaining("submit --operation-id <your-id> --artifact")]);
    expect(readinessNextSteps({ missing: [] })).toEqual([
      expect.stringContaining("Everything required is recorded"),
    ]);
  });

  it("falls back to the service message for an unrecognized gap", () => {
    const [step] = readinessNextSteps({
      missing: [{ path: "assignmentIdentity", message: "The submission must use the trusted assignment" }],
    });
    expect(step).toContain("assignmentIdentity");
    expect(step).toContain("The submission must use the trusted assignment");
  });
});

describe("local pilot command name", () => {
  it("names the running script so a pasted command actually resolves", () => {
    expect(localCommandName("/tmp/harness/packages/student-cli/dist/local-bin.js")).toBe(
      "node '/tmp/harness/packages/student-cli/dist/local-bin.js' --manifest .volta-sim/local-pilot.json",
    );
    expect(localCommandName("/tmp/it's/local-bin.js")).toContain(`'/tmp/it'"'"'s/local-bin.js'`);
    expect(localCommandName("")).toBe("volta-sim-local --manifest .volta-sim/local-pilot.json");
  });
});

describe("first-contact CLI messages", () => {
  it("prints the guide without reading a session or contacting the service", async () => {
    const execute = vi.fn<StudentServiceClient["execute"]>();
    const open = vi.spyOn(fs.promises, "open");
    const output = io();
    await expect(runCli(["guide"], { client: { execute }, io: output.value })).resolves.toBe(0);
    expect(output.stdout.join("\n")).toContain("# Start here");
    expect(execute).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();

    const help = io();
    await expect(runCli(["--help"], { client: { execute }, io: help.value })).resolves.toBe(0);
    expect(help.stdout.join("\n")).toContain("New here? Run volta-sim guide");
    expect(help.stdout.join("\n")).toContain("guide              Explain how a simulation works");
  });

  it("tells a signed-out student the exact login command", async () => {
    const fixture = createStudentFixture();
    roots.push(fixture.root, fixture.serviceRoot);
    const execute = vi.fn<StudentServiceClient["execute"]>();
    const output = io();
    await expect(
      runCli(["status"], { assignmentRoot: fixture.root, client: { execute }, io: output.value }),
    ).resolves.toBe(1);
    expect(output.stderr.join("\n")).toBe(missingSessionMessage());
    expect(output.stderr.join("\n")).toContain("volta-sim login --operation-id login-1");
    expect(execute).not.toHaveBeenCalled();
  });

  it("explains operation IDs when login or an action omits one", async () => {
    const fixture = createStudentFixture();
    roots.push(fixture.root, fixture.serviceRoot);
    const execute = vi.fn<StudentServiceClient["execute"]>();
    const login = io();
    await expect(
      runCli(["login"], { assignmentRoot: fixture.root, client: { execute }, io: login.value }),
    ).resolves.toBe(1);
    expect(login.stderr.join("\n")).toBe(missingOperationIdMessage("login"));
    expect(login.stderr.join("\n")).toContain("volta-sim login --operation-id login-1");
    expect(login.stderr.join("\n")).toMatch(/retry/u);
    expect(execute).not.toHaveBeenCalled();

    const local = io();
    await expect(
      runCli(["login"], {
        assignmentRoot: fixture.root,
        client: { execute },
        commandName: "volta-sim-local --manifest .volta-sim/local-pilot.json",
        io: local.value,
      }),
    ).resolves.toBe(1);
    expect(local.stderr.join("\n")).toContain(
      "volta-sim-local --manifest .volta-sim/local-pilot.json login --operation-id login-1",
    );
  });

  it("prints next steps after login and inside the status readback", async () => {
    const fixture = createStudentFixture();
    roots.push(fixture.root, fixture.serviceRoot);
    const service = new FileBackedMockStudentService(fixture.serviceRoot, fixture.statePath);
    const login = io();
    await expect(
      runCli(["login", "--operation-id", "login-guide"], {
        assignmentRoot: fixture.root,
        client: service,
        io: login.value,
      }),
    ).resolves.toBe(0);
    expect(login.stdout[0]).toContain("Signed in for assignment");
    expect(login.stdout.join("\n")).toContain("Next: run volta-sim status");
    expect(login.stdout.join("\n")).toContain("START-HERE.md");

    const status = io();
    await expect(
      runCli(["status"], { assignmentRoot: fixture.root, client: service, io: status.value }),
    ).resolves.toBe(0);
    const parsed = JSON.parse(status.stdout.join("\n")) as {
      kind: string;
      view: { readiness: { missing: readonly { path: string }[] } };
      nextSteps: readonly string[];
    };
    expect(parsed.kind).toBe("view");
    expect(parsed.nextSteps.length).toBeGreaterThan(0);
    const missingRoots = new Set(
      parsed.view.readiness.missing.map(({ path }) => path.split(".")[0] ?? path),
    );
    expect(missingRoots.size).toBeGreaterThan(0);
    for (const root of missingRoots) {
      expect(findStepFor(parsed.nextSteps, root), root).toBeDefined();
    }
  });

  it("stops asking for a submission once the attempt is submitted", async () => {
    const fixture = createStudentFixture();
    roots.push(fixture.root, fixture.serviceRoot);
    const submittedView = {
      kind: "view" as const,
      view: {
        ...(await new FileBackedMockStudentService(fixture.serviceRoot, fixture.statePath).execute(
          { kind: "status" },
          (await loginToken(fixture)),
        ).then((response) => (response.kind === "view" ? response.view : undefined)))!,
        attemptStatus: "submitted" as const,
        attemptNumber: 1,
      },
    };
    const execute = vi.fn<StudentServiceClient["execute"]>(async (request) =>
      request.kind === "status" ? submittedView : { kind: "checkpoint", prompts: [] },
    );
    const output = io();
    await expect(
      runCli(["status"], { assignmentRoot: fixture.root, client: { execute }, io: output.value }),
    ).resolves.toBe(0);
    const parsed = JSON.parse(output.stdout.join("\n")) as { nextSteps: readonly string[] };
    expect(parsed.nextSteps.join("\n")).toContain("Attempt 1 is submitted and frozen");
    expect(parsed.nextSteps.join("\n")).not.toContain("submit --operation-id");
  });
});

async function loginToken(fixture: ReturnType<typeof createStudentFixture>): Promise<string> {
  const service = new FileBackedMockStudentService(fixture.serviceRoot, fixture.statePath);
  const login = io();
  await runCli(["login", "--operation-id", "login-token"], {
    assignmentRoot: fixture.root,
    client: service,
    io: login.value,
  });
  const session = JSON.parse(fs.readFileSync(`${fixture.root}/${fixture.sessionPath}`, "utf8")) as {
    token: string;
  };
  return session.token;
}

const ROOT_TO_COMMAND: Readonly<Record<string, string>> = {
  ledger: "volta-sim ledger",
  evidence: "volta-sim ledger",
  decision: "volta-sim decision",
  estimates: "volta-sim estimate",
  missingDataPlan: "volta-sim draft",
  requirementAssessments: "volta-sim requirement",
  competencyClaims: "volta-sim claim",
  successCriteria: "volta-sim criterion",
  calculations: "volta-sim calculation",
  economicRationale: "volta-sim draft",
  responsePlan: "volta-sim draft",
  evidenceReferences: "volta-sim status",
};

function findStepFor(nextSteps: readonly string[], root: string): string | undefined {
  const command = ROOT_TO_COMMAND[root];
  if (command === undefined) return undefined;
  return nextSteps.find((step) => step.includes(command));
}
