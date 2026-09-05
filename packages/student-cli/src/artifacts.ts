import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import type { ArtifactSnapshot } from "@volta-sim/contracts";

export const MAX_ARTIFACT_BYTES = 1_000_000;
export const MAX_TOTAL_ARTIFACT_BYTES = 5_000_000;
export const MAX_ARTIFACT_COUNT = 50;

const MEDIA_TYPES = new Map<string, ArtifactSnapshot["mediaType"]>([
  [".txt", "text/plain"],
  [".md", "text/markdown"],
  [".csv", "text/csv"],
  [".json", "application/json"],
]);

const FORBIDDEN_FILENAMES = new Set([
  "agents.md",
  "claude.md",
  "gemini.md",
]);

export class ArtifactAccessError extends Error {
  readonly code = "ARTIFACT_ACCESS_DENIED";

  constructor(message = "Select a supported text file inside the assignment root") {
    super(message);
    this.name = "ArtifactAccessError";
  }
}

function hasUnsafeCharacter(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0)!;
    return (
      codePoint <= 0x1f ||
      (codePoint >= 0x7f && codePoint <= 0x9f) ||
      codePoint === 0x2028 ||
      codePoint === 0x2029
    );
  });
}

export function validateSelectedArtifactPath(selectedPath: string): string {
  if (
    selectedPath.length === 0 ||
    selectedPath.length > 500 ||
    selectedPath !== selectedPath.normalize("NFC") ||
    selectedPath.startsWith(":") ||
    selectedPath.includes("\\") ||
    hasUnsafeCharacter(selectedPath) ||
    path.posix.isAbsolute(selectedPath) ||
    path.win32.isAbsolute(selectedPath)
  ) {
    throw new ArtifactAccessError();
  }

  const segments = selectedPath.split("/");
  if (
    segments.some(
      (segment) =>
        segment.length === 0 ||
        segment === "." ||
        segment === ".." ||
        segment.startsWith(".") ||
        segment.includes(":") ||
        /[ .]$/.test(segment) ||
        /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(segment) ||
        FORBIDDEN_FILENAMES.has(segment.toLowerCase()),
    )
  ) {
    throw new ArtifactAccessError();
  }

  if (!MEDIA_TYPES.has(path.posix.extname(selectedPath).toLowerCase())) {
    throw new ArtifactAccessError("Select a .txt, .md, .csv, or .json file");
  }

  return segments.join("/");
}

function isMissing(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}

interface PathIdentity {
  readonly path: string;
  readonly device: number;
  readonly inode: number;
}

async function assertNoSymlinkOrSubmodule(
  root: string,
  selectedPath: string,
): Promise<readonly PathIdentity[]> {
  const segments = selectedPath.split("/");
  let current = root;
  const rootStatus = await fs.promises.lstat(root);
  const identities: PathIdentity[] = [
    { path: root, device: rootStatus.dev, inode: rootStatus.ino },
  ];
  for (const [index, segment] of segments.entries()) {
    current = path.join(current, segment);
    let status: fs.Stats;
    try {
      status = await fs.promises.lstat(current);
    } catch {
      throw new ArtifactAccessError("The selected artifact is unavailable");
    }
    if (status.isSymbolicLink()) throw new ArtifactAccessError("Symlinks cannot be submitted");
    identities.push({ path: current, device: status.dev, inode: status.ino });
    if (index < segments.length - 1 && !status.isDirectory()) {
      throw new ArtifactAccessError("The selected artifact path is unavailable");
    }
    if (index < segments.length - 1) {
      try {
        await fs.promises.lstat(path.join(current, ".git"));
        throw new ArtifactAccessError("Files inside nested repositories or submodules are not supported");
      } catch (error) {
        if (error instanceof ArtifactAccessError) throw error;
        if (!isMissing(error)) throw new ArtifactAccessError("The selected artifact cannot be verified");
      }
    }
  }
  return identities;
}

