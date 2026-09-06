import { execFileSync, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { clearTimeout, setTimeout } from "node:timers";
import { fileURLToPath, URL } from "node:url";

import { sha256Digest } from "../packages/core/dist/canonical.js";
import { createCaseVersionDigests } from "../packages/core/dist/case-version.js";
import { publishCase } from "../packages/core/dist/published-case.js";
import { nonAssessedLibraryRoutingCase } from "../packages/core/examples/non-assessed-library-routing.ts";
import {
  AGENT_INSTRUCTIONS_FILE,
  CLAUDE_POINTER_FILE,
  START_HERE_FILE,
  agentInstructionsMarkdown,
  studentGuideMarkdown,
} from "../packages/student-cli/dist/guide.js";
import { createLocalPilotManifest } from "../packages/student-cli/dist/local-cli.js";
import { startLocalStudentHttpService } from "../packages/student-cli/dist/local-http-service.js";
import { writeControlJson } from "../packages/student-cli/dist/control-files.js";

const repositoryRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const statePath = "mock-service.json";
const publicExampleProtectedCanary = "LOCAL-PILOT-PUBLIC-EXAMPLE-PROTECTED-CANARY";

function parseArguments(argv) {
  let requestedRoot;
  for (let index = 0; index < argv.length; index += 2) {
    if (argv[index] !== "--root" || argv[index + 1] === undefined) {
      throw new Error("Use npm run pilot:local or add only --root <empty-directory>");
    }
    if (requestedRoot !== undefined) throw new Error("Provide --root only once");
    requestedRoot = path.resolve(argv[index + 1]);
  }
  return { requestedRoot };
}

function git(root, args) {
  return execFileSync("git", ["-C", root, ...args], {
    encoding: "utf8",
    env: {
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_TERMINAL_PROMPT: "0",
      LC_ALL: "C",
      PATH: process.env.PATH ?? "",
    },
  }).trim();
}

function markdownList(values) {
  return values.map((value) => `- ${value}`).join("\n");
}

async function preparePilotRoot(requestedRoot) {
  if (requestedRoot === undefined) {
    const base = path.join(repositoryRoot, ".private", "local-pilots");
    await fs.promises.mkdir(base, { mode: 0o700, recursive: true });
    return fs.promises.mkdtemp(path.join(base, "pilot-"));
  }
  const status = await fs.promises.lstat(requestedRoot).catch((error) => {
    if (error?.code === "ENOENT") return undefined;
    throw error;
  });
  if (status === undefined) {
    await fs.promises.mkdir(requestedRoot, { mode: 0o700, recursive: false });
  } else if (!status.isDirectory() || status.isSymbolicLink()) {
    throw new Error("The local pilot root must be an empty directory, not a file or link");
  }
  if ((await fs.promises.readdir(requestedRoot)).length !== 0) {
    throw new Error("The local pilot root must be empty");
  }
  await fs.promises.chmod(requestedRoot, 0o700);
  return fs.promises.realpath(requestedRoot);
}

async function createAssignment(pilotRoot) {
  const assignmentId = `local-public-${randomBytes(6).toString("hex")}`;
  const assignmentRoot = path.join(pilotRoot, "assignment");
  const serviceRoot = path.join(pilotRoot, "service");
  await fs.promises.mkdir(path.join(assignmentRoot, "results"), {
    mode: 0o700,
    recursive: true,
  });
  await fs.promises.mkdir(serviceRoot, { mode: 0o700 });

  const visible = nonAssessedLibraryRoutingCase.visible;
  const localBin = path.join(repositoryRoot, "packages", "student-cli", "dist", "local-bin.js");
  const studentCommand = `node ${shellQuote(localBin)} --manifest .volta-sim/local-pilot.json`;
  const guide = studentGuideMarkdown({
    commandName: studentCommand,
    launcherNote:
      "This is a local, public, non-assessed pilot. Keep the terminal that printed this folder's path open: it runs the service behind every command. If a command fails to connect, that terminal has been closed and a new pilot must be started. The commands below are written out in full so they can be copied as-is.",
  });
  const agentInstructions = agentInstructionsMarkdown({ commandName: studentCommand });
  const people = visible.personas.map(
    ({ id, name, role, studentBrief }) => `**${name}** (${role}), persona ID \`${id}\`: ${studentBrief}`,
  );
  const sources = visible.evidenceSources.map(
    ({ id, title, studentBrief }) => `**${title}**, source ID \`${id}\`: ${studentBrief}`,
  );
  const readme = `# ${visible.title}\n\n> New to simulations? Read [${START_HERE_FILE}](./${START_HERE_FILE}) first.\n\n${visible.brief}\n\nThis scenario is simulated. Nothing here touches a real organisation, person, or system.\n\n## Constraints\n\n${markdownList(visible.constraints)}\n\n## Unacceptable outcomes\n\n${markdownList(visible.unacceptableOutcomes)}\n\n## Possible response families\n\n${markdownList(visible.nonExhaustiveResponseFamilies)}\n\n## Who and what you can ask\n\nEach only answers what was authored for this case. When every question to a source comes back with no answer, you have probably exhausted it; record what remains unknown.\n\n${markdownList(people)}\n${markdownList(sources)}\n`;
  const method = `# Evaluation prompts\n\nEach heading is one competency. Defend it with the command shown, using the exact competency ID.\n\n${visible.competencies
    .map(({ id, title, studentPrompt }) => `## ${title}\n\nCompetency ID: \`${id}\` (record with \`claim --competency ${id}\`)\n\n${studentPrompt}`)
    .join("\n\n")}\n`;
  await Promise.all([
    fs.promises.writeFile(path.join(assignmentRoot, "README.md"), readme, "utf8"),
    fs.promises.writeFile(path.join(assignmentRoot, START_HERE_FILE), guide, "utf8"),
    fs.promises.writeFile(path.join(assignmentRoot, AGENT_INSTRUCTIONS_FILE), agentInstructions, "utf8"),
    fs.promises.writeFile(path.join(assignmentRoot, "method.md"), method, "utf8"),
    fs.promises.writeFile(
      path.join(assignmentRoot, "requirements.json"),
      `${JSON.stringify(visible.requirements, null, 2)}\n`,
      "utf8",
    ),
    fs.promises.writeFile(
      path.join(assignmentRoot, "results", "response.md"),
      "# Working notes\n\nThis file is optional. Your reasoning is recorded through the student command, not here.\n\nUse this folder for your own working. If your response is a build or pilot, commit the file you want reviewed and select it with `submit --artifact results/<file>`. A no-build response submits no file.\n",
      "utf8",
    ),
    fs.promises.writeFile(path.join(assignmentRoot, ".gitignore"), ".volta-sim/\n", "utf8"),
  ]);

  // Claude Code reads CLAUDE.md; a relative symlink keeps it identical to AGENTS.md
  // for every other agent without a second copy that could drift.
  await fs.promises.symlink(AGENT_INSTRUCTIONS_FILE, path.join(assignmentRoot, CLAUDE_POINTER_FILE));

  git(assignmentRoot, ["init", "--initial-branch=main"]);
  const repositorySlug = `Volta-Labs-Inc/${assignmentId}`;
  git(assignmentRoot, ["remote", "add", "origin", `https://github.com/${repositorySlug}.git`]);
  git(assignmentRoot, [
    "add",
    ".gitignore",
    "README.md",
    START_HERE_FILE,
    AGENT_INSTRUCTIONS_FILE,
    CLAUDE_POINTER_FILE,
    "method.md",
    "requirements.json",
    "results/response.md",
  ]);
  git(assignmentRoot, [
    "-c",
    "user.name=Volta Local Pilot",
    "-c",
    "user.email=local-pilot@example.invalid",
    "commit",
    "-m",
    "Start public non-assessed simulation",
  ]);
  const commitSha = git(assignmentRoot, ["rev-parse", "HEAD"]);
  const sessionIgnoreBlobId = git(assignmentRoot, ["rev-parse", "HEAD:.gitignore"]);
  const responseBlobId = git(assignmentRoot, ["rev-parse", "HEAD:results/response.md"]);

  const source = JSON.parse(JSON.stringify(nonAssessedLibraryRoutingCase));
  // This synthetic protected marker belongs only to the sibling service state. The
  // process proof fails if any future launcher copies protected material to students.
  source.protected.authoredRisks.push(publicExampleProtectedCanary);
  const digests = createCaseVersionDigests(source);
  const receiptContent = {
    kind: "validated-case-import",
    source,
    recordedVisibleBundleDigest: digests.visibleBundleDigest,
    recordedProtectedPackageDigest: digests.protectedPackageDigest,
  };
  const publishedCase = publishCase({
    ...receiptContent,
    validationDigest: sha256Digest(receiptContent),
  });
  const now = new Date().toISOString();
  await writeControlJson(serviceRoot, statePath, {
    version: 1,
    assignmentId,
    studentGithubUserId: "12345",
    attempt: {
      assignmentId,
      studentGithubUserId: "12345",
      caseVersionDigest: publishedCase.digests.caseVersionDigest,
      attemptNumber: 1,
      openedAt: now,
      status: "active",
    },
    attemptHistory: [],
    submissionContext: {
      publishedCase,
      trustedReleasedState: {
        assignmentId,
        attemptNumber: 1,
        caseVersionDigest: publishedCase.digests.caseVersionDigest,
        currentEventSequence: 0,
        events: [],
      },
    },
    expectedRepository: {
      slug: repositorySlug,
      commitSha,
      sessionIgnoreBlobId,
      selectedBlobs: { "results/response.md": responseBlobId },
    },
    workingDraft: {},
    stage: "discovery",
    simulatedAt: now,
    scriptedActions: [],
    useAuthoredRoutes: true,
    events: [],
    providerProvenance: [],
    reviewRequests: [],
    operations: {},
    loginOperations: {},
  });
  return { assignmentId, assignmentRoot, serviceRoot };
}

