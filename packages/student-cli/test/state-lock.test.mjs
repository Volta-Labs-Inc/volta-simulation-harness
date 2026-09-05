import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { setTimeout } from "node:timers";
import { URL } from "node:url";
import { afterEach, expect, test } from "vitest";
import { withMockStudentStateLock } from "../src/state-lock.ts";

const roots = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

test("a killed writer releases ownership without stealing a live writer's lock", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "volta-lock-recovery-"));
  roots.push(root);
  const moduleUrl = new URL("../src/state-lock.ts", import.meta.url).href;
  // Source imports compiled control-files.js; use dist so the child runs the shipped path.
  const distUrl = moduleUrl.replace("/src/state-lock.ts", "/dist/state-lock.js");
  const child = spawn(process.execPath, ["--input-type=module", "-e", `
    import { withMockStudentStateLock } from ${JSON.stringify(distUrl)};
    await withMockStudentStateLock(${JSON.stringify(root)}, "state.json", async () => {
      process.stdout.write("locked");
      await new Promise(resolve => setTimeout(resolve, 30000));
    });
  `], { stdio: ["ignore", "pipe", "pipe"] });
  try {
    await once(child.stdout, "data");
    let entered = false;
    const waiting = withMockStudentStateLock(root, "state.json", async () => { entered = true; });
    // A turn of the event loop proves that a live owner is not stolen.
    await new Promise(resolve => setTimeout(resolve, 30));
    expect(entered).toBe(false);
    const closed = once(child, "exit");
    child.kill("SIGKILL");
    await closed;
    await waiting;
    expect(entered).toBe(true);
    expect(fs.existsSync(path.join(root, "state.json.lock"))).toBe(false);
  } finally { child.kill("SIGKILL"); }
}, 12000);

test("separate processes preserve every acknowledged update", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "volta-lock-processes-"));
  roots.push(root);
  fs.writeFileSync(path.join(root, "state.json"), "0");
  const distUrl = new URL("../dist/state-lock.js", import.meta.url).href;
  const writers = Array.from({ length: 8 }, () => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", `
      import fs from "node:fs/promises";
      import { withMockStudentStateLock } from ${JSON.stringify(distUrl)};
      await withMockStudentStateLock(${JSON.stringify(root)}, "state.json", async () => {
        const file = ${JSON.stringify(path.join(root, "state.json"))};
        const before = Number(await fs.readFile(file, "utf8"));
        await new Promise(resolve => setTimeout(resolve, 5));
        await fs.writeFile(file, String(before + 1));
      });
    `], { stdio: ["ignore", "ignore", "pipe"] });
    let errors = "";
    child.stderr.on("data", chunk => { errors += String(chunk); });
    child.once("error", reject);
    child.once("exit", code => code === 0 ? resolve() : reject(new Error(errors)));
  }));
  await Promise.all(writers);
  expect(fs.readFileSync(path.join(root, "state.json"), "utf8")).toBe("8");
  expect(fs.readdirSync(root)).toEqual(["state.json"]);
});
