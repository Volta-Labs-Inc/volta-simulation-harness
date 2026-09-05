import { execFile } from "node:child_process";
import fs from "node:fs";

import type { ArtifactSnapshot } from "@volta-sim/contracts";

import { captureSelectedArtifacts, validateSelectedArtifactPath } from "./artifacts.js";

export interface RepositoryProof {
  readonly repositorySlug: string;
  readonly commitSha: string;
  readonly sessionIgnoreBlobId: string;
  readonly selectedBlobs: readonly { readonly path: string; readonly objectId: string }[];
}

export interface ExpectedRepository {
  readonly repositorySlug: string;
  readonly commitSha: string;
  readonly sessionIgnoreBlobId: string;
}

export interface RepositoryVerifier {
  verify(assignmentRoot: string, selectedPaths: readonly string[]): Promise<RepositoryProof>;
}

export class RepositoryVerificationError extends Error {
  readonly code = "REPOSITORY_VERIFICATION_FAILED";

  constructor(message = "Cannot verify this assignment checkout. Use its assigned repository and history, preserve .gitignore, and commit any selected files before submitting") {
    super(message);
    this.name = "RepositoryVerificationError";
  }
}

interface GitResult {
  readonly exitCode: number;
  readonly stdout: string;
}

const GIT_ENV = {
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_NO_REPLACE_OBJECTS: "1",
  GIT_TERMINAL_PROMPT: "0",
  LC_ALL: "C",
} as const;

function runGit(root: string, args: readonly string[]): Promise<GitResult> {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      ["-C", root, ...args],
      {
        encoding: "utf8",
        env: GIT_ENV,
        maxBuffer: 1_000_000,
        timeout: 10_000,
      },
      (error, stdout) => {
        if (error === null) {
          resolve({ exitCode: 0, stdout });
          return;
        }
        if (typeof error.code === "number") {
          resolve({ exitCode: error.code, stdout });
          return;
        }
        reject(new RepositoryVerificationError());
      },
    );
  });
}

function requiredGitBytes(root: string, args: readonly string[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      ["-C", root, ...args],
      { encoding: "buffer", env: GIT_ENV, maxBuffer: 1_000_000, timeout: 10_000 },
      (error, stdout) => {
        if (error === null) {
          resolve(stdout);
          return;
        }
        reject(new RepositoryVerificationError());
      },
    );
  });
}

async function requiredGitOutput(root: string, args: readonly string[]): Promise<string> {
  const result = await runGit(root, args);
  if (result.exitCode !== 0) throw new RepositoryVerificationError();
  return result.stdout.trim();
}

export async function deriveAssignmentRepositoryRoot(startPath: string): Promise<string> {
  const root = await requiredGitOutput(startPath, ["rev-parse", "--show-toplevel"]);
  return fs.promises.realpath(root).catch(() => {
    throw new RepositoryVerificationError();
  });
}

function githubSlug(remote: string): string | null {
  const trimmed = remote.trim().replace(/\.git$/i, "");
  const match = /^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([^/]+\/[^/]+)$/i.exec(
    trimmed,
  );
  return match?.[1] ?? null;
}

export class GitCliRepositoryVerifier implements RepositoryVerifier {
  constructor(private readonly expected: ExpectedRepository) {}

