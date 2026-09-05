import { createHash } from "node:crypto";
import {
  AssignmentProvisioningRequestSchema,
  type AssignmentProvisioningRequest,
  type AssignmentRecord,
  type CollaboratorPermission,
  type CleanRepositoryScanReceipt,
  type ProvisioningFailureCode,
  type ProvisioningConfiguration,
  type ProvisioningState,
  type PublishedCaseBinding,
  type StudentServiceReadiness,
} from "./types.js";
import { cleanRepositoryScanReceiptId } from "./repository-scan.js";

function digestText(value: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function requestContent(request: AssignmentProvisioningRequest): string {
  return JSON.stringify({
    caseVersionDigest: request.caseVersionDigest,
    repositoryOwner: request.repositoryOwner.toLowerCase(),
    studentBundleDigest: request.studentBundleDigest,
    studentManifestDigest: request.studentMaterialization.manifestDigest,
    studentGithubUserId: request.studentGithubUserId,
    templateCommit: request.templateCommit,
  });
}

const cleanScanReceiptKeys = [
  "assignmentId",
  "canarySetDigest",
  "generation",
  "materializedCommit",
  "materializedFilesDigest",
  "providerRepositoryId",
  "receiptId",
  "repositoryName",
  "repositoryOwner",
  "repositoryStateDigest",
  "scannedAt",
  "scannerVersion",
  "stage",
  "studentBundleDigest",
  "studentManifestDigest",
  "templateCommit",
].sort();

export class ProvisioningConflictError extends Error {}

export class InvalidCleanScanReceiptError extends ProvisioningConflictError {}

export interface ProvisioningScanPolicy {
  readonly trustedScannerVersions: readonly string[];
  readonly now: () => string;
  readonly maximumAgeMilliseconds?: number;
  readonly maximumFutureSkewMilliseconds?: number;
}

export class InMemoryProvisioningStore {
  readonly #publishedCases = new Map<string, PublishedCaseBinding>();
  readonly #assignments = new Map<string, AssignmentRecord>();
  readonly #assignmentByBinding = new Map<string, string>();
  readonly #scanReceipts = new Map<string, CleanRepositoryScanReceipt>();
  readonly #operationBindings = new Map<
    string,
    { requestDigest: `sha256:${string}`; assignmentId: string }
  >();
  readonly #trustedScannerVersions: ReadonlySet<string>;
  readonly #scanNow: () => string;
  readonly #maximumScanAgeMilliseconds: number;
  readonly #maximumScanFutureSkewMilliseconds: number;

  constructor(
    publishedCases: readonly PublishedCaseBinding[],
    readonly configuration: ProvisioningConfiguration,
    scanPolicy: ProvisioningScanPolicy = {
      trustedScannerVersions: ["git-all-reachable-v1", "mock-provider-snapshot-v1"],
      now: () => new Date().toISOString(),
    },
  ) {
    for (const binding of publishedCases) {
      this.#publishedCases.set(binding.caseVersionDigest, structuredClone(binding));
    }
    if (scanPolicy.trustedScannerVersions.length === 0) {
      throw new ProvisioningConflictError("At least one scanner version must be trusted");
    }
    this.#trustedScannerVersions = new Set(scanPolicy.trustedScannerVersions);
    this.#scanNow = scanPolicy.now;
    this.#maximumScanAgeMilliseconds = scanPolicy.maximumAgeMilliseconds ?? 5 * 60_000;
    this.#maximumScanFutureSkewMilliseconds =
      scanPolicy.maximumFutureSkewMilliseconds ?? 60_000;
  }

  reserve(input: unknown): AssignmentRecord {
    const request = AssignmentProvisioningRequestSchema.parse(input);
    if (
      request.repositoryOwner.toLowerCase() !== this.configuration.repositoryOwner.toLowerCase() ||
      request.templateCommit !== this.configuration.templateCommit
    ) {
      throw new ProvisioningConflictError(
        "Assignment destination must match trusted provisioning configuration",
      );
    }
    const published = this.#publishedCases.get(request.caseVersionDigest);
    if (
      published === undefined ||
      published.studentBundleDigest !== request.studentBundleDigest ||
      published.studentManifestDigest !== request.studentMaterialization.manifestDigest
    ) {
      throw new ProvisioningConflictError(
        "Assignment requires an exact locally known published case and student bundle",
      );
    }
    const requestDigest = digestText(requestContent(request));
    const priorOperation = this.#operationBindings.get(request.operationId);
    if (priorOperation !== undefined) {
      if (priorOperation.requestDigest !== requestDigest) {
        throw new ProvisioningConflictError("Provisioning operation payload conflict");
      }
      return this.get(priorOperation.assignmentId);
    }

    const bindingKey = `${request.caseVersionDigest}:${request.studentGithubUserId}`;
    const existingAssignmentId = this.#assignmentByBinding.get(bindingKey);
    if (existingAssignmentId !== undefined) {
      const existing = this.get(existingAssignmentId);
      if (existing.requestDigest !== requestDigest) {
        throw new ProvisioningConflictError("Assignment binding already has another payload");
      }
      this.#operationBindings.set(request.operationId, { requestDigest, assignmentId: existing.assignmentId });
      return existing;
    }

    const identityHash = createHash("sha256").update(bindingKey, "utf8").digest("hex").slice(0, 24);
    const assignmentId = `assignment-${identityHash}`;
    const record: AssignmentRecord = {
      assignmentId,
      operationId: request.operationId,
      requestDigest,
      caseVersionDigest: request.caseVersionDigest as `sha256:${string}`,
      studentBundleDigest: request.studentBundleDigest as `sha256:${string}`,
      studentMaterialization: structuredClone(request.studentMaterialization),
      templateCommit: request.templateCommit,
      studentGithubUserId: request.studentGithubUserId,
      repositoryOwner: request.repositoryOwner,
      repositoryName: `volta-sim-${identityHash}`,
      state: "provisioning",
    };
    this.#assignments.set(assignmentId, record);
    this.#assignmentByBinding.set(bindingKey, assignmentId);
    this.#operationBindings.set(request.operationId, { requestDigest, assignmentId });
    return structuredClone(record);
  }

  get(assignmentId: string): AssignmentRecord {
    const record = this.#assignments.get(assignmentId);
    if (record === undefined) throw new Error("Assignment not found");
    return structuredClone(record);
  }

  hasOperation(operationId: string): boolean {
    return this.#operationBindings.has(operationId);
  }

  updateRepository(
    assignmentId: string,
    providerRepositoryId: string,
    materializedCommit: string,
  ): AssignmentRecord {
    const current = this.get(assignmentId);
    if (
      (current.providerRepositoryId !== undefined &&
        current.providerRepositoryId !== providerRepositoryId) ||
      (current.materializedCommit !== undefined &&
        current.materializedCommit !== materializedCommit)
    ) {
      throw new ProvisioningConflictError("Repository snapshot identity cannot be replaced");
    }
    return this.#update(assignmentId, {
      providerRepositoryId,
      materializedCommit,
      state: current.state === "provisioning" ? "repository_created" : current.state,
    }, true);
  }

  recordCleanScan(
    assignmentId: string,
    receipt: CleanRepositoryScanReceipt,
  ): AssignmentRecord {
    const current = this.get(assignmentId);
    const expectedFiles = current.studentMaterialization.files.map(
      ({ path, byteLength, digest }) => ({ path, byteLength, digest }),
    );
    const expectedFilesDigest = digestText(JSON.stringify(expectedFiles));
    const scannedAt = Date.parse(receipt.scannedAt);
    const recordedAt = Date.parse(this.#scanNow());
    const expectedReceiptId = cleanRepositoryScanReceiptId(receipt);
    if (
      JSON.stringify(Object.keys(receipt).sort()) !== JSON.stringify(cleanScanReceiptKeys) ||
      receipt.assignmentId !== current.assignmentId ||
      receipt.providerRepositoryId !== current.providerRepositoryId ||
      receipt.repositoryOwner.toLowerCase() !== current.repositoryOwner.toLowerCase() ||
      receipt.repositoryName.toLowerCase() !== current.repositoryName.toLowerCase() ||
      receipt.templateCommit !== current.templateCommit ||
      receipt.materializedCommit !== current.materializedCommit ||
      receipt.studentBundleDigest !== current.studentBundleDigest ||
      receipt.studentManifestDigest !== current.studentMaterialization.manifestDigest ||
      receipt.materializedFilesDigest !== expectedFilesDigest ||
      !Number.isInteger(receipt.generation) ||
      receipt.generation < 1 ||
      receipt.receiptId !== expectedReceiptId ||
      !/^sha256:[a-f0-9]{64}$/.test(receipt.repositoryStateDigest) ||
      !/^sha256:[a-f0-9]{64}$/.test(receipt.canarySetDigest) ||
      !this.#trustedScannerVersions.has(receipt.scannerVersion) ||
      Number.isNaN(scannedAt) ||
      Number.isNaN(recordedAt) ||
      scannedAt < recordedAt - this.#maximumScanAgeMilliseconds ||
      scannedAt > recordedAt + this.#maximumScanFutureSkewMilliseconds
    ) {
      throw new InvalidCleanScanReceiptError("Clean scan receipt does not match the assignment snapshot");
    }
    const existingReceipt = this.#scanReceipts.get(receipt.receiptId);
    if (
      existingReceipt !== undefined &&
      JSON.stringify(existingReceipt) !== JSON.stringify(receipt)
    ) {
      throw new InvalidCleanScanReceiptError("Clean scan receipt identity cannot be reused");
    }
    if (receipt.stage === "pre_invitation") {
      if (existingReceipt !== undefined && current.cleanScanReceipt?.receiptId === receipt.receiptId) {
        return current;
      }
      if (
        !["repository_created", "invitation_pending"].includes(current.state) ||
        current.invitationId !== undefined ||
        current.invitationAccepted === true ||
        receipt.generation !== (current.cleanScanReceipt?.generation ?? 0) + 1
      ) {
        throw new InvalidCleanScanReceiptError(
          "Invitation scan generation cannot replace a confirmed invitation",
        );
      }
      this.#scanReceipts.set(receipt.receiptId, structuredClone(receipt));
      return this.#update(assignmentId, {
        cleanScanReceipt: structuredClone(receipt),
        state: current.state,
      });
    }
    if (receipt.stage !== "pre_ready" || current.cleanScanReceipt === undefined) {
      throw new InvalidCleanScanReceiptError("Readiness scan requires a clean pre-invitation scan");
    }
    if (existingReceipt !== undefined && current.readinessScanReceipt?.receiptId === receipt.receiptId) {
      return current;
    }
    if (
      current.state !== "invitation_pending" ||
      current.invitationAccepted !== true ||
      current.invitationId === undefined
    ) {
      throw new InvalidCleanScanReceiptError(
        "Readiness scan requires an accepted invitation readback",
      );
    }
    if (
      receipt.generation !== current.cleanScanReceipt.generation ||
      receipt.scannerVersion !== current.cleanScanReceipt.scannerVersion ||
      Date.parse(receipt.scannedAt) < Date.parse(current.cleanScanReceipt.scannedAt)
    ) {
      throw new InvalidCleanScanReceiptError(
        "Readiness scan does not match the invitation scan generation",
      );
    }
    this.#scanReceipts.set(receipt.receiptId, structuredClone(receipt));
    return this.#update(assignmentId, {
      readinessScanReceipt: structuredClone(receipt),
      state: current.state,
    });
  }

  updateInvitation(
    assignmentId: string,
    currentLogin: string,
    invitationId?: string,
  ): AssignmentRecord {
    const current = this.get(assignmentId);
    if (current.cleanScanReceipt === undefined) {
      throw new ProvisioningConflictError("Invitation requires an exact clean repository scan");
    }
    return this.#update(assignmentId, {
      currentLogin,
      ...(invitationId === undefined ? {} : { invitationId }),
      state: "invitation_pending",
    }, true);
  }

  recordInvitationAcceptance(
    assignmentId: string,
    currentLogin: string,
    invitationId: string,
  ): AssignmentRecord {
    const current = this.get(assignmentId);
    if (
      current.state !== "invitation_pending" ||
      current.invitationId !== invitationId ||
      current.currentLogin?.toLowerCase() !== currentLogin.toLowerCase()
    ) {
      throw new ProvisioningConflictError(
        "Invitation acceptance does not match the pending assignment",
      );
    }
    return this.#update(assignmentId, {
      invitationAccepted: true,
      state: current.state,
    }, true);
  }

  markReady(
    assignmentId: string,
    permission: CollaboratorPermission,
    readyAt: string,
  ): AssignmentRecord {
    const current = this.get(assignmentId);
    if (
      current.cleanScanReceipt === undefined ||
      current.readinessScanReceipt === undefined ||
      current.cleanScanReceipt.canarySetDigest !==
        current.readinessScanReceipt.canarySetDigest ||
      current.cleanScanReceipt.repositoryStateDigest !==
        current.readinessScanReceipt.repositoryStateDigest ||
      current.cleanScanReceipt.scannerVersion !==
        current.readinessScanReceipt.scannerVersion ||
      current.cleanScanReceipt.generation !== current.readinessScanReceipt.generation ||
      Date.parse(current.readinessScanReceipt.scannedAt) <
        Date.parse(current.cleanScanReceipt.scannedAt)
    ) {
      throw new ProvisioningConflictError("Readiness requires an exact clean repository scan");
    }
    return this.#update(assignmentId, {
      collaboratorPermission: permission,
      invitationAccepted: true,
      readyAt,
      state: "ready",
    }, true);
  }

  recordFailure(
    assignmentId: string,
    code: ProvisioningFailureCode,
    failedAt: string,
  ): AssignmentRecord {
    const current = this.get(assignmentId);
    return this.#update(assignmentId, {
      state: current.state,
      failure: { code, failedAt },
    });
  }

  studentReadiness(assignmentId: string, githubUserId: string): StudentServiceReadiness {
    const record = this.#assignments.get(assignmentId);
    if (
      record === undefined ||
      record.studentGithubUserId !== githubUserId ||
      record.state !== "ready" ||
      record.invitationAccepted !== true ||
      record.collaboratorPermission !== "push"
      || record.cleanScanReceipt === undefined
      || record.readinessScanReceipt === undefined
    ) {
      return { ready: false };
    }
    return {
      ready: true,
      assignmentId: record.assignmentId,
      repositoryOwner: record.repositoryOwner,
      repositoryName: record.repositoryName,
    };
  }

  #update(
    assignmentId: string,
    changes: Partial<AssignmentRecord> & { state: ProvisioningState },
    clearFailure = false,
  ): AssignmentRecord {
    const current = this.#assignments.get(assignmentId);
    if (current === undefined) throw new Error("Assignment not found");
    const updated = { ...current, ...changes } as AssignmentRecord;
    if (clearFailure) delete (updated as { failure?: unknown }).failure;
    this.#assignments.set(assignmentId, updated);
    return structuredClone(updated);
  }
}
