import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

import type { SubmissionDraft } from "@volta-sim/contracts";
import { sha256Digest } from "../../core/src/canonical.js";
import { createCaseVersionDigests } from "../../core/src/case-version.js";
import { publishCase } from "../../core/src/published-case.js";
import {
  makeCompleteExampleSubmission,
  nonAssessedLibraryRoutingCase,
} from "../../core/examples/non-assessed-library-routing.js";
import type { MockStudentServiceState } from "../src/types.js";

function git(root: string, args: readonly string[]): string {
  return execFileSync("git", ["-C", root, ...args], {
    encoding: "utf8",
    env: { LC_ALL: "C", GIT_CONFIG_NOSYSTEM: "1", GIT_TERMINAL_PROMPT: "0" },
  }).trim();
}

function publishedExample() {
  const source = structuredClone(nonAssessedLibraryRoutingCase);
  source.protected.authoredRisks.push(PROTECTED_SERVICE_CANARY);
  source.visible.requirements[0]!.applicability = "student-may-mark-not-applicable";
  const digests = createCaseVersionDigests(source);
  const content = {
    kind: "validated-case-import" as const,
    source,
    recordedVisibleBundleDigest: digests.visibleBundleDigest,
    recordedProtectedPackageDigest: digests.protectedPackageDigest,
  };
  return publishCase({ ...content, validationDigest: sha256Digest(content) });
}

export interface StudentFixture {
  readonly root: string;
  readonly serviceRoot: string;
  readonly statePath: string;
  readonly sessionPath: string;
  readonly commitSha: string;
  readonly blobId: string;
  readonly sessionIgnoreBlobId: string;
  readonly draft: SubmissionDraft;
  state: MockStudentServiceState;
}

export const PROTECTED_SERVICE_CANARY = "PROTECTED-SERVICE-TRUTH-CANARY";

export function createStudentFixture(): StudentFixture {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "volta-sim-student-"));
  const serviceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "volta-sim-private-service-"));
  git(root, ["init", "--initial-branch=main"]);
  git(root, ["remote", "add", "origin", "https://github.com/Volta-Labs-Inc/assignment-1.git"]);
  fs.mkdirSync(path.join(root, "results"));
  fs.writeFileSync(path.join(root, "results", "answer.md"), "# Proposed observation\n");
  fs.writeFileSync(path.join(root, "unselected.txt"), "UNSELECTED-CANARY\n");
  fs.writeFileSync(
    path.join(root, ".gitignore"),
    fs.readFileSync(path.resolve(".gitignore"), "utf8"),
  );
  git(root, ["add", "results/answer.md", "unselected.txt", ".gitignore"]);
  git(root, ["-c", "user.name=Test", "-c", "user.email=test@example.test", "commit", "-m", "fixture"]);
  const commitSha = git(root, ["rev-parse", "HEAD"]);
  const blobId = git(root, ["rev-parse", "HEAD:results/answer.md"]);
  const sessionIgnoreBlobId = git(root, ["rev-parse", "HEAD:.gitignore"]);
  const publishedCase = publishedExample();
  const draft = makeCompleteExampleSubmission(publishedCase.digests.caseVersionDigest);
  draft.gitCommitSha = commitSha;
  const state: MockStudentServiceState = {
    version: 1,
    assignmentId: "assignment-1",
    studentGithubUserId: "12345",
    attempt: {
      assignmentId: "assignment-1",
      studentGithubUserId: "12345",
      caseVersionDigest: publishedCase.digests.caseVersionDigest,
      attemptNumber: 1,
      openedAt: "2026-09-04T13:00:00.000Z",
      status: "active",
    },
    attemptHistory: [],
    submissionContext: {
      publishedCase,
      trustedReleasedState: {
        assignmentId: "assignment-1",
        attemptNumber: 1,
        caseVersionDigest: publishedCase.digests.caseVersionDigest,
        currentEventSequence: 8,
        events: [
          {
            eventId: "event-8",
            assignmentId: "assignment-1",
            attemptNumber: 1,
            caseVersionDigest: publishedCase.digests.caseVersionDigest,
            sequence: 8,
            officialFactIds: ["median-wait"],
            providerInteractionId: "interaction-1",
          },
        ],
      },
    },
    expectedRepository: {
      slug: "Volta-Labs-Inc/assignment-1",
      commitSha,
      sessionIgnoreBlobId,
      selectedBlobs: { "results/answer.md": blobId },
    },
    workingDraft: {},
    stage: "discovery",
    simulatedAt: "2026-09-04T15:00:00.000Z",
    scriptedActions: [
      {
        action: "talk",
        targetId: "library-manager",
        message: "The frozen example log shows a median first response time of 18 minutes.",
        officialFactIds: ["median-wait"],
        provider: {
          interactionId: "unused",
          providerId: "mock-provider",
          modelId: "deterministic-capture",
          calibration: "passed",
        },
      },
      {
        action: "evidence",
        targetId: "desk-log",
        message: "The synthetic log records a median of 18 minutes.",
        officialFactIds: ["log-median-wait"],
      },
      {
        action: "collect",
        targetId: "sample-audit",
        message: "The fictional sample audit is scheduled.",
        officialFactIds: [],
        reviewSuggested: true,
        simulatedDays: 1,
      },
    ],
    events: [
      {
        eventId: "event-8",
        sequence: 8,
        eventType: "talk",
        message: "The frozen example log shows a median first response time of 18 minutes.",
        officialFactIds: ["median-wait"],
        provenance: [
          {
            factId: "median-wait",
            source: "Frozen public example desk log, rows 1-20",
          },
        ],
        simulatedAt: "2026-09-04T15:00:00.000Z",
        providerInteractionId: "interaction-1",
      },
    ],
    providerProvenance: [
      {
        interactionId: "interaction-1",
        eventId: "event-8",
        providerId: "mock-provider",
        modelId: "deterministic-capture",
        calibration: "passed",
        renderedAt: "2026-09-04T15:00:00.000Z",
      },
    ],
    reviewRequests: [],
    operations: {},
    loginOperations: {},
  };
  const statePath = "mock-service.json";
  const sessionPath = ".volta-sim/session.json";
  fs.writeFileSync(path.join(serviceRoot, statePath), `${JSON.stringify(state, null, 2)}\n`, {
    mode: 0o600,
  });
  return {
    root,
    serviceRoot,
    statePath,
    sessionPath,
    commitSha,
    blobId,
    sessionIgnoreBlobId,
    draft,
    state,
  };
}

export function artifactFor(content: string) {
  const bytes = Buffer.from(content, "utf8");
  return {
    path: "results/answer.md",
    digest: `sha256:${createHash("sha256").update(bytes).digest("hex")}` as const,
    mediaType: "text/markdown" as const,
    byteLength: bytes.byteLength,
    content,
  };
}