  async verify(assignmentRoot: string, selectedPaths: readonly string[]): Promise<RepositoryProof> {
    if (!/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(this.expected.commitSha)) {
      throw new RepositoryVerificationError();
    }
    const root = await requiredGitOutput(assignmentRoot, ["rev-parse", "--show-toplevel"]);
    const [resolvedRoot, resolvedAssignmentRoot] = await Promise.all([
      fs.promises.realpath(root),
      fs.promises.realpath(assignmentRoot),
    ]);
    if (resolvedRoot !== resolvedAssignmentRoot) throw new RepositoryVerificationError();

    const remote = await requiredGitOutput(assignmentRoot, [
      "config",
      "--local",
      "--no-includes",
      "--get",
      "remote.origin.url",
    ]);
    const actualSlug = githubSlug(remote);
    if (actualSlug?.toLowerCase() !== this.expected.repositorySlug.toLowerCase()) {
      throw new RepositoryVerificationError();
    }

    const commitSha = await requiredGitOutput(assignmentRoot, ["rev-parse", "HEAD"]);
    const ancestry = await runGit(assignmentRoot, [
      "merge-base", "--is-ancestor", this.expected.commitSha, commitSha,
    ]);
    if (ancestry.exitCode !== 0) throw new RepositoryVerificationError();

    const [trackedSessionDirectory, sessionHistory] = await Promise.all([
      requiredGitOutput(assignmentRoot, ["ls-tree", commitSha, "--", ":(literal).volta-sim"]),
      requiredGitOutput(assignmentRoot, [
        "rev-list", "--full-history", "--max-count=1",
        `${this.expected.commitSha}..${commitSha}`, "--", ":(literal).volta-sim",
      ]),
    ]);
    if (trackedSessionDirectory !== "" || sessionHistory !== "") {
      throw new RepositoryVerificationError("Private session files were committed. Do not share this repository history; ask Volta staff for recovery help. Deleting the current files does not remove them from earlier commits.");
    }

    const ignoreEntry = await requiredGitOutput(assignmentRoot, ["ls-tree", "HEAD", "--", ".gitignore"]);
    const ignoreMatch = /^100644 blob ([a-f0-9]{40}(?:[a-f0-9]{24})?)\t\.gitignore$/.exec(
      ignoreEntry,
    );
    if (ignoreMatch?.[1] !== this.expected.sessionIgnoreBlobId) {
      throw new RepositoryVerificationError();
    }
    const [committedIgnore, sessionIgnored, pendingSubmissionIgnored] = await Promise.all([
      requiredGitBytes(assignmentRoot, ["cat-file", "blob", this.expected.sessionIgnoreBlobId]),
      runGit(assignmentRoot, ["check-ignore", "--quiet", "--no-index", ".volta-sim/session.json"]),
      runGit(assignmentRoot, [
        "check-ignore",
        "--quiet",
        "--no-index",
        ".volta-sim/pending-submission.json",
      ]),
    ]);
    const ignorePath = `${resolvedAssignmentRoot}/.gitignore`;
    const ignoreStatus = await fs.promises.lstat(ignorePath).catch(() => {
      throw new RepositoryVerificationError();
    });
    if (!ignoreStatus.isFile() || ignoreStatus.isSymbolicLink() || ignoreStatus.size > 100_000) {
      throw new RepositoryVerificationError();
    }
    const ignoreHandle = await fs.promises.open(
      ignorePath,
      fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0),
    );
    let workingIgnore: Buffer;
    try {
      const opened = await ignoreHandle.stat();
      if (opened.dev !== ignoreStatus.dev || opened.ino !== ignoreStatus.ino) {
        throw new RepositoryVerificationError();
      }
      workingIgnore = await ignoreHandle.readFile();
    } finally {
      await ignoreHandle.close();
    }
    if (
      sessionIgnored.exitCode !== 0 ||
      pendingSubmissionIgnored.exitCode !== 0 ||
      !workingIgnore.equals(committedIgnore) ||
      !committedIgnore.toString("utf8").split(/\r?\n/).includes(".volta-sim/")
    ) {
      throw new RepositoryVerificationError();
    }

    const selectedBlobs: { path: string; objectId: string }[] = [];
    for (const rawPath of selectedPaths) {
      const selectedPath = validateSelectedArtifactPath(rawPath);
      const treeEntry = await requiredGitOutput(assignmentRoot, [
        "ls-tree",
        "HEAD",
        "--",
        `:(literal)${selectedPath}`,
      ]);
      const match = /^(100644|100755) blob ([a-f0-9]{40}(?:[a-f0-9]{24})?)\t(.+)$/.exec(treeEntry);
      if (match?.[3] !== selectedPath) throw new RepositoryVerificationError();

      const [committedBytes, captured] = await Promise.all([
        requiredGitBytes(assignmentRoot, ["cat-file", "blob", match[2]!]),
        captureSelectedArtifacts(resolvedAssignmentRoot, [selectedPath]),
      ]);
      if (!Buffer.from(captured[0]!.content, "utf8").equals(committedBytes)) {
        throw new RepositoryVerificationError();
      }
      selectedBlobs.push({ path: selectedPath, objectId: match[2]! });
    }

    return {
      repositorySlug: this.expected.repositorySlug,
      commitSha,
      sessionIgnoreBlobId: this.expected.sessionIgnoreBlobId,
      selectedBlobs,
    };
  }
}

export async function captureSubmissionArtifacts(
  assignmentRoot: string,
  selectedPaths: readonly string[],
  repositoryVerifier: RepositoryVerifier,
): Promise<{ readonly repository: RepositoryProof; readonly artifacts: readonly ArtifactSnapshot[] }> {
  const before = await repositoryVerifier.verify(assignmentRoot, selectedPaths);
  const artifacts = await captureSelectedArtifacts(assignmentRoot, selectedPaths);
  const after = await repositoryVerifier.verify(assignmentRoot, selectedPaths);
  if (JSON.stringify(before) !== JSON.stringify(after)) throw new RepositoryVerificationError();
  return { repository: after, artifacts };
}

/** Local service readback is bound to the assigned checkout, never a client-supplied path. */
export function createLocalSubmissionRepositoryVerifier(assignmentRoot: string) {
  return async (
    expected: { readonly slug: string; readonly commitSha: string; readonly sessionIgnoreBlobId: string },
    request: { readonly repository: RepositoryProof; readonly artifacts: readonly ArtifactSnapshot[] },
  ): Promise<RepositoryProof> => {
    const captured = await captureSubmissionArtifacts(
      assignmentRoot,
      request.artifacts.map((artifact) => artifact.path),
      new GitCliRepositoryVerifier({
        repositorySlug: expected.slug,
        commitSha: expected.commitSha,
        sessionIgnoreBlobId: expected.sessionIgnoreBlobId,
      }),
    );
    if (
      JSON.stringify(captured.repository) !== JSON.stringify(request.repository) ||
      JSON.stringify(captured.artifacts) !== JSON.stringify(request.artifacts)
    ) {
      throw new RepositoryVerificationError();
    }
    return captured.repository;
  };
}