function shellQuote(value) {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function waitForStaffReady(child) {
  return new Promise((resolve, reject) => {
    let output = "";
    const timer = setTimeout(() => {
      reject(new Error(`The staff workbench did not start. ${output.trim()}`));
    }, 15_000);
    const inspect = (chunk) => {
      output += String(chunk);
      const match = /Staff workbench connected local student state: (http:\/\/127\.0\.0\.1:\d+)/u.exec(
        output,
      );
      if (match === null) return;
      clearTimeout(timer);
      child.stdout.off("data", inspect);
      resolve(match[1]);
    };
    child.stdout.on("data", inspect);
    child.stderr.on("data", (chunk) => {
      output += String(chunk);
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      reject(
        new Error(
          `The staff workbench exited during startup (${String(code)}/${String(signal)}). ${output.trim()}`,
        ),
      );
    });
  });
}

function stopChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    child.once("exit", () => resolve());
    child.kill("SIGTERM");
  });
}

async function run() {
  const { requestedRoot } = parseArguments(process.argv.slice(2));
  const pilotRoot = await preparePilotRoot(requestedRoot);
  const assignment = await createAssignment(pilotRoot);
  let studentService;
  let staffProcess;
  try {
    studentService = await startLocalStudentHttpService({
      serviceStateRoot: assignment.serviceRoot,
      statePath,
      assignmentRoot: assignment.assignmentRoot,
    });
    const manifest = createLocalPilotManifest({
      assignmentId: assignment.assignmentId,
      assignmentRoot: assignment.assignmentRoot,
      serviceOrigin: studentService.origin,
      issuedAt: new Date().toISOString(),
      nonce: randomBytes(16).toString("hex"),
    });
    const manifestPath = path.join(assignment.assignmentRoot, ".volta-sim", "local-pilot.json");
    await fs.promises.mkdir(path.dirname(manifestPath), { mode: 0o700 });
    await fs.promises.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    const staffStore = path.join(pilotRoot, "staff-operations.json");
    staffProcess = spawn(process.execPath, [path.join(repositoryRoot, "packages/staff-dashboard/scripts/serve.mjs")], {
      cwd: repositoryRoot,
      env: {
        PATH: process.env.PATH ?? "",
        STAFF_DASHBOARD_PORT: "0",
        STAFF_DASHBOARD_STORE_FILE: staffStore,
        STAFF_DASHBOARD_STUDENT_STATE_ROOT: assignment.serviceRoot,
        STAFF_DASHBOARD_STUDENT_STATE_PATH: statePath,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const staffOrigin = await waitForStaffReady(staffProcess);
    const localBin = path.join(repositoryRoot, "packages", "student-cli", "dist", "local-bin.js");
    const studentPrefix = `cd ${shellQuote(assignment.assignmentRoot)} && node ${shellQuote(localBin)} --manifest .volta-sim/local-pilot.json`;
    process.stdout.write("Local pilot ready\n");
    process.stdout.write(`Assignment checkout: ${assignment.assignmentRoot}\n`);
    process.stdout.write(`Student guide: ${path.join(assignment.assignmentRoot, START_HERE_FILE)}\n`);
    process.stdout.write(`Agent instructions: ${path.join(assignment.assignmentRoot, AGENT_INSTRUCTIONS_FILE)} (${CLAUDE_POINTER_FILE} links to it)\n`);
    process.stdout.write(`Student manifest: ${manifestPath}\n`);
    process.stdout.write(`Student service: ${studentService.origin}\n`);
    process.stdout.write(`Staff workbench: ${staffOrigin}\n`);
    process.stdout.write("Student CLI: volta-sim-local (local-only generated manifest)\n");
    process.stdout.write(`Student command: ${studentPrefix} --help\n`);
    process.stdout.write(`Student login: ${studentPrefix} login --operation-id local-login-1\n`);
    process.stdout.write(`Student status: ${studentPrefix} status\n`);
    process.stdout.write(`Staff command: open ${shellQuote(staffOrigin)}\n`);
    process.stdout.write("Press Ctrl-C to stop both local services. The isolated pilot files will remain.\n");

    await new Promise((resolve, reject) => {
      const stop = () => resolve();
      process.once("SIGINT", stop);
      process.once("SIGTERM", stop);
      staffProcess.once("exit", (code, signal) => {
        reject(
          new Error(
            `The staff workbench stopped unexpectedly (${String(code)}/${String(signal)})`,
          ),
        );
      });
    });
  } finally {
    await Promise.allSettled([
      studentService?.close(),
      staffProcess === undefined ? Promise.resolve() : stopChild(staffProcess),
    ]);
  }
  process.stdout.write("Local pilot stopped cleanly\n");
}

try {
  await run();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : "The local pilot failed"}\n`);
  process.exitCode = 1;
}
