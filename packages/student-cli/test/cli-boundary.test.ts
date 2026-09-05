import fs from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FIXED_SESSION_PATH, runCli, TRUSTED_SERVICE_ORIGIN } from "../src/cli.js";
import type { StudentServiceClient } from "../src/types.js";
import { createStudentFixture } from "./fixture.js";

const roots: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("fixed CLI destinations", () => {
  it.each(["root", "session", "service"])(
    "rejects a caller-selected --%s before token access or a service request",
    async (flag) => {
      const fixture = createStudentFixture();
      roots.push(fixture.root, fixture.serviceRoot);
      const open = vi.spyOn(fs.promises, "open");
      const execute = vi.fn<StudentServiceClient["execute"]>();
      const errors: string[] = [];
      const result = await runCli(["status", `--${flag}`, "https://canary.invalid"], {
        assignmentRoot: fixture.root,
        client: { execute },
        io: { writeOut: () => undefined, writeError: (value) => errors.push(value) },
      });
      expect(result).toBe(1);
      expect(errors.join("\n")).toMatch(/not available/i);
      expect(open).not.toHaveBeenCalled();
      expect(execute).not.toHaveBeenCalled();
    },
  );

  it("uses one fixed gitignored session path and a build-owned service origin", () => {
    expect(FIXED_SESSION_PATH).toBe(".volta-sim/session.json");
    expect(TRUSTED_SERVICE_ORIGIN).toBe("https://student-service.invalid");
  });

  it("rejects oversized operation IDs and repeated values before service or token access", async () => {
    const fixture = createStudentFixture();
    roots.push(fixture.root, fixture.serviceRoot);
    const open = vi.spyOn(fs.promises, "open");
    const execute = vi.fn<StudentServiceClient["execute"]>();
    const io = { writeOut: () => undefined, writeError: () => undefined };
    await expect(
      runCli(["login", "--operation-id", "a".repeat(161)], {
        assignmentRoot: fixture.root,
        client: { execute },
        io,
      }),
    ).resolves.toBe(1);
    const repeatedArtifacts = Array.from({ length: 51 }, (_, index) => [
      "--artifact",
      `results/${index}.txt`,
    ]).flat();
    await expect(
      runCli(["submit", "--operation-id", "submit-1", ...repeatedArtifacts], {
        assignmentRoot: fixture.root,
        client: { execute },
        io,
      }),
    ).resolves.toBe(1);
    expect(open).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });
});
