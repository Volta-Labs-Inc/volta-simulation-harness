import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export class ControlFileError extends Error {
  constructor(message = "The selected control file is unavailable") {
    super(message);
    this.name = "ControlFileError";
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

export function validateControlPath(relativePath: string): string {
  if (
    relativePath.length === 0 ||
    relativePath.length > 500 ||
    relativePath !== relativePath.normalize("NFC") ||
    relativePath.includes("\\") ||
    hasUnsafeCharacter(relativePath) ||
    path.posix.isAbsolute(relativePath) ||
    path.win32.isAbsolute(relativePath) ||
    relativePath.split("/").some((part) => part === "" || part === "." || part === "..")
  ) {
    throw new ControlFileError();
  }
  return relativePath;
}

async function assertExistingAncestors(root: string, target: string): Promise<void> {
  const relative = path.relative(root, target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new ControlFileError();
  let current = root;
  for (const part of relative.split(path.sep).slice(0, -1)) {
    current = path.join(current, part);
    try {
      const status = await fs.promises.lstat(current);
      if (!status.isDirectory() || status.isSymbolicLink()) throw new ControlFileError();
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        (error as { code?: unknown }).code === "ENOENT"
      ) {
        await fs.promises.mkdir(current, { mode: 0o700 });
      } else {
        throw error instanceof ControlFileError ? error : new ControlFileError();
      }
    }
  }
}

export async function resolveControlFile(
  assignmentRoot: string,
  relativePath: string,
): Promise<string> {
  const root = await fs.promises.realpath(assignmentRoot).catch(() => {
    throw new ControlFileError("The assignment root is unavailable");
  });
  const rootStatus = await fs.promises.lstat(root);
  if (!rootStatus.isDirectory() || rootStatus.isSymbolicLink()) throw new ControlFileError();
  const normalized = validateControlPath(relativePath);
  const target = path.resolve(root, ...normalized.split("/"));
  await assertExistingAncestors(root, target);
  return target;
}

export async function readControlJson(
  assignmentRoot: string,
  relativePath: string,
): Promise<unknown> {
  const target = await resolveControlFile(assignmentRoot, relativePath);
  const status = await fs.promises.lstat(target).catch(() => {
    throw new ControlFileError();
  });
  if (!status.isFile() || status.isSymbolicLink() || status.size > 10_000_000) {
    throw new ControlFileError();
  }
  const handle = await fs.promises.open(
    target,
    fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0),
  );
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.dev !== status.dev || opened.ino !== status.ino) {
      throw new ControlFileError();
    }
    return JSON.parse(await handle.readFile("utf8")) as unknown;
  } catch (error) {
    throw error instanceof ControlFileError ? error : new ControlFileError();
  } finally {
    await handle.close();
  }
}

export async function readOptionalControlJson(
  assignmentRoot: string,
  relativePath: string,
): Promise<unknown | undefined> {
  const target = await resolveControlFile(assignmentRoot, relativePath);
  try {
    await fs.promises.lstat(target);
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: unknown }).code === "ENOENT"
    ) {
      return undefined;
    }
    throw new ControlFileError();
  }
  return readControlJson(assignmentRoot, relativePath);
}

export async function writeControlJson(
  assignmentRoot: string,
  relativePath: string,
  value: unknown,
): Promise<void> {
  const target = await resolveControlFile(assignmentRoot, relativePath);
  try {
    const existing = await fs.promises.lstat(target);
    if (!existing.isFile() || existing.isSymbolicLink()) throw new ControlFileError();
  } catch (error) {
    if (
      !(
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        (error as { code?: unknown }).code === "ENOENT"
      )
    ) {
      throw error instanceof ControlFileError ? error : new ControlFileError();
    }
  }
  const temporary = `${target}.${randomBytes(12).toString("hex")}.tmp`;
  try {
    await fs.promises.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    await fs.promises.rename(temporary, target);
    await fs.promises.chmod(target, 0o600);
  } finally {
    await fs.promises.rm(temporary, { force: true }).catch(() => undefined);
  }
}

export async function removeControlFile(
  assignmentRoot: string,
  relativePath: string,
): Promise<void> {
  const target = await resolveControlFile(assignmentRoot, relativePath);
  try {
    const status = await fs.promises.lstat(target);
    if (!status.isFile() || status.isSymbolicLink()) throw new ControlFileError();
    await fs.promises.rm(target);
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: unknown }).code === "ENOENT"
    ) {
      return;
    }
    throw error instanceof ControlFileError ? error : new ControlFileError();
  }
}
