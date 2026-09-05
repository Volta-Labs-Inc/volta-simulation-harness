import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { scanRepositoryForProtectedCanaries } from "../src/index.js";

const execFileAsync = promisify(execFile);

async function git(repositoryPath: string, args: readonly string[]): Promise<void> {
  await execFileAsync(
    "git",
    ["-C", repositoryPath, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.test", ...args],
    { encoding: "utf8" },
  );
}

async function createRepository(): Promise<string> {
  const repositoryPath = await mkdtemp(path.join(tmpdir(), "volta-repository-scan-"));
  await git(repositoryPath, ["init", "-b", "main"]);
  await mkdir(path.join(repositoryPath, "dist"), { recursive: true });
  await writeFile(path.join(repositoryPath, "README.md"), "Synthetic student bundle only.\n", "utf8");
  await writeFile(path.join(repositoryPath, "dist/output.txt"), "Public build output.\n", "utf8");
  await git(repositoryPath, ["add", "."]);
  await git(repositoryPath, ["commit", "-m", "student bundle"]);
  await git(repositoryPath, ["tag", "student-start"]);
  return repositoryPath;
}

describe("full Git repository protected-canary scan", () => {
  it("keeps seeded protected inputs out of working tree, refs, history, objects, and build output", async () => {
    const sourceRoot = await mkdtemp(path.join(tmpdir(), "volta-protected-source-"));
    const protectedCanaries = [
      { id: "truth", value: "CANARY_PROTECTED_TRUTH_42" },
      { id: "calibration", value: "CANARY_PROTECTED_CALIBRATION_81" },
      { id: "anchor", value: "CANARY_PROTECTED_ANCHOR_17" },
    ] as const;
    await writeFile(
      path.join(sourceRoot, "protected-input.txt"),
      protectedCanaries.map(({ value }) => value).join("\n"),
      "utf8",
    );
    expect(await readFile(path.join(sourceRoot, "protected-input.txt"), "utf8")).toContain(
      protectedCanaries[0].value,
    );

    const repositoryPath = await createRepository();
    const report = await scanRepositoryForProtectedCanaries({
      repositoryPath,
      buildOutputPaths: ["dist"],
      canaries: protectedCanaries,
    });

    expect(report).toMatchObject({ clean: true, matches: [] });
    expect(report.checkedRefCount).toBeGreaterThanOrEqual(2);
    expect(report.checkedObjectCount).toBeGreaterThan(0);
  });

  it("detects protected values hidden in another ref, reachable history, and build output", async () => {
    const repositoryPath = await createRepository();
    const canaries = [
      { id: "history", value: "CANARY_HISTORY_55" },
      { id: "ref", value: "CANARY_REF_63" },
      { id: "build", value: "CANARY_BUILD_29" },
    ] as const;
    await git(repositoryPath, ["checkout", "-b", canaries[1].value]);
    await writeFile(path.join(repositoryPath, "protected-history.txt"), canaries[0].value, "utf8");
    await git(repositoryPath, ["add", "protected-history.txt"]);
    await git(repositoryPath, ["commit", "-m", "hidden protected history"]);
    await git(repositoryPath, ["checkout", "main"]);
    await writeFile(path.join(repositoryPath, "dist/output.txt"), canaries[2].value, "utf8");

    const report = await scanRepositoryForProtectedCanaries({
      repositoryPath,
      buildOutputPaths: ["dist"],
      canaries,
    });

    expect(report.clean).toBe(false);
    expect(report.matches).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ canaryId: "history", surface: "reachable-object" }),
        expect.objectContaining({ canaryId: "ref", surface: "refs" }),
        expect.objectContaining({ canaryId: "build", surface: "build-output" }),
      ]),
    );
  });
});
