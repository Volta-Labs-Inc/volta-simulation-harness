import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import {
  AssignmentProvisioningRequestSchema,
  AssignmentProvisioningService,
  cleanRepositoryScanReceiptId,
  InMemoryProvisioningStore,
  MockGitHubProvisioningAdapter,
  MockRepositoryLeakScanner,
  ProvisioningConflictError,
  RepositoryScanError,
  StaticProtectedCanarySource,
  type AssignmentProvisioningRequest,
  type CleanRepositoryScanReceipt,
  type ProvisioningLogEvent,
  type ProtectedCanarySource,
  type RepositoryLeakScanner,
  type RepositoryIdentity,
  type RepositoryReadback,
  studentManifestDigest,
} from "../src/index.js";

const caseVersionDigest = `sha256:${"a".repeat(64)}` as const;
const studentBundleDigest = `sha256:${"b".repeat(64)}` as const;
const otherBundleDigest = `sha256:${"c".repeat(64)}` as const;
const templateCommit = "d".repeat(40);
const studentContent = "# Synthetic\n";
const studentFiles = [
  {
    path: "README.md",
    mediaType: "text/markdown" as const,
    byteLength: Buffer.byteLength(studentContent, "utf8"),
    digest: `sha256:${createHash("sha256").update(studentContent).digest("hex")}` as const,
    content: studentContent,
  },
];
const studentMaterialization = {
  manifestDigest: studentManifestDigest(studentFiles),
  files: studentFiles,
};

function request(
  overrides: Partial<AssignmentProvisioningRequest> = {},
): AssignmentProvisioningRequest {
  return {
    operationId: "operation-1",
    caseVersionDigest,
    studentBundleDigest,
    studentMaterialization,
    templateCommit,
    studentGithubUserId: "101",
    repositoryOwner: "Volta-Labs-Inc",
    ...overrides,
  };
}

function setup(
  options: ConstructorParameters<typeof MockGitHubProvisioningAdapter>[0] = {
    logins: { "101": "student-one", "202": "student-two" },
  },
  scanOutcomes: ConstructorParameters<typeof MockRepositoryLeakScanner>[0] = [],
  canaries = [{ id: "truth", value: "CANARY_PROTECTED_TRUTH_42" }],
  sourceOverride?: ProtectedCanarySource,
  scannerOverride?: RepositoryLeakScanner,
  trustedScannerVersions: readonly string[] = ["mock-provider-snapshot-v1"],
) {
  const store = new InMemoryProvisioningStore([
    {
      caseVersionDigest,
      studentBundleDigest,
      studentManifestDigest: studentMaterialization.manifestDigest,
    },
  ], { repositoryOwner: "Volta-Labs-Inc", templateCommit }, {
    trustedScannerVersions,
    now: () => "2026-09-04T16:00:00.000Z",
  });
  const github = new MockGitHubProvisioningAdapter(options);
  const scanner = new MockRepositoryLeakScanner(scanOutcomes);
  const canarySource = sourceOverride ?? new StaticProtectedCanarySource(canaries);
  const logs: ProvisioningLogEvent[] = [];
  const service = new AssignmentProvisioningService(
    store,
    github,
    canarySource,
    scannerOverride ?? scanner,
    () => "2026-09-04T16:00:00.000Z",
    (event) => logs.push(event),
    trustedScannerVersions,
  );
  return { store, github, logs, scanner, service };
}

function reidentifyReceipt(
  receipt: CleanRepositoryScanReceipt,
  changes: Partial<CleanRepositoryScanReceipt>,
): CleanRepositoryScanReceipt {
  const changed = { ...receipt, ...changes };
  return { ...changed, receiptId: cleanRepositoryScanReceiptId(changed) };
}

function identity(record: { repositoryOwner: string; repositoryName: string }): RepositoryIdentity {
  return { owner: record.repositoryOwner, name: record.repositoryName };
}

