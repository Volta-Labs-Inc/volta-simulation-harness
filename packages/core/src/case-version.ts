import { CaseVersionSourceSchema, type CaseVersionSource } from "@volta-sim/contracts";
import { sha256Digest } from "./canonical.js";

export interface CaseVersionDigests {
  readonly visibleBundleDigest: `sha256:${string}`;
  readonly protectedPackageDigest: `sha256:${string}`;
  readonly caseVersionDigest: `sha256:${string}`;
}

export function createCaseVersionDigests(input: unknown): CaseVersionDigests {
  const source = CaseVersionSourceSchema.parse(input);
  const visibleBundleDigest = sha256Digest(source.visible);
  const protectedPackageDigest = sha256Digest(source.protected);
  const caseVersionDigest = sha256Digest({
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

export function assertCaseVersionDigest(
  source: CaseVersionSource,
  expectedDigest: string,
): CaseVersionDigests {
  const digests = createCaseVersionDigests(source);
  if (digests.caseVersionDigest !== expectedDigest) {
    throw new Error("The case material has changed and must be published as a new approved version");
  }
  return digests;
}