function samePathIdentities(
  before: readonly PathIdentity[],
  after: readonly PathIdentity[],
): boolean {
  return (
    before.length === after.length &&
    before.every(
      (identity, index) =>
        identity.path === after[index]?.path &&
        identity.device === after[index]?.device &&
        identity.inode === after[index]?.inode,
    )
  );
}

async function captureOne(root: string, selectedPath: string): Promise<ArtifactSnapshot> {
  const normalizedPath = validateSelectedArtifactPath(selectedPath);
  const identitiesBefore = await assertNoSymlinkOrSubmodule(root, normalizedPath);
  const candidate = path.resolve(root, ...normalizedPath.split("/"));
  const relative = path.relative(root, candidate);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new ArtifactAccessError();

  const resolved = await fs.promises.realpath(candidate).catch(() => {
    throw new ArtifactAccessError("The selected artifact is unavailable");
  });
  if (resolved !== candidate) throw new ArtifactAccessError("Symlinks cannot be submitted");

  const before = await fs.promises.lstat(candidate);
  if (!before.isFile()) throw new ArtifactAccessError("Only regular files can be submitted");
  if (before.size > MAX_ARTIFACT_BYTES) throw new ArtifactAccessError("The selected artifact is too large");

  const handle = await fs.promises.open(
    candidate,
    fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0),
  );
  let bytes: Buffer;
  let opened: fs.Stats;
  try {
    opened = await handle.stat();
    if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino) {
      throw new ArtifactAccessError("The selected artifact changed while being captured");
    }
    if (opened.size > MAX_ARTIFACT_BYTES) {
      throw new ArtifactAccessError("The selected artifact is too large");
    }
    bytes = await handle.readFile();
  } finally {
    await handle.close();
  }

  const identitiesAfter = await assertNoSymlinkOrSubmodule(root, normalizedPath);
  const resolvedAfter = await fs.promises.realpath(candidate).catch(() => {
    throw new ArtifactAccessError("The selected artifact changed while being captured");
  });
  const after = await fs.promises.lstat(candidate);
  if (
    !samePathIdentities(identitiesBefore, identitiesAfter) ||
    resolvedAfter !== candidate ||
    after.dev !== opened.dev ||
    after.ino !== opened.ino ||
    after.size !== opened.size ||
    after.mtimeMs !== opened.mtimeMs
  ) {
    throw new ArtifactAccessError("The selected artifact changed while being captured");
  }

  let content: string;
  try {
    content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new ArtifactAccessError("The selected artifact must be valid UTF-8 text");
  }

  if (path.posix.extname(normalizedPath).toLowerCase() === ".json") {
    try {
      JSON.parse(content);
    } catch {
      throw new ArtifactAccessError("A selected JSON artifact must contain valid JSON");
    }
  }

  return {
    path: normalizedPath,
    digest: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
    mediaType: MEDIA_TYPES.get(path.posix.extname(normalizedPath).toLowerCase())!,
    byteLength: bytes.byteLength,
    content,
  };
}

export async function captureSelectedArtifacts(
  assignmentRoot: string,
  selectedPaths: readonly string[],
): Promise<readonly ArtifactSnapshot[]> {
  if (selectedPaths.length > MAX_ARTIFACT_COUNT || new Set(selectedPaths).size !== selectedPaths.length) {
    throw new ArtifactAccessError("Select no more than 50 unique artifacts");
  }
  const root = await fs.promises.realpath(assignmentRoot).catch(() => {
    throw new ArtifactAccessError("The assignment root is unavailable");
  });
  const rootStatus = await fs.promises.lstat(root);
  if (!rootStatus.isDirectory() || rootStatus.isSymbolicLink()) {
    throw new ArtifactAccessError("The assignment root must be a real directory");
  }

  const artifacts: ArtifactSnapshot[] = [];
  let totalBytes = 0;
  for (const selectedPath of selectedPaths) {
    const artifact = await captureOne(root, selectedPath);
    totalBytes += artifact.byteLength;
    if (totalBytes > MAX_TOTAL_ARTIFACT_BYTES) {
      throw new ArtifactAccessError("The selected artifacts exceed the total size limit");
    }
    artifacts.push(artifact);
  }
  return artifacts;
}