describe("idempotent private assignment provisioning", () => {
  it("matches the database manifest digest contract", () => {
    expect(studentMaterialization.manifestDigest).toBe(
      "sha256:128b254472f60b820f2cb328b4e314ba95a4bd4639add0c7d279641cf347898a",
    );
  });

  it("reserves one assignment and repository under duplicate and concurrent calls", async () => {
    const { store, github, service } = setup();
    const first = service.provision(request());
    const duplicate = service.provision(request());
    expect(duplicate).toBe(first);
    const [firstResult, duplicateResult] = await Promise.all([first, duplicate]);
    expect(duplicateResult.assignmentId).toBe(firstResult.assignmentId);
    expect(github.createCalls).toBe(1);

    const replay = await service.provision(request({ operationId: "operation-2" }));
    expect(replay.assignmentId).toBe(firstResult.assignmentId);
    expect(github.createCalls).toBe(1);
    expect(store.studentReadiness(firstResult.assignmentId, "101")).toEqual({ ready: false });
  });

  it("rejects operation and assignment payload conflicts", async () => {
    const { service } = setup();
    await service.provision(request());
    expect(() =>
      service.provision(request({ studentBundleDigest: otherBundleDigest })),
    ).toThrow(ProvisioningConflictError);
    expect(() =>
      service.provision(request({ operationId: "operation-2", templateCommit: "e".repeat(40) })),
    ).toThrow(ProvisioningConflictError);
  });

  it("rejects caller-selected repository destinations and template commits", () => {
    const { service } = setup();
    expect(() => service.provision(request({ repositoryOwner: "Other-Owner" }))).toThrow(
      ProvisioningConflictError,
    );
    expect(() => service.provision(request({ templateCommit: "e".repeat(40) }))).toThrow(
      ProvisioningConflictError,
    );
  });

  it("reconciles a repository-created timeout without creating a duplicate", async () => {
    const { github, service } = setup({
      logins: { "101": "student-one" },
      createTimeoutAfterSuccessOnce: true,
    });
    const failed = await service.provision(request());
    expect(failed).toMatchObject({
      state: "provisioning",
      failure: { code: "repository-create-timeout" },
    });
    const resumed = await service.provision(request());
    expect(resumed.state).toBe("invitation_pending");
    expect(github.createCalls).toBe(1);
  });

  it("does not create or invite while repository or invitation absence is uncertain", async () => {
    const repositoryCase = setup();
    repositoryCase.github.makeNextRepositoryLookupUnknown();
    const repositoryUnknown = await repositoryCase.service.provision(request());
    expect(repositoryUnknown.failure?.code).toBe("repository-lookup-unknown");
    expect(repositoryCase.github.createCalls).toBe(0);
    expect(repositoryCase.github.inviteCalls).toBe(0);

    const invitationCase = setup();
    invitationCase.github.makeNextInvitationLookupUnknown();
    const invitationUnknown = await invitationCase.service.provision(request());
    expect(invitationUnknown.failure?.code).toBe("invitation-lookup-unknown");
    expect(invitationCase.github.createCalls).toBe(1);
    expect(invitationCase.scanner.scanCalls).toBe(0);
    expect(invitationCase.github.inviteCalls).toBe(0);
  });

  it("rejects protected content in exact student bytes before persistence or any provider call", () => {
    const protectedCanary = "PROTECTED_PREFLIGHT_CANARY_91";
    const leakedContent = `# Synthetic\n${protectedCanary}\n`;
    const leakedFiles = [{
      ...studentFiles[0]!,
      byteLength: Buffer.byteLength(leakedContent, "utf8"),
      digest: `sha256:${createHash("sha256").update(leakedContent).digest("hex")}` as const,
      content: leakedContent,
    }];
    const leakedMaterialization = {
      manifestDigest: studentManifestDigest(leakedFiles),
      files: leakedFiles,
    };
    const store = new InMemoryProvisioningStore([{
      caseVersionDigest,
      studentBundleDigest,
      studentManifestDigest: leakedMaterialization.manifestDigest,
    }], { repositoryOwner: "Volta-Labs-Inc", templateCommit }, {
      trustedScannerVersions: ["mock-provider-snapshot-v1"],
      now: () => "2026-09-04T16:00:00.000Z",
    });
    const github = new MockGitHubProvisioningAdapter({
      logins: { "101": "student-one" },
    });
    const scanner = new MockRepositoryLeakScanner();
    const logs: ProvisioningLogEvent[] = [];
    const service = new AssignmentProvisioningService(
      store,
      github,
      new StaticProtectedCanarySource([{ id: "protected", value: protectedCanary }]),
      scanner,
      () => "2026-09-04T16:00:00.000Z",
      (event) => logs.push(event),
    );

    let rejection: unknown;
    try {
      void service.provision(request({ studentMaterialization: leakedMaterialization }));
    } catch (error) {
      rejection = error;
    }
    expect(rejection).toBeInstanceOf(RepositoryScanError);
    expect(store.hasOperation("operation-1")).toBe(false);
    expect(scanner.scanCalls).toBe(0);
    expect({
      repositoryLookupCalls: github.repositoryLookupCalls,
      loginLookupCalls: github.loginLookupCalls,
      invitationLookupCalls: github.invitationLookupCalls,
      createCalls: github.createCalls,
      inviteCalls: github.inviteCalls,
    }).toEqual({
      repositoryLookupCalls: 0,
      loginLookupCalls: 0,
      invitationLookupCalls: 0,
      createCalls: 0,
      inviteCalls: 0,
    });
    expect(JSON.stringify({
      error: rejection instanceof Error ? rejection.message : rejection,
      logs,
      requests: github.capturedCreateRequests,
    }))
      .not.toContain(protectedCanary);
  });

  it.each(["dirty", "timeout", "failure"] as const)(
    "withholds every invitation when the repository scan is %s",
    async (outcome) => {
      const { github, logs, scanner, service } = setup(undefined, [outcome]);
      const failed = await service.provision(request());
      expect(failed.failure?.code).toBe(
        outcome === "dirty"
          ? "repository-scan-dirty"
          : outcome === "timeout"
            ? "repository-scan-timeout"
            : "repository-scan-failed",
      );
      expect(scanner.scanCalls).toBe(1);
      expect(github.inviteCalls).toBe(0);
      expect(logs.at(-1)).toMatchObject({
        action: "scan-repository",
        outcome: "failed",
      });
    },
  );

  it("resumes a failed invitation against the existing repository and current login", async () => {
    const { github, service } = setup({
      logins: { "101": "student-renamed" },
      invitationFailureOnce: true,
    });
    const failed = await service.provision(request());
    expect(failed).toMatchObject({
      state: "invitation_pending",
      currentLogin: "student-renamed",
      cleanScanReceipt: { generation: 1 },
      failure: { code: "invitation-failed" },
    });
    const resumed = await service.provision(request());
    expect(resumed).toMatchObject({
      state: "invitation_pending",
      currentLogin: "student-renamed",
      cleanScanReceipt: { generation: 2 },
    });
    expect(resumed.cleanScanReceipt?.receiptId).not.toBe(failed.cleanScanReceipt?.receiptId);
    expect(github.createCalls).toBe(1);
    expect(github.inviteCalls).toBe(2);
  });

  it("reconciles an invitation success followed by timeout without inviting twice", async () => {
    const { github, service } = setup({
      logins: { "101": "student-one" },
      invitationTimeoutAfterSuccessOnce: true,
    });
    const failed = await service.provision(request());
    expect(failed).toMatchObject({
      state: "invitation_pending",
      failure: { code: "invitation-timeout" },
    });
    const resumed = await service.provision(request());
    expect(resumed.state).toBe("invitation_pending");
    expect(github.inviteCalls).toBe(1);
  });

  it("fails closed when a recorded invitation has missing or ambiguous readback", async () => {
    const missingCase = setup();
    const missingPending = await missingCase.service.provision(request());
    missingCase.github.removeInvitationReadback(identity(missingPending), "101");
    const missing = await missingCase.service.provision(request());
    expect(missing.failure?.code).toBe("invitation-readback-invalid");
    expect(missingCase.github.inviteCalls).toBe(1);

    const ambiguousCase = setup();
    await ambiguousCase.service.provision(request());
    ambiguousCase.github.failNextInvitationReadbackAsAmbiguous();
    const ambiguous = await ambiguousCase.service.provision(request());
    expect(ambiguous.failure?.code).toBe("invitation-lookup-unknown");
    expect(ambiguousCase.github.inviteCalls).toBe(1);
  });

  it("withholds service readiness until invitation acceptance and exact readback", async () => {
    const { store, github, service } = setup();
    const pending = await service.provision(request());
    expect(pending.state).toBe("invitation_pending");
    expect(pending.cleanScanReceipt).toMatchObject({
      assignmentId: pending.assignmentId,
      providerRepositoryId: pending.providerRepositoryId,
      materializedCommit: pending.materializedCommit,
      studentBundleDigest,
      studentManifestDigest: studentMaterialization.manifestDigest,
    });
    expect(store.studentReadiness(pending.assignmentId, "101")).toEqual({ ready: false });
    expect(store.studentReadiness(pending.assignmentId, "202")).toEqual({ ready: false });

    github.acceptInvitation(identity(pending), "101");
    const ready = await service.provision(request());
    expect(ready).toMatchObject({
      state: "ready",
      invitationAccepted: true,
      collaboratorPermission: "push",
      readinessScanReceipt: {
        stage: "pre_ready",
        assignmentId: pending.assignmentId,
      },
    });
    expect(store.studentReadiness(ready.assignmentId, "101")).toEqual({
      ready: true,
      assignmentId: ready.assignmentId,
      repositoryOwner: ready.repositoryOwner,
      repositoryName: ready.repositoryName,
    });
  });

  it("rejects a weaker canary set or changed repository state at the readiness scan", async () => {
    const fullSet = new StaticProtectedCanarySource([
      { id: "truth", value: "CANARY_PROTECTED_TRUTH_42" },
      { id: "anchor", value: "CANARY_PROTECTED_ANCHOR_43" },
    ]);
    const weakerSet = new StaticProtectedCanarySource([
      { id: "truth", value: "CANARY_PROTECTED_TRUTH_42" },
    ]);
    let derivations = 0;
    const changingSource: ProtectedCanarySource = {
      deriveForRequest: () => {
        derivations += 1;
        return derivations === 1
          ? fullSet.deriveForRequest()
          : weakerSet.deriveForRequest();
      },
    };
    const weakerCase = setup(undefined, [], [], changingSource);
    const pending = await weakerCase.service.provision(request());
    weakerCase.github.acceptInvitation(identity(pending), "101");
    const weaker = await weakerCase.service.provision(request());
    expect(weaker.state).toBe("invitation_pending");
    expect(weaker.failure?.code).toBe("repository-scan-receipt-invalid");

    const changedStateCase = setup();
    const statePending = await changedStateCase.service.provision(request());
    changedStateCase.github.acceptInvitation(identity(statePending), "101");
    changedStateCase.scanner.setNextRepositoryStateDigest(
      `sha256:${"9".repeat(64)}`,
    );
    const changedState = await changedStateCase.service.provision(request());
    expect(changedState.state).toBe("invitation_pending");
    expect(changedState.failure?.code).toBe("repository-scan-receipt-invalid");
  });

  it.each([
    ["tampered receipt identity", (receipt: CleanRepositoryScanReceipt) => ({
      ...receipt,
      receiptId: `sha256:${"8".repeat(64)}`,
    })],
    ["untrusted scanner version", (receipt: CleanRepositoryScanReceipt) =>
      reidentifyReceipt(receipt, { scannerVersion: "untrusted-scanner-v1" })],
    ["stale scan time", (receipt: CleanRepositoryScanReceipt) =>
      reidentifyReceipt(receipt, { scannedAt: "2026-09-04T15:54:59.999Z" })],
    ["future scan time", (receipt: CleanRepositoryScanReceipt) =>
      reidentifyReceipt(receipt, { scannedAt: "2026-09-04T16:01:00.001Z" })],
    ["wrong scan generation", (receipt: CleanRepositoryScanReceipt) =>
      reidentifyReceipt(receipt, { generation: receipt.generation + 1 })],
    ["undeclared receipt field", (receipt: CleanRepositoryScanReceipt) => ({
      ...receipt,
      rawCanary: "MUST_NOT_PERSIST_PROTECTED_VALUE_92",
    })],
  ] as const)("rejects a hostile scanner's %s", async (_label, mutate) => {
    const honestScanner = new MockRepositoryLeakScanner();
    const hostileScanner: RepositoryLeakScanner = {
      scan: async (input) => mutate(await honestScanner.scan(input)),
    };
    const { github, service } = setup(undefined, [], undefined, undefined, hostileScanner);

    const failed = await service.provision(request());

    expect(failed).toMatchObject({
      state: "repository_created",
      failure: { code: "repository-scan-receipt-invalid" },
    });
    expect(github.inviteCalls).toBe(0);
  });

  it.each([
    ["earlier scan time", (receipt: CleanRepositoryScanReceipt) =>
      reidentifyReceipt(receipt, { scannedAt: "2026-09-04T15:59:00.000Z" })],
    ["different generation", (receipt: CleanRepositoryScanReceipt) =>
      reidentifyReceipt(receipt, { generation: receipt.generation + 1 })],
    ["different trusted scanner", (receipt: CleanRepositoryScanReceipt) =>
      reidentifyReceipt(receipt, { scannerVersion: "git-all-reachable-v1" })],
  ] as const)("rejects a pre-ready receipt with a %s", async (_label, mutate) => {
    const honestScanner = new MockRepositoryLeakScanner();
    const hostileScanner: RepositoryLeakScanner = {
      scan: async (input) => {
        const receipt = await honestScanner.scan(input);
        return input.stage === "pre_ready" ? mutate(receipt) : receipt;
      },
    };
    const hostileCase = setup(
      undefined,
      [],
      undefined,
      undefined,
      hostileScanner,
      ["mock-provider-snapshot-v1", "git-all-reachable-v1"],
    );
    const pending = await hostileCase.service.provision(request());
    hostileCase.github.acceptInvitation(identity(pending), "101");

    const failed = await hostileCase.service.provision(request());

    expect(failed).toMatchObject({
      state: "invitation_pending",
      failure: { code: "repository-scan-receipt-invalid" },
    });
    expect(hostileCase.store.studentReadiness(failed.assignmentId, "101")).toEqual({
      ready: false,
    });
  });

  it.each([
    ["public visibility", { private: false }],
    ["wrong owner", { owner: "Wrong-Owner" }],
    ["wrong repository name", { name: "wrong-repository" }],
    ["wrong template commit", { templateCommit: "e".repeat(40) }],
    ["wrong bundle digest", { studentBundleDigest: otherBundleDigest }],
    ["wrong manifest digest", { studentManifestDigest: otherBundleDigest }],
    ["wrong materialized files", { materializedFiles: [] }],
  ] as const)("rejects %s during final readback", async (_label, mutation) => {
    const { store, github, service } = setup();
    const pending = await service.provision(request());
    github.acceptInvitation(identity(pending), "101");
    github.replaceRepositoryReadback(
      identity(pending),
      mutation as Partial<RepositoryReadback>,
    );
    const failed = await service.provision(request());
    expect(failed).toMatchObject({
      state: "invitation_pending",
      failure: { code: "repository-readback-invalid" },
    });
    expect(store.studentReadiness(pending.assignmentId, "101")).toEqual({ ready: false });
  });

  it("rejects excessive collaborator permission", async () => {
    const { store, github, service } = setup();
    const pending = await service.provision(request());
    github.acceptInvitation(identity(pending), "101");
    github.replaceCollaboratorPermission(identity(pending), "101", "admin");
    const failed = await service.provision(request());
    expect(failed).toMatchObject({
      state: "invitation_pending",
      failure: { code: "repository-readback-invalid" },
    });
    expect(store.studentReadiness(pending.assignmentId, "101")).toEqual({ ready: false });
  });

  it("rejects replacement of recorded repository or invitation identities", async () => {
    const repositoryCase = setup();
    const repositoryPending = await repositoryCase.service.provision(request());
    repositoryCase.github.replaceRepositoryReadback(identity(repositoryPending), {
      providerRepositoryId: "9999",
    });
    const repositoryFailed = await repositoryCase.service.provision(request());
    expect(repositoryFailed.failure?.code).toBe("repository-readback-invalid");

    const invitationCase = setup();
    const invitationPending = await invitationCase.service.provision(request());
    invitationCase.github.replaceInvitationReadback(identity(invitationPending), "101", {
      invitationId: "replacement-invitation",
    });
    const invitationFailed = await invitationCase.service.provision(request());
    expect(invitationFailed.failure?.code).toBe("invitation-readback-invalid");
    expect(invitationCase.store.studentReadiness(invitationPending.assignmentId, "101")).toEqual({
      ready: false,
    });
  });

  it("keeps two students isolated while preserving their identical starting bundle", async () => {
    const { service } = setup();
    const first = await service.provision(request());
    const second = await service.provision(
      request({ operationId: "operation-2", studentGithubUserId: "202" }),
    );
    expect(second.assignmentId).not.toBe(first.assignmentId);
    expect(second.repositoryName).not.toBe(first.repositoryName);
    expect(second.studentBundleDigest).toBe(first.studentBundleDigest);
  });

  it("rejects stale or cross-assignment clean scan receipts", async () => {
    const { store, service } = setup();
    const first = await service.provision(request());
    const second = store.reserve(
      request({ operationId: "operation-2", studentGithubUserId: "202" }),
    );
    expect(() => store.recordCleanScan(first.assignmentId, {
      ...first.cleanScanReceipt!,
      receiptId: `sha256:${"8".repeat(64)}`,
      stage: "pre_ready",
    })).toThrow("Clean scan receipt does not match the assignment snapshot");
    expect(() => store.recordCleanScan(second.assignmentId, first.cleanScanReceipt!)).toThrow(
      ProvisioningConflictError,
    );
    expect(() =>
      store.recordCleanScan(first.assignmentId, {
        ...first.cleanScanReceipt!,
        materializedCommit: "e".repeat(40),
      }),
    ).toThrow(ProvisioningConflictError);
  });

  it("keeps secrets, protected content, and raw provider errors out of requests and logs", async () => {
    const secret = "github-installation-token-CANARY";
    const protectedCanary = "protected-truth-CANARY";
    const { github, logs, service } = setup(
      {
        logins: { "101": "student-one" },
        createTimeoutAfterSuccessOnce: true,
        sensitiveFailureText: `${secret}:${protectedCanary}`,
      },
      [],
      [{ id: "protected", value: protectedCanary }],
    );
    const failed = await service.provision(request());
    const observable = JSON.stringify({
      failed,
      logs,
      requests: github.capturedCreateRequests,
    });
    expect(observable).not.toContain(secret);
    expect(observable).not.toContain(protectedCanary);
    expect(observable).toContain("repository-create-timeout");
  });

  it("rejects undeclared provider request fields", () => {
    expect(
      AssignmentProvisioningRequestSchema.safeParse({
        ...request(),
        installationToken: "must-not-enter-the-request",
      }).success,
    ).toBe(false);
  });

  it.each([
    ["content digest", { digest: otherBundleDigest }],
    ["content byte length", { byteLength: 1 }],
    ["protected path", { path: "Private/truth.yaml" }],
    ["traversal path", { path: "../truth.yaml" }],
    ["non-ASCII path", { path: "ＲEADME.md" }],
  ])("rejects invalid student materialization: %s", (_label, fileChange) => {
    expect(
      AssignmentProvisioningRequestSchema.safeParse({
        ...request(),
        studentMaterialization: {
          ...studentMaterialization,
          files: [{ ...studentFiles[0], ...fileChange }],
        },
      }).success,
    ).toBe(false);
  });

  it("bounds student materialization count, individual size, total size, and media types", () => {
    const emptyDigest = `sha256:${createHash("sha256").update("").digest("hex")}` as const;
    const tooManyFiles = Array.from({ length: 201 }, (_, index) => ({
      path: `file-${String(index).padStart(3, "0")}.txt`,
      mediaType: "text/plain" as const,
      byteLength: 0,
      digest: emptyDigest,
      content: "",
    }));
    const oversizedContent = "x".repeat(5_000_001);
    const oversizedFile = {
      path: "oversized.txt",
      mediaType: "text/plain" as const,
      byteLength: Buffer.byteLength(oversizedContent),
      digest: `sha256:${createHash("sha256").update(oversizedContent).digest("hex")}` as const,
      content: oversizedContent,
    };
    const totalContent = "x".repeat(4_000_000);
    const totalDigest = `sha256:${createHash("sha256").update(totalContent).digest("hex")}` as const;
    const excessiveTotal = ["a.txt", "b.txt", "c.txt"].map((filePath) => ({
      path: filePath,
      mediaType: "text/plain" as const,
      byteLength: 4_000_000,
      digest: totalDigest,
      content: totalContent,
    }));

    for (const files of [tooManyFiles, [oversizedFile], excessiveTotal]) {
      expect(
        AssignmentProvisioningRequestSchema.safeParse({
          ...request(),
          studentMaterialization: {
            files,
            manifestDigest: studentManifestDigest(files),
          },
        }).success,
      ).toBe(false);
    }
    expect(
      AssignmentProvisioningRequestSchema.safeParse({
        ...request(),
        studentMaterialization: {
          ...studentMaterialization,
          files: [{ ...studentFiles[0], mediaType: "application/octet-stream" }],
        },
      }).success,
    ).toBe(false);
  });
});
