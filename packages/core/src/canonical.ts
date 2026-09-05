import { createHash } from "node:crypto";

function serialize(value: unknown, ancestors: Set<object>): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Canonical values must use finite numbers");
    return JSON.stringify(Object.is(value, -0) ? 0 : value);
  }
  if (Array.isArray(value)) {
    if (ancestors.has(value)) throw new TypeError("Canonical values cannot contain cycles");
    ancestors.add(value);
    const result = `[${value.map((item) => serialize(item, ancestors)).join(",")}]`;
    ancestors.delete(value);
    return result;
  }
  if (typeof value === "object") {
    if (ancestors.has(value)) throw new TypeError("Canonical values cannot contain cycles");
    const prototype = Object.getPrototypeOf(value) as object | null;
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError("Canonical values must contain only plain objects and arrays");
    }
    ancestors.add(value);
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, item]) => {
        if (item === undefined) throw new TypeError(`Canonical value at ${key} is undefined`);
        return `${JSON.stringify(key)}:${serialize(item, ancestors)}`;
      });
    ancestors.delete(value);
    return `{${entries.join(",")}}`;
  }
  throw new TypeError(`Unsupported canonical value: ${typeof value}`);
}

export function canonicalSerialize(value: unknown): string {
  return serialize(value, new Set<object>());
}

export function sha256Digest(value: unknown): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(canonicalSerialize(value)).digest("hex")}`;
}
