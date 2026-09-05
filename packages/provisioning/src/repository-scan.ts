import { execFile } from "node:child_process";
import { readdir, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import type { RepositoryReadback } from "./github.js";
import type {
  AssignmentProvisioningRequest,
  AssignmentRecord,
  CleanRepositoryScanReceipt,
  StudentBundleMaterialization,
} from "./types.js";

const execFileAsync = promisify(execFile);

export interface ProtectedCanary {
  readonly id: string;
  readonly value: string;
}

export interface CanaryMatch {
  readonly canaryId: string;
  readonly surface: "working-tree" | "refs" | "reachable-object" | "build-output";
  readonly locator: string;
}

export interface RepositoryCanaryScan {
  readonly clean: boolean;
  readonly checkedRefCount: number;
  readonly checkedObjectCount: number;
  readonly matches: readonly CanaryMatch[];
  readonly repositoryStateDigest: `sha256:${string}`;
}

export interface ProtectedCanarySet {
  readonly setDigest: `sha256:${string}`;
  readonly canaries: readonly ProtectedCanary[];
}

export interface ProtectedCanarySource {
  deriveForRequest(
    request: Pick<AssignmentProvisioningRequest, "caseVersionDigest" | "studentBundleDigest">,
  ): ProtectedCanarySet;
}

export interface RepositoryLeakScanner {
  scan(input: {
    readonly assignment: AssignmentRecord;
    readonly repository: RepositoryReadback;
    readonly canarySet: ProtectedCanarySet;
    readonly stage: "pre_invitation" | "pre_ready";
    readonly generation: number;
  }): Promise<CleanRepositoryScanReceipt>;
}

export class RepositoryScanError extends Error {
  constructor(readonly code: "repository-scan-dirty" | "repository-scan-timeout" | "repository-scan-failed") {
    super(code);
  }
}

function digestText(value: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function digestBytes(value: Buffer): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function materializedFilesDigest(repository: RepositoryReadback): `sha256:${string}` {
  return digestText(JSON.stringify(repository.materializedFiles));
}

function protectedCanarySet(canaries: readonly ProtectedCanary[]): ProtectedCanarySet {
  const normalized = [...canaries]
    .map(({ id, value }) => ({ id, value }))
    .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
  if (
    normalized.length === 0 ||
    normalized.some(({ id, value }) => id.length === 0 || value.length === 0) ||
    new Set(normalized.map(({ id }) => id)).size !== normalized.length ||
    new Set(normalized.map(({ value }) => value)).size !== normalized.length
  ) {
    throw new Error("Protected canaries must be nonempty and uniquely identified");
  }
  return {
    setDigest: digestText(
      JSON.stringify(
        normalized.map(({ id, value }) => ({ id, digest: digestText(value) })),
      ),
    ),
    canaries: normalized,
  };
}

export class StaticProtectedCanarySource implements ProtectedCanarySource {
  readonly #set: ProtectedCanarySet;

  constructor(canaries: readonly ProtectedCanary[]) {
    this.#set = protectedCanarySet(canaries);
  }

  deriveForRequest(): ProtectedCanarySet {
    return structuredClone(this.#set);
  }
}

export function assertStudentMaterializationIsCanaryFree(
  materialization: StudentBundleMaterialization,
  canarySet: ProtectedCanarySet,
): void {
  for (const file of materialization.files) {
    const bytes = Buffer.from(file.content, "utf8");
    if (
      canarySet.canaries.some(({ value }) =>
        bytes.includes(Buffer.from(value, "utf8")),
      )
    ) {
      throw new RepositoryScanError("repository-scan-dirty");
    }
  }
}

export function cleanRepositoryScanReceiptId(
  receipt: Omit<CleanRepositoryScanReceipt, "receiptId">,
): `sha256:${string}` {
  return digestText(JSON.stringify({
    stage: receipt.stage,
    generation: receipt.generation,
    assignmentId: receipt.assignmentId,
    providerRepositoryId: receipt.providerRepositoryId,
    repositoryOwner: receipt.repositoryOwner,
    repositoryName: receipt.repositoryName,
    templateCommit: receipt.templateCommit,
    materializedCommit: receipt.materializedCommit,
    studentBundleDigest: receipt.studentBundleDigest,
    studentManifestDigest: receipt.studentManifestDigest,
    materializedFilesDigest: receipt.materializedFilesDigest,
    repositoryStateDigest: receipt.repositoryStateDigest,
    canarySetDigest: receipt.canarySetDigest,
    scannerVersion: receipt.scannerVersion,
    scannedAt: receipt.scannedAt,
  }));
}

function buildCleanReceipt(input: {
  readonly assignment: AssignmentRecord;
  readonly repository: RepositoryReadback;
  readonly canarySet: ProtectedCanarySet;
  readonly stage: "pre_invitation" | "pre_ready";
  readonly generation: number;
  readonly repositoryStateDigest: `sha256:${string}`;
  readonly scannerVersion: string;
  readonly scannedAt: string;
}): CleanRepositoryScanReceipt {
  const content: Omit<CleanRepositoryScanReceipt, "receiptId"> = {
    stage: input.stage,
    generation: input.generation,
    assignmentId: input.assignment.assignmentId,
    providerRepositoryId: input.repository.providerRepositoryId,
    repositoryOwner: input.repository.owner,
    repositoryName: input.repository.name,
    templateCommit: input.repository.templateCommit,
    materializedCommit: input.repository.materializedCommit,
    studentBundleDigest: input.repository.studentBundleDigest as `sha256:${string}`,
    studentManifestDigest: input.repository.studentManifestDigest as `sha256:${string}`,
    materializedFilesDigest: materializedFilesDigest(input.repository),
    repositoryStateDigest: input.repositoryStateDigest,
    canarySetDigest: input.canarySet.setDigest,
    scannerVersion: input.scannerVersion,
    scannedAt: input.scannedAt,
  };
  return { receiptId: cleanRepositoryScanReceiptId(content), ...content };
}

export class MockRepositoryLeakScanner implements RepositoryLeakScanner {
  readonly #outcomes: Array<"clean" | "dirty" | "timeout" | "failure">;
  #nextRepositoryStateDigest: `sha256:${string}` | undefined;
  scanCalls = 0;

  constructor(
    outcomes: readonly ("clean" | "dirty" | "timeout" | "failure")[] = [],
    private readonly now: () => string = () => "2026-09-04T16:00:00.000Z",
  ) {
    this.#outcomes = [...outcomes];
  }

  setNextRepositoryStateDigest(digest: `sha256:${string}`): void {
    this.#nextRepositoryStateDigest = digest;
  }

  async scan(input: {
    readonly assignment: AssignmentRecord;
    readonly repository: RepositoryReadback;
    readonly canarySet: ProtectedCanarySet;
    readonly stage: "pre_invitation" | "pre_ready";
    readonly generation: number;
  }): Promise<CleanRepositoryScanReceipt> {
    this.scanCalls += 1;
    const outcome = this.#outcomes.shift() ?? "clean";
    if (outcome !== "clean") {
      throw new RepositoryScanError(
        outcome === "dirty"
          ? "repository-scan-dirty"
          : outcome === "timeout"
            ? "repository-scan-timeout"
            : "repository-scan-failed",
      );
    }
    const repositoryStateDigest = this.#nextRepositoryStateDigest ?? digestText(JSON.stringify({
      materializedCommit: input.repository.materializedCommit,
      materializedFiles: input.repository.materializedFiles,
      studentBundleDigest: input.repository.studentBundleDigest,
      studentManifestDigest: input.repository.studentManifestDigest,
      templateCommit: input.repository.templateCommit,
    }));
    this.#nextRepositoryStateDigest = undefined;
    return buildCleanReceipt({
      ...input,
      repositoryStateDigest,
      scannerVersion: "mock-provider-snapshot-v1",
      scannedAt: this.now(),
    });
  }
}

