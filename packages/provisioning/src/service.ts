import {
  GitHubAdapterError,
  InvitationReadbackSchema,
  RepositoryReadbackSchema,
  type GitHubProvisioningAdapter,
  type InvitationReadback,
  type RepositoryIdentity,
  type RepositoryReadback,
} from "./github.js";
import { createHash } from "node:crypto";
import {
  assertStudentMaterializationIsCanaryFree,
  cleanRepositoryScanReceiptId,
  RepositoryScanError,
  type ProtectedCanarySource,
  type RepositoryLeakScanner,
} from "./repository-scan.js";
import {
  InvalidCleanScanReceiptError,
  type InMemoryProvisioningStore,
} from "./store.js";
import {
  AssignmentProvisioningRequestSchema,
  type AssignmentProvisioningRequest,
  type AssignmentRecord,
  type CleanRepositoryScanReceipt,
  type ProvisioningFailureCode,
} from "./types.js";

export interface ProvisioningLogEvent {
  readonly assignmentId: string;
  readonly action:
    | "reconcile-repository"
    | "create-repository"
    | "scan-repository"
    | "invite"
    | "readback";
  readonly outcome: "started" | "succeeded" | "pending" | "failed";
  readonly code?: ProvisioningFailureCode;
}

function digestMaterializedFiles(repository: RepositoryReadback): `sha256:${string}` {
  return `sha256:${createHash("sha256")
    .update(JSON.stringify(repository.materializedFiles), "utf8")
    .digest("hex")}`;
}

function scanReceiptMatchesRepository(
  receipt: AssignmentRecord["cleanScanReceipt"] | AssignmentRecord["readinessScanReceipt"],
  record: AssignmentRecord,
  repository: RepositoryReadback,
  stage: "pre_invitation" | "pre_ready",
  canarySetDigest: `sha256:${string}`,
  generation: number,
): boolean {
  return (
    receipt !== undefined &&
    receipt.stage === stage &&
    receipt.generation === generation &&
    receipt.assignmentId === record.assignmentId &&
    receipt.providerRepositoryId === repository.providerRepositoryId &&
    receipt.repositoryOwner.toLowerCase() === repository.owner.toLowerCase() &&
    receipt.repositoryName.toLowerCase() === repository.name.toLowerCase() &&
    receipt.templateCommit === repository.templateCommit &&
    receipt.materializedCommit === repository.materializedCommit &&
    receipt.studentBundleDigest === repository.studentBundleDigest &&
    receipt.studentManifestDigest === repository.studentManifestDigest &&
    receipt.materializedFilesDigest === digestMaterializedFiles(repository) &&
    receipt.canarySetDigest === canarySetDigest
  );
}

export type ProvisioningLogger = (event: ProvisioningLogEvent) => void;

function identity(record: AssignmentRecord): RepositoryIdentity {
  return { owner: record.repositoryOwner, name: record.repositoryName };
}

function readbackMatchesReservation(
  repository: RepositoryReadback,
  record: AssignmentRecord,
): boolean {
  const expectedFiles = record.studentMaterialization.files.map(
    ({ path, byteLength, digest }) => ({ path, byteLength, digest }),
  );
  return (
    repository.private &&
    repository.owner.toLowerCase() === record.repositoryOwner.toLowerCase() &&
    repository.name.toLowerCase() === record.repositoryName.toLowerCase() &&
    (record.providerRepositoryId === undefined ||
      repository.providerRepositoryId === record.providerRepositoryId) &&
    repository.templateCommit === record.templateCommit &&
    repository.studentBundleDigest === record.studentBundleDigest &&
    repository.studentManifestDigest === record.studentMaterialization.manifestDigest &&
    JSON.stringify(repository.materializedFiles) === JSON.stringify(expectedFiles)
  );
}

export class AssignmentProvisioningService {
  readonly #inFlight = new Map<string, Promise<AssignmentRecord>>();
  readonly #trustedScannerVersions: ReadonlySet<string>;

