import {
  CaseVersionSourceSchema,
  type ApprovedCaseVersionSource,
} from "@volta-sim/contracts";
import { z } from "zod";
import { sha256Digest } from "./canonical.js";
import { createCaseVersionDigests, type CaseVersionDigests } from "./case-version.js";
import { deepFreeze, type DeepReadonly } from "./immutable.js";

export interface PublishedCase {
  readonly source: DeepReadonly<ApprovedCaseVersionSource>;
  readonly digests: Readonly<CaseVersionDigests>;
}

const DigestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);

export const CasePublicationReceiptSchema = z
  .object({
    kind: z.literal("validated-case-import"),
    source: CaseVersionSourceSchema,
    recordedVisibleBundleDigest: DigestSchema,
    recordedProtectedPackageDigest: DigestSchema,
    validationDigest: DigestSchema,
  })
  .strict();

export type CasePublicationReceipt = z.infer<typeof CasePublicationReceiptSchema>;

function receiptContent(receipt: Omit<CasePublicationReceipt, "validationDigest">): unknown {
  return receipt;
}

export function publishCase(input: unknown): DeepReadonly<PublishedCase> {
  const receipt = CasePublicationReceiptSchema.parse(input);
  const source = receipt.source;
  if (source.status !== "approved") {
    throw new Error("Draft cases cannot be published before explicit approval");
  }
  const digests = createCaseVersionDigests(source);
  if (
    receipt.recordedVisibleBundleDigest !== digests.visibleBundleDigest ||
    receipt.recordedProtectedPackageDigest !== digests.protectedPackageDigest
  ) {
    throw new Error("Publication receipt hashes do not match the approved case");
  }
  const content = {
    kind: receipt.kind,
    source,
    recordedVisibleBundleDigest: receipt.recordedVisibleBundleDigest,
    recordedProtectedPackageDigest: receipt.recordedProtectedPackageDigest,
  };
  if (receipt.validationDigest !== sha256Digest(receiptContent(content))) {
    throw new Error("Publication receipt validation digest does not match its contents");
  }
  return deepFreeze({ source, digests });
}

export function verifyPublishedCase(input: PublishedCase): DeepReadonly<PublishedCase> {
  const source = CaseVersionSourceSchema.parse(input.source);
  if (source.status !== "approved") {
    throw new Error("A published case must retain its explicit approval");
  }
  const expected = createCaseVersionDigests(source);
  if (
    input.digests.visibleBundleDigest !== expected.visibleBundleDigest ||
    input.digests.protectedPackageDigest !== expected.protectedPackageDigest ||
    input.digests.caseVersionDigest !== expected.caseVersionDigest
  ) {
    throw new Error("Published case digest verification failed");
  }
  return deepFreeze({ source, digests: expected });
}
