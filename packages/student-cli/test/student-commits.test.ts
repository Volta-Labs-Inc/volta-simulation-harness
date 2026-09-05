import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { runCli } from "../src/cli.js";
import { HttpStudentServiceClient } from "../src/http-client.js";
import { startLocalStudentHttpService, type RunningLocalStudentHttpService } from "../src/local-http-service.js";
import { captureSubmissionArtifacts, GitCliRepositoryVerifier } from "../src/repository.js";
import { createStudentFixture, type StudentFixture } from "./fixture.js";

const fixtures: StudentFixture[] = [];
const servers: RunningLocalStudentHttpService[] = [];
function git(root: string, args: readonly string[]) {
  return execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim();
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
  for (const fixture of fixtures.splice(0)) {
    fs.rmSync(fixture.root, { recursive: true, force: true });
    fs.rmSync(fixture.serviceRoot, { recursive: true, force: true });
  }
});

describe("student progress through the connected local service", () => {
  it("allows status, resume, a fresh login, and a newly authored committed build while rejecting spoofed proofs", async () => {
    const fixture = createStudentFixture();
    fixtures.push(fixture);
    fixture.state.workingDraft = { ...fixture.draft, responsePlan: { ...fixture.draft.responsePlan, mode: "build" } };
    fs.writeFileSync(path.join(fixture.serviceRoot, fixture.statePath), JSON.stringify(fixture.state));
    const server = await startLocalStudentHttpService({
      serviceStateRoot: fixture.serviceRoot,
      statePath: fixture.statePath,
      assignmentRoot: fixture.root,
      now: () => new Date("2026-09-04T16:00:00.000Z"),
    });
    servers.push(server);
    const client = new HttpStudentServiceClient(server.origin);
    async function invoke(args: readonly string[]) {
      const messages: string[] = [];
      const code = await runCli(args, { assignmentRoot: fixture.root, client, io: {
        writeOut: (message) => messages.push(message),
        writeError: (message) => messages.push(message),
      } });
      return { code, output: messages.join("\n") };
    }
    expect((await invoke(["login", "--operation-id", "first-login"])).code).toBe(0);
    fs.writeFileSync(path.join(fixture.root, "results", "student-build.md"), "# Newly authored bounded prototype\n");
    git(fixture.root, ["add", "results/student-build.md"]);
    git(fixture.root, ["-c", "user.name=Student", "-c", "user.email=student@example.test", "commit", "-m", "Save my prototype"]);
    for (const args of [["status"], ["resume"], ["logout", "--operation-id", "logout"], ["login", "--operation-id", "new-login"]]) {
      expect(await invoke(args)).toMatchObject({ code: 0 });
    }

    const captured = await captureSubmissionArtifacts(fixture.root, ["results/student-build.md"], new GitCliRepositoryVerifier({
      repositorySlug: fixture.state.expectedRepository.slug,
      commitSha: fixture.commitSha,
      sessionIgnoreBlobId: fixture.sessionIgnoreBlobId,
    }));
    const session = JSON.parse(fs.readFileSync(path.join(fixture.root, fixture.sessionPath), "utf8")) as { token: string };
    const request = {
      kind: "submit" as const,
      operationId: "forged-commit",
      draft: { ...fixture.draft, gitCommitSha: "a".repeat(40), responsePlan: { ...fixture.draft.responsePlan, mode: "build" as const, artifactSnapshots: [...captured.artifacts] } },
      ...captured,
      repository: { ...captured.repository, commitSha: "a".repeat(40) },
      mode: "build" as const,
    };
    await expect(client.execute(request, session.token)).rejects.toThrow();
    await expect(client.execute({
      ...request,
      operationId: "forged-blob",
      draft: { ...request.draft, gitCommitSha: captured.repository.commitSha },
      repository: { ...captured.repository, selectedBlobs: [{ path: "results/student-build.md", objectId: "b".repeat(40) }] },
    }, session.token)).rejects.toThrow();

    const submitted = await invoke(["submit", "--operation-id", "submit-progress", "--artifact", "results/student-build.md"]);
    expect(submitted.code, submitted.output).toBe(0);
    expect(submitted.output).toContain('"accepted": true');
    const saved = JSON.parse(fs.readFileSync(path.join(fixture.serviceRoot, fixture.statePath), "utf8")) as StudentFixture["state"];
    expect(saved.attempt.status).toBe("submitted");
    expect(JSON.stringify(saved.attempt.submission)).toContain(captured.repository.commitSha);
    expect(JSON.stringify(saved.attempt.submission)).toContain("# Newly authored bounded prototype");
    expect(saved.expectedRepository.commitSha).toBe(fixture.commitSha);
  });
});