  constructor(
    private readonly store: InMemoryProvisioningStore,
    private readonly github: GitHubProvisioningAdapter,
    private readonly canarySource: ProtectedCanarySource,
    private readonly scanner: RepositoryLeakScanner,
    private readonly now: () => string,
    private readonly log: ProvisioningLogger = () => undefined,
    trustedScannerVersions: readonly string[] = [
      "git-all-reachable-v1",
      "mock-provider-snapshot-v1",
    ],
  ) {
    if (trustedScannerVersions.length === 0) {
      throw new Error("At least one scanner version must be trusted");
    }
    this.#trustedScannerVersions = new Set(trustedScannerVersions);
  }

  provision(request: AssignmentProvisioningRequest): Promise<AssignmentRecord> {
    const parsedRequest = AssignmentProvisioningRequestSchema.parse(request);
    const canarySet = this.canarySource.deriveForRequest(parsedRequest);
    try {
      assertStudentMaterializationIsCanaryFree(
        parsedRequest.studentMaterialization,
        canarySet,
      );
    } catch (error) {
      if (error instanceof RepositoryScanError) {
        const preflightId = `preflight-${createHash("sha256")
          .update(
            `${parsedRequest.caseVersionDigest}:${parsedRequest.studentBundleDigest}:${parsedRequest.operationId}`,
            "utf8",
          )
          .digest("hex")
          .slice(0, 24)}`;
        this.log({
          assignmentId: preflightId,
          action: "scan-repository",
          outcome: "failed",
          code: error.code,
        });
      }
      throw error;
    }
    const reserved = this.store.reserve(parsedRequest);
    const running = this.#inFlight.get(reserved.assignmentId);
    if (running !== undefined) return running;
    const operation = this.#provisionReserved(reserved, canarySet).finally(() => {
      this.#inFlight.delete(reserved.assignmentId);
    });
    this.#inFlight.set(reserved.assignmentId, operation);
    return operation;
  }

  async #provisionReserved(
    initial: AssignmentRecord,
    canarySet: ReturnType<ProtectedCanarySource["deriveForRequest"]>,
  ): Promise<AssignmentRecord> {
    let record = this.store.get(initial.assignmentId);
    if (record.state === "ready") return record;
    const repositoryIdentity = identity(record);
    let activeAction: ProvisioningLogEvent["action"] = "reconcile-repository";
    try {
      this.log({
        assignmentId: record.assignmentId,
        action: "reconcile-repository",
        outcome: "started",
      });
      const repositoryLookup = await this.github.findRepository(repositoryIdentity);
      if (repositoryLookup.status === "unknown") {
        return this.#fail(record.assignmentId, "repository-lookup-unknown", "readback");
      }
      let repository: RepositoryReadback;
      if (repositoryLookup.status === "authoritative-absent") {
        if (record.providerRepositoryId !== undefined) {
          return this.#fail(record.assignmentId, "repository-readback-invalid", "readback");
        }
        this.log({
          assignmentId: record.assignmentId,
          action: "create-repository",
          outcome: "started",
        });
        activeAction = "create-repository";
        repository = await this.github.createRepository({
          owner: record.repositoryOwner,
          name: record.repositoryName,
          private: true,
          templateCommit: record.templateCommit,
          studentBundleDigest: record.studentBundleDigest,
          studentMaterialization: record.studentMaterialization,
        });
      } else {
        repository = repositoryLookup.value;
      }
      repository = RepositoryReadbackSchema.parse(repository);
      if (!readbackMatchesReservation(repository, record)) {
        return this.#fail(record.assignmentId, "repository-readback-invalid", "readback");
      }
      record = this.store.updateRepository(
        record.assignmentId,
        repository.providerRepositoryId,
        repository.materializedCommit,
      );

      if (
        record.invitationId !== undefined &&
        !scanReceiptMatchesRepository(
          record.cleanScanReceipt,
          record,
          repository,
          "pre_invitation",
          canarySet.setDigest,
          record.cleanScanReceipt?.generation ?? 0,
        )
      ) {
        return this.#fail(
          record.assignmentId,
          "repository-scan-receipt-invalid",
          "scan-repository",
        );
      }

      activeAction = "readback";
      const login = await this.github.resolveCurrentLogin(record.studentGithubUserId);
      const invitationLookup = await this.github.readInvitation(
        repositoryIdentity,
        record.studentGithubUserId,
      );
      if (invitationLookup.status === "unknown") {
        return this.#fail(record.assignmentId, "invitation-lookup-unknown", "readback");
      }
      if (
        invitationLookup.status === "found" &&
        !scanReceiptMatchesRepository(
          record.cleanScanReceipt,
          record,
          repository,
          "pre_invitation",
          canarySet.setDigest,
          record.cleanScanReceipt?.generation ?? 0,
        )
      ) {
        return this.#fail(
          record.assignmentId,
          "repository-scan-receipt-invalid",
          "scan-repository",
        );
      }
      let invitation: InvitationReadback;
      if (invitationLookup.status === "authoritative-absent") {
        if (record.invitationId !== undefined) {
          return this.#fail(record.assignmentId, "invitation-readback-invalid", "readback");
        }
        const generation = (record.cleanScanReceipt?.generation ?? 0) + 1;
        this.log({ assignmentId: record.assignmentId, action: "scan-repository", outcome: "started" });
        activeAction = "scan-repository";
        const receipt = await this.scanner.scan({
          assignment: record,
          repository,
          canarySet,
          stage: "pre_invitation",
          generation,
        });
        if (!this.#newScanReceiptIsTrusted(receipt)) {
          return this.#fail(
            record.assignmentId,
            "repository-scan-receipt-invalid",
            "scan-repository",
          );
        }
        record = this.store.recordCleanScan(record.assignmentId, receipt);
        if (!scanReceiptMatchesRepository(
          record.cleanScanReceipt,
          record,
          repository,
          "pre_invitation",
          canarySet.setDigest,
          generation,
        )) {
          return this.#fail(
            record.assignmentId,
            "repository-scan-receipt-invalid",
            "scan-repository",
          );
        }
        this.log({ assignmentId: record.assignmentId, action: "scan-repository", outcome: "succeeded" });
        record = this.store.updateInvitation(record.assignmentId, login);
        this.log({ assignmentId: record.assignmentId, action: "invite", outcome: "started" });
        activeAction = "invite";
        invitation = await this.github.inviteCollaborator(repositoryIdentity, {
          githubUserId: record.studentGithubUserId,
          login,
          permission: "push",
        });
      } else {
        invitation = invitationLookup.value;
      }
      invitation = InvitationReadbackSchema.parse(invitation);
      if (
        record.invitationId !== undefined &&
        invitation.invitationId !== record.invitationId
      ) {
        return this.#fail(record.assignmentId, "invitation-readback-invalid", "readback");
      }
      record = this.store.updateInvitation(record.assignmentId, login, invitation.invitationId);
      if (
        invitation.githubUserId !== record.studentGithubUserId ||
        invitation.login.toLowerCase() !== login.toLowerCase() ||
        invitation.permission !== "push"
      ) {
        return this.#fail(record.assignmentId, "invitation-readback-invalid", "readback");
      }
      if (invitation.state !== "accepted") {
        this.log({ assignmentId: record.assignmentId, action: "readback", outcome: "pending" });
        return record;
      }
      record = this.store.recordInvitationAcceptance(
        record.assignmentId,
        login,
        invitation.invitationId,
      );

      activeAction = "readback";
      const finalRepositoryLookup = await this.github.findRepository(repositoryIdentity);
      if (finalRepositoryLookup.status !== "found") {
        return this.#fail(
          record.assignmentId,
          finalRepositoryLookup.status === "unknown"
            ? "repository-lookup-unknown"
            : "repository-readback-invalid",
          "readback",
        );
      }
      const finalRepository = RepositoryReadbackSchema.parse(finalRepositoryLookup.value);
      const collaborator = finalRepository.collaborators.find(
        ({ githubUserId }) => githubUserId === record.studentGithubUserId,
      );
      if (
        !readbackMatchesReservation(finalRepository, record) ||
        collaborator?.login.toLowerCase() !== login.toLowerCase() ||
        collaborator.permission !== "push"
      ) {
        return this.#fail(record.assignmentId, "repository-readback-invalid", "readback");
      }

      this.log({ assignmentId: record.assignmentId, action: "scan-repository", outcome: "started" });
      activeAction = "scan-repository";
      const readinessReceipt = await this.scanner.scan({
        assignment: record,
        repository: finalRepository,
        canarySet,
        stage: "pre_ready",
        generation: record.cleanScanReceipt?.generation ?? 0,
      });
      if (!this.#newScanReceiptIsTrusted(readinessReceipt)) {
        return this.#fail(
          record.assignmentId,
          "repository-scan-receipt-invalid",
          "scan-repository",
        );
      }
      record = this.store.recordCleanScan(record.assignmentId, readinessReceipt);
      if (!scanReceiptMatchesRepository(
        record.readinessScanReceipt,
        record,
        finalRepository,
        "pre_ready",
        canarySet.setDigest,
        record.cleanScanReceipt?.generation ?? 0,
      )) {
        return this.#fail(
          record.assignmentId,
          "repository-scan-receipt-invalid",
          "scan-repository",
        );
      }
      if (
        record.cleanScanReceipt?.canarySetDigest !==
          record.readinessScanReceipt?.canarySetDigest ||
        record.cleanScanReceipt?.repositoryStateDigest !==
          record.readinessScanReceipt?.repositoryStateDigest ||
        record.cleanScanReceipt?.scannerVersion !==
          record.readinessScanReceipt?.scannerVersion ||
        record.cleanScanReceipt?.generation !== record.readinessScanReceipt?.generation
      ) {
        return this.#fail(
          record.assignmentId,
          "repository-scan-receipt-invalid",
          "scan-repository",
        );
      }
      this.log({ assignmentId: record.assignmentId, action: "scan-repository", outcome: "succeeded" });
      record = this.store.markReady(record.assignmentId, collaborator.permission, this.now());
      this.log({ assignmentId: record.assignmentId, action: "readback", outcome: "succeeded" });
      return record;
    } catch (error) {
      const code =
        error instanceof GitHubAdapterError || error instanceof RepositoryScanError
          ? error.code
          : error instanceof InvalidCleanScanReceiptError
            ? "repository-scan-receipt-invalid"
            : ("provider-error" as const);
      return this.#fail(record.assignmentId, code, activeAction);
    }
  }

  #fail(
    assignmentId: string,
    code: ProvisioningFailureCode,
    action: ProvisioningLogEvent["action"],
  ): AssignmentRecord {
    const failed = this.store.recordFailure(assignmentId, code, this.now());
    this.log({ assignmentId, action, outcome: "failed", code });
    return failed;
  }

  #newScanReceiptIsTrusted(receipt: CleanRepositoryScanReceipt): boolean {
    const scannedAt = Date.parse(receipt.scannedAt);
    const observedAt = Date.parse(this.now());
    return (
      receipt.receiptId === cleanRepositoryScanReceiptId(receipt) &&
      this.#trustedScannerVersions.has(receipt.scannerVersion) &&
      !Number.isNaN(scannedAt) &&
      !Number.isNaN(observedAt) &&
      scannedAt >= observedAt - 5 * 60_000 &&
      scannedAt <= observedAt + 60_000
    );
  }
}
