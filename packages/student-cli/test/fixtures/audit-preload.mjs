/* global process */
import fs from "node:fs";

const auditPath = process.env.VOLTA_SIM_AUDIT_LOG;
const append = fs.appendFileSync.bind(fs);

function record(kind, value) {
  if (auditPath !== undefined) append(auditPath, `${kind}\t${String(value)}\n`);
}

for (const method of [
  "readFile",
  "open",
  "lstat",
  "realpath",
  "writeFile",
  "mkdir",
  "chmod",
  "rm",
  "rename",
]) {
  const original = fs.promises[method].bind(fs.promises);
  fs.promises[method] = async (target, ...args) => {
    record(`fs.${method}`, target);
    return original(target, ...args);
  };
}

const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  record("network", typeof input === "string" ? input : input.url);
  return originalFetch(input, init);
};