export class GitCheckoutRepositoryLeakScanner implements RepositoryLeakScanner {
  constructor(
    private readonly resolveCheckout: (repository: RepositoryReadback) => Promise<{
      readonly repositoryPath: string;
      readonly buildOutputPaths: readonly string[];
    }>,
    private readonly now: () => string,
    private readonly scannerVersion = "git-all-reachable-v1",
  ) {}

  async scan(input: {
    readonly assignment: AssignmentRecord;
    readonly repository: RepositoryReadback;
    readonly canarySet: ProtectedCanarySet;
    readonly stage: "pre_invitation" | "pre_ready";
    readonly generation: number;
  }): Promise<CleanRepositoryScanReceipt> {
    try {
      const checkout = await this.resolveCheckout(input.repository);
      const checkoutHead = await execFileAsync(
        "git",
        ["-C", checkout.repositoryPath, "rev-parse", "HEAD"],
        { encoding: "utf8", maxBuffer: 1024 * 1024 },
      );
      if (checkoutHead.stdout.trim() !== input.repository.materializedCommit) {
        throw new RepositoryScanError("repository-scan-failed");
      }
      const result = await scanRepositoryForProtectedCanaries({
        ...checkout,
        canaries: input.canarySet.canaries,
      });
      if (!result.clean) throw new RepositoryScanError("repository-scan-dirty");
      return buildCleanReceipt({
        ...input,
        repositoryStateDigest: result.repositoryStateDigest,
        scannerVersion: this.scannerVersion,
        scannedAt: this.now(),
      });
    } catch (error) {
      if (error instanceof RepositoryScanError) throw error;
      throw new RepositoryScanError("repository-scan-failed");
    }
  }
}

