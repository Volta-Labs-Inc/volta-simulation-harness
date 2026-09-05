import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { TRUSTED_SERVICE_ORIGIN } from "../src/cli.js";
import { createLocalPilotManifest, runLocalCli } from "../src/local-cli.js";

const roots: string[] = [];

function io() {
  const out: string[] = [];
  const error: string[] = [];
  return {
    out,
    error,
    value: {
      writeOut: (message: string) => out.push(message),
      writeError: (message: string) => error.push(message),
    },
  };
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { force: true, recursive: true });
});

describe("local-only student command", () => {
  it("accepts the generated checkout manifest without changing the production origin", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "volta-local-cli-"));
    roots.push(root);
    fs.mkdirSync(path.join(root, ".volta-sim"));
    const manifest = createLocalPilotManifest({
      assignmentId: "local-public-example",
      assignmentRoot: fs.realpathSync(root),
      serviceOrigin: "http://127.0.0.1:43123",
      issuedAt: "2026-09-04T16:00:00.000Z",
      nonce: "a".repeat(32),
    });
    fs.writeFileSync(
      path.join(root, ".volta-sim", "local-pilot.json"),
      `${JSON.stringify(manifest)}\n`,
    );
    const output = io();

    expect(
      await runLocalCli(["--manifest", ".volta-sim/local-pilot.json", "--help"], {
        cwd: root,
        io: output.value,
      }),
    ).toBe(0);
    expect(output.out.join("\n")).toContain("Volta Simulation Harness student CLI");
    expect(TRUSTED_SERVICE_ORIGIN).toBe("https://student-service.invalid");
  });

  it("rejects an origin override, a non-loopback manifest, and a tampered manifest", async () => {
    const missing = io();
    expect(await runLocalCli(["status"], { io: missing.value })).toBe(1);
    expect(missing.error.join("\n")).toContain("volta-sim-local --manifest");
    expect(() =>
      createLocalPilotManifest({
        assignmentId: "local-public-example",
        assignmentRoot: "/tmp/example",
        serviceOrigin: "https://student-service.example",
        issuedAt: "2026-09-04T16:00:00.000Z",
        nonce: "b".repeat(32),
      }),
    ).toThrow(/loopback/u);

    const root = fs.mkdtempSync(path.join(os.tmpdir(), "volta-local-cli-tampered-"));
    roots.push(root);
    fs.mkdirSync(path.join(root, ".volta-sim"));
    const valid = createLocalPilotManifest({
      assignmentId: "local-public-example",
      assignmentRoot: fs.realpathSync(root),
      serviceOrigin: "http://127.0.0.1:43123",
      issuedAt: "2026-09-04T16:00:00.000Z",
      nonce: "c".repeat(32),
    });
    fs.writeFileSync(
      path.join(root, ".volta-sim", "local-pilot.json"),
      JSON.stringify({ ...valid, serviceOrigin: "http://127.0.0.1:43124" }),
    );
    const tampered = io();
    expect(
      await runLocalCli(["--manifest", ".volta-sim/local-pilot.json", "status"], {
        cwd: root,
        io: tampered.value,
      }),
    ).toBe(1);
    expect(tampered.error.join("\n")).toMatch(/does not match|invalid/u);
  });
});
