import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

import {
  GitCliRepositoryVerifier,
  RepositoryVerificationError,
  captureSubmissionArtifacts,
  createLocalSubmissionRepositoryVerifier,
  type RepositoryProof,
  type RepositoryVerifier,
} from "../src/repository.js";

const temporaryRoots: string[] = [];

function git(root: string, args: readonly string[]): string {
  return execFileSync("git", ["-C", root, ...args], {
    encoding: "utf8",
    env: { LC_ALL: "C", GIT_CONFIG_NOSYSTEM: "1", GIT_TERMINAL_PROMPT: "0" },
  }).trim();
}

function repository(): { root: string; commitSha: string; sessionIgnoreBlobId: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "volta-sim-repository-"));
  temporaryRoots.push(root);
  git(root, ["init", "--initial-branch=main"]);
  git(root, ["remote", "add", "origin", "https://github.com/Volta-Labs-Inc/assignment-1.git"]);
  fs.mkdirSync(path.join(root, "results"));
  fs.writeFileSync(path.join(root, "results", "answer.md"), "# Answer\n");
  fs.writeFileSync(path.join(root, "notes.txt"), "not selected\n");
  fs.writeFileSync(
    path.join(root, ".gitignore"),
    fs.readFileSync(path.resolve(".gitignore"), "utf8"),
  );
  fs.writeFileSync(path.join(root, ".gitattributes"), "results/*.md diff=evil filter=evil\n");
  git(root, ["add", "results/answer.md", "notes.txt", ".gitignore", ".gitattributes"]);
  git(root, ["-c", "user.name=Test", "-c", "user.email=test@example.test", "commit", "-m", "fixture"]);
  return {
    root,
    commitSha: git(root, ["rev-parse", "HEAD"]),
    sessionIgnoreBlobId: git(root, ["rev-parse", "HEAD:.gitignore"]),
  };
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("assignment repository binding", () => {
  it("accepts committed student progress descended from the assignment starting commit", async () => {
    const fixture = repository();
    fs.writeFileSync(path.join(fixture.root, "results", "new-answer.md"), "# Student's own work\n");
    git(fixture.root, ["add", "results/new-answer.md"]);
    git(fixture.root, ["-c", "user.name=Test", "-c", "user.email=test@example.test", "commit", "-m", "student progress"]);
    const verifier = new GitCliRepositoryVerifier({
      repositorySlug: "Volta-Labs-Inc/assignment-1",
      commitSha: fixture.commitSha,
      sessionIgnoreBlobId: fixture.sessionIgnoreBlobId,
    });
    await expect(verifier.verify(fixture.root, [])).resolves.toMatchObject({
      commitSha: git(fixture.root, ["rev-parse", "HEAD"]),
    });
    const captured = await captureSubmissionArtifacts(fixture.root, ["results/new-answer.md"], verifier);
    expect(captured.artifacts[0]?.content).toBe("# Student's own work\n");
  });

  it("rejects unrelated history and a committed change to the protected ignore file", async () => {
    const fixture = repository();
    const verifier = new GitCliRepositoryVerifier({ repositorySlug: "Volta-Labs-Inc/assignment-1", ...fixture });
    fs.appendFileSync(path.join(fixture.root, ".gitignore"), "other/\n");
    git(fixture.root, ["add", ".gitignore"]);
    git(fixture.root, ["-c", "user.name=Test", "-c", "user.email=test@example.test", "commit", "-m", "changed ignore"]);
    await expect(verifier.verify(fixture.root, [])).rejects.toBeInstanceOf(RepositoryVerificationError);
    const unrelated = git(fixture.root, ["-c", "user.name=Test", "-c", "user.email=test@example.test", "commit-tree", `${fixture.commitSha}^{tree}`, "-m", "unrelated root"]);
    git(fixture.root, ["update-ref", "HEAD", unrelated]);
    fs.writeFileSync(path.join(fixture.root, ".gitignore"), fs.readFileSync(path.resolve(".gitignore")));
    await expect(verifier.verify(fixture.root, [])).rejects.toBeInstanceOf(RepositoryVerificationError);
  });

  it("rejects force-added session records even when a later commit deletes them", async () => {
    const fixture = repository();
    const verifier = new GitCliRepositoryVerifier({ repositorySlug: "Volta-Labs-Inc/assignment-1", ...fixture });
    fs.mkdirSync(path.join(fixture.root, ".volta-sim"));
    fs.writeFileSync(path.join(fixture.root, ".volta-sim", "session.json"), '{"token":"synthetic-secret-canary"}\n');
    git(fixture.root, ["add", "--force", ".volta-sim/session.json"]);
    git(fixture.root, ["-c", "user.name=Test", "-c", "user.email=test@example.test", "commit", "-m", "accidentally commit session"]);
    await expect(verifier.verify(fixture.root, [])).rejects.toBeInstanceOf(RepositoryVerificationError);
    git(fixture.root, ["rm", "--", ".volta-sim/session.json"]);
    git(fixture.root, ["-c", "user.name=Test", "-c", "user.email=test@example.test", "commit", "-m", "remove session from current files"]);
    await expect(verifier.verify(fixture.root, [])).rejects.toBeInstanceOf(RepositoryVerificationError);
  });

  it("independently reads selected committed bytes and rejects forged client proofs", async () => {
    const fixture = repository();
    const expected = { slug: "Volta-Labs-Inc/assignment-1", commitSha: fixture.commitSha, sessionIgnoreBlobId: fixture.sessionIgnoreBlobId, selectedBlobs: {} };
    const captured = await captureSubmissionArtifacts(fixture.root, ["results/answer.md"], new GitCliRepositoryVerifier({ repositorySlug: expected.slug, ...fixture }));
    const verify = createLocalSubmissionRepositoryVerifier(fixture.root);
    await expect(verify(expected, captured)).resolves.toEqual(captured.repository);
    await expect(verify(expected, { ...captured, repository: { ...captured.repository, commitSha: "a".repeat(40) } })).rejects.toBeInstanceOf(RepositoryVerificationError);
    await expect(verify(expected, { ...captured, repository: { ...captured.repository, selectedBlobs: [{ path: "results/answer.md", objectId: "b".repeat(40) }] } })).rejects.toBeInstanceOf(RepositoryVerificationError);
    await expect(verify(expected, { ...captured, artifacts: [{ ...captured.artifacts[0]!, content: "invented client bytes" }] })).rejects.toBeInstanceOf(RepositoryVerificationError);
  });

  it("captures a selected tracked file only at the service-pinned repository and commit", async () => {
    const fixture = repository();
    const verifier = new GitCliRepositoryVerifier({
      repositorySlug: "Volta-Labs-Inc/assignment-1",
      commitSha: fixture.commitSha,
      sessionIgnoreBlobId: fixture.sessionIgnoreBlobId,
    });

    const result = await captureSubmissionArtifacts(
      fixture.root,
      ["results/answer.md"],
      verifier,
    );

    expect(result.repository).toMatchObject({
      repositorySlug: "Volta-Labs-Inc/assignment-1",
      commitSha: fixture.commitSha,
      sessionIgnoreBlobId: fixture.sessionIgnoreBlobId,
    });
    expect(result.repository.selectedBlobs).toHaveLength(1);
    expect(result.artifacts[0]?.content).toBe("# Answer\n");
  });

  it("rejects the wrong repository, wrong commit, dirty selected content, and untracked selections", async () => {
    const fixture = repository();
    const wrongRepository = new GitCliRepositoryVerifier({
      repositorySlug: "Volta-Labs-Inc/another-assignment",
      commitSha: fixture.commitSha,
      sessionIgnoreBlobId: fixture.sessionIgnoreBlobId,
    });
    await expect(
      captureSubmissionArtifacts(fixture.root, ["results/answer.md"], wrongRepository),
    ).rejects.toBeInstanceOf(RepositoryVerificationError);

    const wrongCommit = new GitCliRepositoryVerifier({
      repositorySlug: "Volta-Labs-Inc/assignment-1",
      commitSha: "a".repeat(40),
      sessionIgnoreBlobId: fixture.sessionIgnoreBlobId,
    });
    await expect(
      captureSubmissionArtifacts(fixture.root, ["results/answer.md"], wrongCommit),
    ).rejects.toBeInstanceOf(RepositoryVerificationError);

    const verifier = new GitCliRepositoryVerifier({
      repositorySlug: "Volta-Labs-Inc/assignment-1",
      commitSha: fixture.commitSha,
      sessionIgnoreBlobId: fixture.sessionIgnoreBlobId,
    });
    fs.appendFileSync(path.join(fixture.root, "results", "answer.md"), "changed\n");
    await expect(
      captureSubmissionArtifacts(fixture.root, ["results/answer.md"], verifier),
    ).rejects.toBeInstanceOf(RepositoryVerificationError);

    fs.writeFileSync(path.join(fixture.root, "results", "untracked.txt"), "untracked");
    await expect(
      captureSubmissionArtifacts(fixture.root, ["results/untracked.txt"], verifier),
    ).rejects.toBeInstanceOf(RepositoryVerificationError);
  });

  it("rejects a repository or selected blob that changes during capture", async () => {
    const fixture = repository();
    const first: RepositoryProof = {
      repositorySlug: "Volta-Labs-Inc/assignment-1",
      commitSha: fixture.commitSha,
      sessionIgnoreBlobId: fixture.sessionIgnoreBlobId,
      selectedBlobs: [{ path: "results/answer.md", objectId: "b".repeat(40) }],
    };
    const changed: RepositoryProof = { ...first, commitSha: "c".repeat(40) };
    let reads = 0;
    const verifier: RepositoryVerifier = {
      verify: async () => (reads++ === 0 ? first : changed),
    };
    await expect(
      captureSubmissionArtifacts(fixture.root, ["results/answer.md"], verifier),
    ).rejects.toBeInstanceOf(RepositoryVerificationError);
  });

  it("does not enumerate or reject unrelated unselected workspace changes", async () => {
    const fixture = repository();
    fs.writeFileSync(path.join(fixture.root, ".private-agent-canary"), "PRIVATE-CANARY");
    fs.appendFileSync(path.join(fixture.root, "notes.txt"), "dirty but unselected\n");
    const verifier = new GitCliRepositoryVerifier({
      repositorySlug: "Volta-Labs-Inc/assignment-1",
      commitSha: fixture.commitSha,
      sessionIgnoreBlobId: fixture.sessionIgnoreBlobId,
    });

    const result = await captureSubmissionArtifacts(
      fixture.root,
      ["results/answer.md"],
      verifier,
    );

    expect(JSON.stringify(result)).not.toContain("PRIVATE-CANARY");
    expect(JSON.stringify(result)).not.toContain("dirty but unselected");
  });

  it("requires the committed assignment ignore rule by blob, working bytes, and Git readback", async () => {
    const fixture = repository();
    const wrongBlob = new GitCliRepositoryVerifier({
      repositorySlug: "Volta-Labs-Inc/assignment-1",
      commitSha: fixture.commitSha,
      sessionIgnoreBlobId: "a".repeat(40),
    });
    await expect(wrongBlob.verify(fixture.root, [])).rejects.toBeInstanceOf(
      RepositoryVerificationError,
    );

    const verifier = new GitCliRepositoryVerifier({
      repositorySlug: "Volta-Labs-Inc/assignment-1",
      commitSha: fixture.commitSha,
      sessionIgnoreBlobId: fixture.sessionIgnoreBlobId,
    });
    expect(git(fixture.root, ["check-ignore", "--no-index", ".volta-sim/session.json"])).toBe(
      ".volta-sim/session.json",
    );
    expect(
      git(fixture.root, ["check-ignore", "--no-index", ".volta-sim/pending-submission.json"]),
    ).toBe(".volta-sim/pending-submission.json");
    expect(fs.readFileSync(path.join(fixture.root, ".gitignore"), "utf8")).toBe(
      fs.readFileSync(path.resolve(".gitignore"), "utf8"),
    );
    fs.writeFileSync(path.join(fixture.root, ".gitignore"), "different/\n");
    await expect(verifier.verify(fixture.root, [])).rejects.toBeInstanceOf(
      RepositoryVerificationError,
    );
  });

  it("never executes hostile Git diff, text conversion, content filter, or fsmonitor configuration", async () => {
    const fixture = repository();
    const canary = path.join(fixture.root, "hostile-git-config-ran");
    const fsmonitorCanary = path.join(fixture.root, "hostile-fsmonitor-ran");
    const hostile = path.join(fixture.root, ".evil-filter.sh");
    const hostileFsmonitor = path.join(fixture.root, ".evil-fsmonitor.sh");
    fs.writeFileSync(hostile, `#!/bin/sh\ntouch '${canary}'\ncat\n`, { mode: 0o700 });
    fs.writeFileSync(hostileFsmonitor, `#!/bin/sh\ntouch '${fsmonitorCanary}'\nexit 0\n`, {
      mode: 0o700,
    });
    git(fixture.root, ["config", "diff.external", hostile]);
    git(fixture.root, ["config", "diff.evil.textconv", hostile]);
    git(fixture.root, ["config", "filter.evil.clean", hostile]);
    git(fixture.root, ["config", "filter.evil.smudge", hostile]);
    git(fixture.root, ["config", "core.fsmonitor", hostileFsmonitor]);
    const verifier = new GitCliRepositoryVerifier({
      repositorySlug: "Volta-Labs-Inc/assignment-1",
      commitSha: fixture.commitSha,
      sessionIgnoreBlobId: fixture.sessionIgnoreBlobId,
    });

    await expect(verifier.verify(fixture.root, ["results/answer.md"])).resolves.toMatchObject({
      commitSha: fixture.commitSha,
    });
    expect(fs.existsSync(canary)).toBe(false);
    expect(fs.existsSync(fsmonitorCanary)).toBe(false);
    fs.appendFileSync(path.join(fixture.root, "results", "answer.md"), "changed\n");
    await expect(verifier.verify(fixture.root, ["results/answer.md"])).rejects.toBeInstanceOf(
      RepositoryVerificationError,
    );
    expect(fs.existsSync(canary)).toBe(false);
    expect(fs.existsSync(fsmonitorCanary)).toBe(false);
  });
});
