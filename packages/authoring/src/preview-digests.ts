import { createHash } from "node:crypto";
import { CaseVersionSourceSchema } from "@volta-sim/contracts";

export interface CasePreviewDigests {
  readonly visibleBundleDigest: `sha256:${string}`;
  readonly protectedPackageDigest: `sha256:${string}`;
  readonly caseVersionDigest: `sha256:${string}`;
}

function serializePreviewValue(value: unknown, ancestors: Set<object>): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Preview values must use finite numbers");
    return JSON.stringify(Object.is(value, -0) ? 0 : value);
  }
  if (Array.isArray(value)) {
    if (ancestors.has(value)) throw new TypeError("Preview values cannot contain cycles");
    ancestors.add(value);
    const result = `[${value.map((item) => serializePreviewValue(item, ancestors)).join(",")}]`;
    ancestors.delete(value);
    return result;
  }
  if (typeof value === "object") {
    if (ancestors.has(value)) throw new TypeError("Preview values cannot contain cycles");
    const prototype = Object.getPrototypeOf(value) as object | null;
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError("Preview values must contain only plain objects and arrays");
    }
    ancestors.add(value);
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, item]) => {
        if (item === undefined) throw new TypeError(`Preview value at ${key} is undefined`);
        return `${JSON.stringify(key)}:${serializePreviewValue(item, ancestors)}`;
      });
    ancestors.delete(value);
    return `{${entries.join(",")}}`;
  }
  throw new TypeError(`Unsupported preview value: ${typeof value}`);
}

export function previewDigest(value: unknown): `sha256:${string}` {
  const serialized = serializePreviewValue(value, new Set<object>());
  return `sha256:${createHash("sha256").update(serialized).digest("hex")}`;
}

export function createPreviewDigests(input: unknown): CasePreviewDigests {
  const source = CaseVersionSourceSchema.parse(input);
  const visibleBundleDigest = previewDigest(source.visible);
  const protectedPackageDigest = previewDigest(source.protected);
  const caseVersionDigest = previewDigest({
    approvedAt: source.approvedAt,
    approvedBy: source.approvedBy,
    caseId: source.visible.caseId,
    methodologySnapshot: source.methodologySnapshot,
    protectedPackageDigest,
    requirementsSnapshot: source.requirementsSnapshot,
    status: source.status,
    versionLabel: source.visible.versionLabel,
    visibleBundleDigest,
  });
  return { visibleBundleDigest, protectedPackageDigest, caseVersionDigest };
}
