/* global fetch */
import { execFile, execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { clearTimeout, setTimeout } from "node:timers";
import { promisify } from "node:util";

import { afterEach, expect, test } from "vitest";

const execFileAsync = promisify(execFile);
const roots = [];
const processes = [];
const protectedMarkers = [
  "LOCAL-PILOT-PUBLIC-EXAMPLE-PROTECTED-CANARY",
  "The synthetic desk log shows a median first response time of 18 minutes.",
];

function waitForOutput(child, output, pattern, timeoutMs = 30_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timed out waiting for ${String(pattern)}. Output:\n${output.value}`));
    }, timeoutMs);
    const inspect = () => {
      const match = pattern.exec(output.value);
      if (match === null) return;
      clearTimeout(timer);
      child.stdout.off("data", onData);
      resolve(match);
    };
    const onData = () => inspect();
    child.stdout.on("data", onData);
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      reject(
        new Error(
          `Local pilot exited before it was ready (${String(code)}/${String(signal)}). Output:\n${output.value}`,
        ),
      );
    });
    inspect();
  });
}

async function runLocalStudent(assignmentRoot, manifestPath, args) {
  return execFileAsync(
    process.execPath,
    [
      path.resolve("packages/student-cli/dist/local-bin.js"),
      "--manifest",
      manifestPath,
      ...args,
    ],
    { cwd: assignmentRoot, env: { PATH: process.env.PATH } },
  );
}

function workingFileText(root) {
  const values = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === ".git") continue;
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(target);
      else if (entry.isFile()) values.push(fs.readFileSync(target).toString("utf8"));
    }
  };
  visit(root);
  return values.join("\n");
}

async function reachableGitText(root) {
  const [{ stdout: listed }, { stdout: refs }] = await Promise.all([
    execFileAsync("git", ["-C", root, "rev-list", "--objects", "--all"]),
    execFileAsync("git", ["-C", root, "for-each-ref", "--format=%(refname) %(objectname)"]),
  ]);
  const objectIds = [...new Set(listed.split("\n").map((line) => line.split(" ")[0]).filter(Boolean))];
  const blobs = [];
  for (const objectId of objectIds) {
    const { stdout: type } = await execFileAsync("git", ["-C", root, "cat-file", "-t", objectId]);
    if (type.trim() !== "blob") continue;
    const { stdout: content } = await execFileAsync("git", ["-C", root, "cat-file", "blob", objectId]);
    blobs.push(content);
  }
  return `${refs}\n${blobs.join("\n")}`;
}

afterEach(async () => {
  for (const child of processes.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGTERM");
      await new Promise((resolve) => child.once("exit", resolve));
    }
  }
  for (const root of roots.splice(0)) fs.rmSync(root, { force: true, recursive: true });
});

test(
  "one root command starts a blank connected pilot and stops both services cleanly",
  async () => {
    const pilotRoot = fs.mkdtempSync(path.join(os.tmpdir(), "volta-local-pilot-process-"));
    roots.push(pilotRoot);
    const rootPackage = JSON.parse(fs.readFileSync(path.resolve("package.json"), "utf8"));
    expect(rootPackage.scripts["pilot:local"]).toBe(
      "npm run build --silent && node scripts/local-pilot.mjs",
    );
    const child = spawn(
      process.execPath,
      [path.resolve("scripts/local-pilot.mjs"), "--root", pilotRoot],
      {
        cwd: path.resolve("."),
        env: { PATH: process.env.PATH },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    processes.push(child);
    const output = { value: "" };
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      output.value += chunk;
    });
    child.stderr.on("data", (chunk) => {
      output.value += chunk;
    });

    await waitForOutput(child, output, /Press Ctrl-C to stop both local services/u);
    const assignmentRoot = /Assignment checkout: (.+)/u.exec(output.value)?.[1]?.trim();
    const manifestPath = /Student manifest: (.+)/u.exec(output.value)?.[1]?.trim();
    const studentOrigin = /Student service: (http:\/\/127\.0\.0\.1:\d+)/u.exec(
      output.value,
    )?.[1];
    const staffOrigin = /Staff workbench: (http:\/\/127\.0\.0\.1:\d+)/u.exec(
      output.value,
    )?.[1];
    const resolvedPilotRoot = fs.realpathSync(pilotRoot);
    expect({ assignmentRoot, manifestPath, staffOrigin, studentOrigin }).toMatchObject({
      assignmentRoot: path.join(resolvedPilotRoot, "assignment"),
      manifestPath: path.join(
        resolvedPilotRoot,
        "assignment",
        ".volta-sim",
        "local-pilot.json",
      ),
    });
    expect(output.value).toContain("Student command:");
    expect(output.value).toContain("Staff command:");
    expect(output.value).toContain("volta-sim-local");
    expect(studentOrigin).toBeDefined();
    expect(staffOrigin).toBeDefined();

    const assignmentFiles = fs.readdirSync(assignmentRoot);
    expect(assignmentFiles).toEqual(
      expect.arrayContaining([
        ".git",
        ".gitignore",
        ".volta-sim",
        "README.md",
        "START-HERE.md",
        "method.md",
        "results",
      ]),
    );
    expect(output.value).toContain(`Student guide: ${path.join(assignmentRoot, "START-HERE.md")}`);
    const startHere = fs.readFileSync(path.join(assignmentRoot, "START-HERE.md"), "utf8");
    expect(startHere).toContain("# Start here");
    expect(startHere).toContain("--manifest .volta-sim/local-pilot.json login --operation-id login-1");
    expect(fs.readFileSync(path.join(assignmentRoot, "README.md"), "utf8")).toContain("START-HERE.md");
    const committedTree = execFileSync("git", ["-C", assignmentRoot, "ls-tree", "HEAD"], {
      encoding: "utf8",
    });
    expect(committedTree).toMatch(/100644 blob [a-f0-9]+\tSTART-HERE\.md/u);
    expect(committedTree).toMatch(/100644 blob [a-f0-9]+\tAGENTS\.md/u);
    expect(committedTree).toMatch(/120000 blob [a-f0-9]+\tCLAUDE\.md/u);
    expect(fs.lstatSync(path.join(assignmentRoot, "CLAUDE.md")).isSymbolicLink()).toBe(true);
    expect(fs.readlinkSync(path.join(assignmentRoot, "CLAUDE.md"))).toBe("AGENTS.md");
    const agentInstructions = fs.readFileSync(path.join(assignmentRoot, "CLAUDE.md"), "utf8");
    expect(agentInstructions).toBe(fs.readFileSync(path.join(assignmentRoot, "AGENTS.md"), "utf8"));
    expect(agentInstructions).toContain("# Agent instructions for this simulation");
    expect(agentInstructions).toContain("--manifest .volta-sim/local-pilot.json status");
    expect(assignmentFiles).not.toEqual(
      expect.arrayContaining(["staff", "private", "calibrations", "sanitized"]),
    );

    const help = await runLocalStudent(assignmentRoot, manifestPath, ["--help"]);
    expect(help.stdout).toContain("login              Pair this checkout");
    const login = await runLocalStudent(assignmentRoot, manifestPath, [
      "login",
      "--operation-id",
      "pilot-login",
    ]);
    expect(login.stdout).toContain("Signed in for assignment");
    const status = await runLocalStudent(assignmentRoot, manifestPath, ["status"]);
    const studentView = JSON.parse(status.stdout).view;
    expect(studentView).toMatchObject({
      attemptNumber: 1,
      attemptStatus: "active",
      pendingReview: false,
      recentEvents: [],
      capturedEvidence: [],
      capturedLedger: [],
    });
    expect(studentView.baseReadiness.missing.map(({ path: missingPath }) => missingPath)).not.toContain(
      "studentGithubUserId",
    );

    const serviceState = fs.readFileSync(
      path.join(resolvedPilotRoot, "service", "mock-service.json"),
      "utf8",
    );
    const studentWorkingFiles = workingFileText(assignmentRoot);
    const studentReachableGit = await reachableGitText(assignmentRoot);
    for (const marker of protectedMarkers) {
      expect(serviceState).toContain(marker);
      expect(studentWorkingFiles).not.toContain(marker);
      expect(studentReachableGit).not.toContain(marker);
    }

    const staffResponse = await fetch(`${staffOrigin}/api/staff-dashboard`);
    expect(staffResponse.status).toBe(200);
    const staffView = await staffResponse.json();
    expect(staffView.environment.kind).toBe("connected-local-student-state");
    expect(staffView.assignments).toHaveLength(1);
    expect(staffView.assignments[0].assignment).toMatchObject({
      assignmentId: studentView.assignmentId,
      attemptNumber: 1,
      lifecycleState: "active",
    });

    child.kill("SIGTERM");
    const exit = await new Promise((resolve) => {
      child.once("exit", (code, signal) => resolve({ code, signal }));
    });
    processes.splice(processes.indexOf(child), 1);
    expect(exit).toEqual({ code: 0, signal: null });
    expect(output.value).toContain("Local pilot stopped cleanly");
    await expect(fetch(`${studentOrigin}/v1/student/assignment/status`)).rejects.toThrow();
    await expect(fetch(`${staffOrigin}/api/staff-dashboard`)).rejects.toThrow();
  },
  45_000,
);
