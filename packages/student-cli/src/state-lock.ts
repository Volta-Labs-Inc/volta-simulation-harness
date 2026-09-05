import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { setTimeout } from "node:timers/promises";
import { resolveControlFile } from "./control-files.js";

const heldLocks = new AsyncLocalStorage<ReadonlySet<string>>();

async function removeOwner(directory: string, owner: string): Promise<void> {
  await fs.promises.unlink(path.join(directory, owner)).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
  });
  // A competing recovery may already have installed a new, populated owner.
  await fs.promises.rmdir(directory).catch((error: NodeJS.ErrnoException) => {
    if (!["ENOENT", "ENOTEMPTY", "EEXIST"].includes(error.code ?? "")) throw error;
  });
}

async function recoverDeadOwner(directory: string): Promise<void> {
  const owners = await fs.promises.readdir(directory).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
    return [];
  });
  for (const owner of owners) {
    const match = /^owner-([1-9]\d*)-[a-f0-9-]+$/u.exec(owner);
    if (match === null) continue;
    try {
      process.kill(Number(match[1]), 0);
    } catch (error) {
      // Never steal from a live owner, an inaccessible process, or an unknown owner.
      if ((error as NodeJS.ErrnoException).code === "ESRCH") await removeOwner(directory, owner);
    }
  }
}

/** Coordinate all readers/writers of one local assignment, including staff processes. */
export async function withMockStudentStateLock<T>(
  root: string,
  relativePath: string,
  operation: () => Promise<T>,
): Promise<T> {
  const target = await resolveControlFile(root, relativePath);
  const lockPath = `${target}.lock`;
  const inherited = heldLocks.getStore();
  if (inherited?.has(lockPath)) return operation();
  const claimPath = await fs.promises.mkdtemp(`${target}.claim-`);
  const owner = `owner-${process.pid}-${randomUUID()}`;
  await fs.promises.writeFile(path.join(claimPath, owner), "", { flag: "wx", mode: 0o600 });
  let acquired = false;
  const deadline = Date.now() + 8_000;
  try {
    for (;;) {
      try {
        // Publish a populated owner atomically: an active lock is never empty.
        await fs.promises.rename(claimPath, lockPath);
        acquired = true;
        break;
      } catch (error) {
        if (!["EEXIST", "ENOTEMPTY"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
        await recoverDeadOwner(lockPath);
        if (Date.now() >= deadline) {
          throw new Error("The assignment is busy. Retry the same operation ID; no new work was saved by this request.");
        }
        await setTimeout(10);
      }
    }
    return await heldLocks.run(new Set([...(inherited ?? []), lockPath]), operation);
  } finally {
    await removeOwner(acquired ? lockPath : claimPath, owner);
  }
}