function findMatches(
  content: Buffer | string,
  surface: CanaryMatch["surface"],
  locator: string,
  canaries: readonly ProtectedCanary[],
): CanaryMatch[] {
  const bytes = Buffer.isBuffer(content) ? content : Buffer.from(content, "utf8");
  return canaries
    .filter(({ value }) => bytes.includes(Buffer.from(value, "utf8")))
    .map(({ id }) => ({ canaryId: id, surface, locator }));
}

async function filesUnder(root: string, relative = ""): Promise<string[]> {
  const directory = path.join(root, relative);
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    if (relative === "" && entry.name === ".git") continue;
    const child = relative === "" ? entry.name : path.join(relative, entry.name);
    if (entry.isDirectory()) files.push(...(await filesUnder(root, child)));
    else if (entry.isFile()) files.push(child);
    else throw new Error(`Unsupported repository entry: ${child}`);
  }
  return files.sort();
}

export async function scanRepositoryForProtectedCanaries(input: {
  readonly repositoryPath: string;
  readonly buildOutputPaths: readonly string[];
  readonly canaries: readonly ProtectedCanary[];
}): Promise<RepositoryCanaryScan> {
  const repositoryPath = await realpath(input.repositoryPath);
  if (input.canaries.length === 0 || input.canaries.some(({ id, value }) => id.length === 0 || value.length === 0)) {
    throw new Error("Protected-canary scan requires named, nonempty canaries");
  }
  const matches: CanaryMatch[] = [];
  const stateDescriptors: string[] = [];
  for (const relativePath of await filesUnder(repositoryPath)) {
    const content = await readFile(path.join(repositoryPath, relativePath));
    stateDescriptors.push(`working-tree:${relativePath}:${digestBytes(content)}`);
    matches.push(
      ...findMatches(
        content,
        "working-tree",
        relativePath,
        input.canaries,
      ),
    );
  }

  const refs = await execFileAsync("git", ["-C", repositoryPath, "for-each-ref", "--format=%(refname)%00%(objectname)"], {
    encoding: "buffer",
    maxBuffer: 10 * 1024 * 1024,
  });
  const refLines = refs.stdout.toString("utf8").split("\n").filter(Boolean);
  stateDescriptors.push(`refs:${digestBytes(refs.stdout)}`);
  matches.push(...findMatches(refs.stdout, "refs", "all-refs", input.canaries));

  const objects = await execFileAsync("git", ["-C", repositoryPath, "rev-list", "--objects", "--all"], {
    encoding: "utf8",
    maxBuffer: 50 * 1024 * 1024,
  });
  const objectIds = [
    ...new Set(
      objects.stdout
        .split("\n")
        .filter(Boolean)
        .map((line) => line.split(" ", 1)[0]!),
    ),
  ];
  for (const objectId of objectIds) {
    const object = await execFileAsync("git", ["-C", repositoryPath, "cat-file", "-p", objectId], {
      encoding: "buffer",
      maxBuffer: 50 * 1024 * 1024,
    });
    stateDescriptors.push(`reachable-object:${objectId}:${digestBytes(object.stdout)}`);
    matches.push(
      ...findMatches(object.stdout, "reachable-object", objectId, input.canaries),
    );
  }

  for (const buildOutputPath of input.buildOutputPaths) {
    const absolute = path.resolve(repositoryPath, buildOutputPath);
    const relative = path.relative(repositoryPath, absolute);
    if (relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new Error("Build output must remain inside the repository");
    }
    const realBuildOutput = await realpath(absolute);
    const realBuildRelative = path.relative(repositoryPath, realBuildOutput);
    if (realBuildRelative.startsWith(`..${path.sep}`) || path.isAbsolute(realBuildRelative)) {
      throw new Error("Build output must remain inside the repository");
    }
    for (const file of await filesUnder(realBuildOutput)) {
      const content = await readFile(path.join(realBuildOutput, file));
      stateDescriptors.push(`build-output:${buildOutputPath}/${file}:${digestBytes(content)}`);
      matches.push(
        ...findMatches(
          content,
          "build-output",
          path.join(buildOutputPath, file),
          input.canaries,
        ),
      );
    }
  }

  const uniqueMatches = [
    ...new Map(
      matches.map((match) => [
        `${match.canaryId}:${match.surface}:${match.locator}`,
        match,
      ]),
    ).values(),
  ];
  return {
    clean: uniqueMatches.length === 0,
    checkedRefCount: refLines.length,
    checkedObjectCount: objectIds.length,
    matches: uniqueMatches,
    repositoryStateDigest: digestText(JSON.stringify(stateDescriptors.sort())),
  };
}
