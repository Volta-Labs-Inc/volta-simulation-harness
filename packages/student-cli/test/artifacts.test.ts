import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

import {
  ArtifactAccessError,
  captureSelectedArtifacts,
  validateSelectedArtifactPath,
} from "../src/artifacts.js";

const temporaryRoots: string[] = [];

function temporaryRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "volta-sim-artifacts-"));
  temporaryRoots.push(root);
  return root;
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("explicit artifact capture", () => {
  it("captures only explicitly selected supported UTF-8 text", async () => {
    const root = temporaryRoot();
    fs.mkdirSync(path.join(root, "results"));
    fs.writeFileSync(path.join(root, "results", "proposal.md"), "# Bounded pilot\n");
    fs.writeFileSync(path.join(root, "unselected-secret.txt"), "PRIVATE-CANARY");

    const captured = await captureSelectedArtifacts(root, ["results/proposal.md"]);

    expect(captured).toHaveLength(1);
    expect(captured[0]).toMatchObject({
      path: "results/proposal.md",
      mediaType: "text/markdown",
      byteLength: 16,
      content: "# Bounded pilot\n",
    });
    expect(JSON.stringify(captured)).not.toContain("PRIVATE-CANARY");
  });

  it.each([
    ["absolute", "/tmp/result.txt"],
    ["windows absolute", "C:/result.txt"],
    ["UNC", "//server/share/result.txt"],
    ["backslash", "results\\result.txt"],
    ["traversal", "../result.txt"],
    ["dot segment", "results/./result.txt"],
    ["dot control", ".claude/transcript.txt"],
    ["agent instruction", "AGENTS.md"],
    ["Git pathspec magic", ":(glob)**/*.md"],
    ["Windows device", "results/CON.txt"],
    ["Windows alternate stream", "results/answer.txt:private.txt"],
    ["C0 control", "results/bad\u001f.txt"],
    ["C1 control", "results/bad\u0085.txt"],
    ["Unicode line separator", "results/bad\u2028.txt"],
    ["Unicode paragraph separator", "results/bad\u2029.txt"],
  ])("rejects %s paths before reading", (_label, selectedPath) => {
    expect(() => validateSelectedArtifactPath(selectedPath)).toThrow(ArtifactAccessError);
  });

  it("rejects symlinks, submodules, devices, oversized files, unsupported types, and invalid UTF-8", async () => {
    const root = temporaryRoot();
    fs.mkdirSync(path.join(root, "results"));
    fs.writeFileSync(path.join(root, "outside.txt"), "outside");
    fs.symlinkSync(path.join(root, "outside.txt"), path.join(root, "results", "link.txt"));

    fs.mkdirSync(path.join(root, "vendor"));
    fs.writeFileSync(path.join(root, "vendor", ".git"), "gitdir: elsewhere");
    fs.writeFileSync(path.join(root, "vendor", "answer.txt"), "submodule content");

    execFileSync("mkfifo", [path.join(root, "results", "pipe.txt")]);
    fs.writeFileSync(path.join(root, "results", "large.txt"), Buffer.alloc(1_000_001, 0x61));
    fs.writeFileSync(path.join(root, "results", "image.png"), "not an image");
    fs.writeFileSync(path.join(root, "results", "invalid.txt"), Buffer.from([0xc3, 0x28]));

    for (const selectedPath of [
      "results/link.txt",
      "vendor/answer.txt",
      "results/pipe.txt",
      "results/large.txt",
      "results/image.png",
      "results/invalid.txt",
    ]) {
      await expect(captureSelectedArtifacts(root, [selectedPath])).rejects.toBeInstanceOf(
        ArtifactAccessError,
      );
    }
  });

  it("preserves hostile-looking bytes as inert text without fetching or executing them", async () => {
    const root = temporaryRoot();
    fs.mkdirSync(path.join(root, "results"));
    const hostile = '=HYPERLINK("https://canary.invalid")\n<script>throw 1</script>\n![x](https://canary.invalid/x)';
    fs.writeFileSync(path.join(root, "results", "hostile.csv"), hostile);
    const fetchBefore = globalThis.fetch;
    let fetched = false;
    globalThis.fetch = (() => {
      fetched = true;
      throw new Error("network access is forbidden");
    }) as typeof fetch;
    try {
      const [artifact] = await captureSelectedArtifacts(root, ["results/hostile.csv"]);
      expect(artifact?.content).toBe(hostile);
      expect(fetched).toBe(false);
    } finally {
      globalThis.fetch = fetchBefore;
    }
  });
});
