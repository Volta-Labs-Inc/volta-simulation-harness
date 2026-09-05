import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import {
  AssignmentProvisioningService,
  GitCheckoutRepositoryLeakScanner,
  InMemoryProvisioningStore,
  MockGitHubProvisioningAdapter,
  StaticProtectedCanarySource,
  studentManifestDigest,
  type AssignmentProvisioningRequest,
} from "../src/index.js";

const execFileAsync = promisify(execFile);
const caseVersionDigest = `sha256:${"a".repeat(64)}` as const;
const studentBundleDigest = `sha256:${"b".repeat(64)}` as const;
const templateCommit = "d".repeat(40);
const studentContent = "# Synthetic\n";
const studentFiles = [{
  path: "README.md",
  mediaType: "text/markdown" as const,
  byteLength: Buffer.byteLength(studentContent),
  digest: `sha256:${createHash("sha256").update(studentContent).digest("hex")}` as const,
  content: studentContent,
}];
const studentMaterialization = {
  manifestDigest: studentManifestDigest(studentFiles),
  files: studentFiles,
};

async function git(repositoryPath: string, args: readonly string[]): Promise<string> {
  const result = await execFileAsync(
    "git",
    ["-C", repositoryPath, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.test", ...args],
    { encoding: "utf8" },
  );
  return result.stdout.trim();
}

async function cleanRepository(): Promise<{ repositoryPath: string; head: string }> {
  const repositoryPath = await mkdtemp(path.join(tmpdir(), "volta-provisioning-scan-"));
  await git(repositoryPath, ["init", "-b", "main"]);
  await mkdir(path.join(repositoryPath, "dist"), { recursive: true });
  await writeFile(path.join(repositoryPath, "README.md"), studentContent, "utf8");
  await writeFile(path.join(repositoryPath, "dist/output.txt"), "Public build output.\n", "utf8");
  await git(repositoryPath, ["add", "."]);
  await git(repositoryPath, ["commit", "-m", "materialized student snapshot"]);
  return { repositoryPath, head: await git(repositoryPath, ["rev-parse", "HEAD"]) };
}

function request(): AssignmentProvisioningRequest {
  return {
    operationId: "scan-path-operation",
    caseVersionDigest,
    studentBundleDigest,
    studentMaterialization,
    templateCommit,
    studentGithubUserId: "101",
    repositoryOwner: "Volta-Labs-Inc",
  };
}

async function serviceFor(
  repositoryPath: string,
  head: string,
  canary: string,
  githubOptions: Partial<ConstructorParameters<typeof MockGitHubProvisioningAdapter>[0]> = {},
): Promise<{
  service: AssignmentProvisioningService;
  github: MockGitHubProvisioningAdapter;
}> {
  const store = new InMemoryProvisioningStore(
    [{
      caseVersionDigest,
      studentBundleDigest,
      studentManifestDigest: studentMaterialization.manifestDigest,
    }],
    { repositoryOwner: "Volta-Labs-Inc", templateCommit },
    {
      trustedScannerVersions: ["git-all-reachable-v1"],
      now: () => "2026-09-04T16:00:00.000Z",
    },
  );
  const github = new MockGitHubProvisioningAdapter({
    logins: { "101": "student-one" },
    materializedCommit: head,
    ...githubOptions,
  });
  const scanner = new GitCheckoutRepositoryLeakScanner(
    async () => ({ repositoryPath, buildOutputPaths: ["dist"] }),
    () => "2026-09-04T16:00:00.000Z",
  );
  return {
    github,
    service: new AssignmentProvisioningService(
      store,
      github,
      new StaticProtectedCanarySource([{ id: "protected", value: canary }]),
      scanner,
      () => "2026-09-04T16:00:00.000Z",
    ),
  };
}

describe("pre-invitation repository scanning", () => {
  it("records a clean receipt from the exact materialized Git snapshot before inviting", async () => {
    const { repositoryPath, head } = await cleanRepository();
    const { github, service } = await serviceFor(repositoryPath, head, "ABSENT_CANARY_11");
    const pending = await service.provision(request());

    expect(pending.state).toBe("invitation_pending");
    expect(pending.cleanScanReceipt).toMatchObject({
      stage: "pre_invitation",
      materializedCommit: head,
      repositoryStateDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      scannerVersion: "git-all-reachable-v1",
    });
    expect(github.inviteCalls).toBe(1);
  });

  it.each(["working-tree", "ref", "reachable-history", "build-output"] as const)(
    "blocks invitation when a protected canary is present in %s",
    async (surface) => {
      const canary = `CANARY_${surface.replace("-", "_").toUpperCase()}_93`;
      const { repositoryPath } = await cleanRepository();
      if (surface === "working-tree") {
        await writeFile(path.join(repositoryPath, "untracked.txt"), canary, "utf8");
      } else if (surface === "ref") {
        await git(repositoryPath, ["branch", canary]);
      } else if (surface === "reachable-history") {
        await writeFile(path.join(repositoryPath, "historical.txt"), canary, "utf8");
        await git(repositoryPath, ["add", "historical.txt"]);
        await git(repositoryPath, ["commit", "-m", "seed historical canary"]);
        await writeFile(path.join(repositoryPath, "historical.txt"), "removed from tip\n", "utf8");
        await git(repositoryPath, ["add", "historical.txt"]);
        await git(repositoryPath, ["commit", "-m", "remove canary from tip"]);
      } else {
        await writeFile(path.join(repositoryPath, "dist/output.txt"), canary, "utf8");
      }
      const head = await git(repositoryPath, ["rev-parse", "HEAD"]);
      const { github, service } = await serviceFor(repositoryPath, head, canary);

      const failed = await service.provision(request());

      expect(failed.failure?.code).toBe("repository-scan-dirty");
      expect(failed.cleanScanReceipt).toBeUndefined();
      expect(github.inviteCalls).toBe(0);
    },
  );

  it("rejects a checkout that is not the provider's exact materialized commit", async () => {
    const { repositoryPath } = await cleanRepository();
    const { github, service } = await serviceFor(
      repositoryPath,
      "f".repeat(40),
      "ABSENT_CANARY_12",
    );

    const failed = await service.provision(request());

    expect(failed.failure?.code).toBe("repository-scan-failed");
    expect(github.inviteCalls).toBe(0);
  });

  it("fails closed on unsupported filesystem entries instead of skipping shipped content", async () => {
    const { repositoryPath, head } = await cleanRepository();
    await symlink("README.md", path.join(repositoryPath, "unscanned-link"));
    const { github, service } = await serviceFor(
      repositoryPath,
      head,
      "ABSENT_CANARY_13",
    );

    const failed = await service.provision(request());

    expect(failed.failure?.code).toBe("repository-scan-failed");
    expect(github.inviteCalls).toBe(0);
  });

  it("rescans changed hidden state before retrying a definitively failed invitation", async () => {
    const canary = "RETRY_HIDDEN_REF_CANARY_73";
    const { repositoryPath, head } = await cleanRepository();
    const { github, service } = await serviceFor(repositoryPath, head, canary, {
      invitationFailureOnce: true,
    });
    const failedInvitation = await service.provision(request());
    expect(failedInvitation).toMatchObject({
      state: "invitation_pending",
      cleanScanReceipt: { generation: 1 },
      failure: { code: "invitation-failed" },
    });
    expect(github.inviteCalls).toBe(1);

    await git(repositoryPath, ["branch", canary]);
    const blockedRetry = await service.provision(request());

    expect(blockedRetry).toMatchObject({
      state: "invitation_pending",
      cleanScanReceipt: { generation: 1 },
      failure: { code: "repository-scan-dirty" },
    });
    expect(github.inviteCalls).toBe(1);
  });

  it.each(["hidden-ref", "reachable-history", "build-output"] as const)(
    "blocks readiness when %s gains a protected canary after the invitation scan",
    async (surface) => {
      const canary = `MUTATED_${surface.replace("-", "_").toUpperCase()}_71`;
      const { repositoryPath, head } = await cleanRepository();
      const { github, service } = await serviceFor(repositoryPath, head, canary);
      const pending = await service.provision(request());
      expect(pending.state).toBe("invitation_pending");
      expect(pending.cleanScanReceipt?.stage).toBe("pre_invitation");

      if (surface === "hidden-ref") {
        await git(repositoryPath, ["branch", canary]);
      } else if (surface === "reachable-history") {
        await git(repositoryPath, ["checkout", "-b", "hidden-history"]);
        await writeFile(path.join(repositoryPath, "historical.txt"), canary, "utf8");
        await git(repositoryPath, ["add", "historical.txt"]);
        await git(repositoryPath, ["commit", "-m", "hidden protected history"]);
        await git(repositoryPath, ["checkout", "main"]);
      } else {
        await writeFile(path.join(repositoryPath, "dist/output.txt"), canary, "utf8");
      }
      github.acceptInvitation(
        { owner: pending.repositoryOwner, name: pending.repositoryName },
        "101",
      );

      const failed = await service.provision(request());

      expect(failed.state).toBe("invitation_pending");
      expect(failed.failure?.code).toBe("repository-scan-dirty");
      expect(failed.readinessScanReceipt).toBeUndefined();
      expect(github.inviteCalls).toBe(1);
    },
  );

  it("blocks readiness when hidden repository state changes even without a known canary match", async () => {
    const { repositoryPath, head } = await cleanRepository();
    const { github, service } = await serviceFor(
      repositoryPath,
      head,
      "ABSENT_CANARY_14",
    );
    const pending = await service.provision(request());
    await git(repositoryPath, ["branch", "benign-hidden-ref"]);
    github.acceptInvitation(
      { owner: pending.repositoryOwner, name: pending.repositoryName },
      "101",
    );

    const failed = await service.provision(request());

    expect(failed.state).toBe("invitation_pending");
    expect(failed.failure?.code).toBe("repository-scan-receipt-invalid");
    expect(failed.readinessScanReceipt?.stage).toBe("pre_ready");
    expect(failed.readinessScanReceipt?.repositoryStateDigest).not.toBe(
      pending.cleanScanReceipt?.repositoryStateDigest,
    );
  });
});
