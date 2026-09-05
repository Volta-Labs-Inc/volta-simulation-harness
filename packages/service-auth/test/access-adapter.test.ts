import { describe, expect, it, vi } from "vitest";

import type { AssignmentAccessContext } from "@volta-sim/core";

import {
  AccessDeniedError,
  withAssignmentAuthorization,
  type AssignmentAuthorizationStore,
  type AuthorizationRequest,
  type AuthorizationSnapshot,
} from "../src/index.js";

const STUDENT_AUTH_ID = "auth-student";
const STAFF_AUTH_ID = "auth-staff";
const STUDENT_GITHUB_ID = "101";
const STAFF_GITHUB_ID = "202";
const ASSIGNMENT_ID = "assignment-a";
const CASE_VERSION_DIGEST = `sha256:${"a".repeat(64)}`;

function context(
  overrides: Partial<AssignmentAccessContext> = {},
): AssignmentAccessContext {
  return {
    assignmentId: ASSIGNMENT_ID,
    requestedAssignmentId: ASSIGNMENT_ID,
    caseId: "support-routing",
    caseVersionDigest: CASE_VERSION_DIGEST,
    studentGithubUserId: STUDENT_GITHUB_ID,
    attemptNumber: 1,
    attemptStatus: "active",
    requiredBlindPolicy: {
      policyId: "blind-a",
      policyVersion: 1,
      assignmentId: ASSIGNMENT_ID,
      caseId: "support-routing",
      caseVersionDigest: CASE_VERSION_DIGEST,
      mode: "attempt-one",
      blindStudentGithubUserId: STUDENT_GITHUB_ID,
    },
    blindPolicy: {
      policyId: "blind-a",
      policyVersion: 1,
      assignmentId: ASSIGNMENT_ID,
      caseId: "support-routing",
      caseVersionDigest: CASE_VERSION_DIGEST,
      mode: "attempt-one",
      blindStudentGithubUserId: STUDENT_GITHUB_ID,
    },
    ...overrides,
  };
}

function studentSnapshot(overrides: Partial<AssignmentAccessContext> = {}): AuthorizationSnapshot {
  const assignmentContext = context(overrides);
  return {
    actor: {
      authUserId: STUDENT_AUTH_ID,
      githubUserId: STUDENT_GITHUB_ID,
      roles: ["student", "staff"],
    },
    context: assignmentContext,
    attemptOneSubmissionAccepted: assignmentContext.attemptStatus === "submitted",
  };
}

function staffSnapshot(overrides: Partial<AssignmentAccessContext> = {}): AuthorizationSnapshot {
  return {
    actor: {
      authUserId: STAFF_AUTH_ID,
      githubUserId: STAFF_GITHUB_ID,
      roles: ["staff", "case-author"],
    },
    context: context({
      staffAuthorization: {
        authorizationId: "grant-staff-a",
        githubUserId: STAFF_GITHUB_ID,
        caseId: "support-routing",
        caseVersionDigest: CASE_VERSION_DIGEST,
        allowedActions: [
          "staff-read-timeline",
          "staff-read-protected-case",
          "staff-evaluate",
          "staff-author-case",
        ],
      },
      ...overrides,
    }),
    attemptOneSubmissionAccepted: false,
  };
}

class MemoryAuthorizationStore implements AssignmentAuthorizationStore {
  beforeLockedRead?: () => void;

  constructor(public current: AuthorizationSnapshot) {}

  async readAuthorizationSnapshot(): Promise<AuthorizationSnapshot> {
    return this.current;
  }

  async withLockedAuthorizationSnapshot<Result>(
    request: AuthorizationRequest,
    run: (snapshot: AuthorizationSnapshot) => Promise<Result>,
  ): Promise<Result> {
    void request;
    this.beforeLockedRead?.();
    return run(this.current);
  }
}

async function expectDenied(
  store: AssignmentAuthorizationStore,
  request: AuthorizationRequest,
): Promise<void> {
  const operation = vi.fn(async () => "should-not-run");
  await expect(withAssignmentAuthorization(store, request, operation)).rejects.toBeInstanceOf(
    AccessDeniedError,
  );
  expect(operation).not.toHaveBeenCalled();
}

describe("withAssignmentAuthorization", () => {
  it("allows the assigned student and checks again at the elevated boundary", async () => {
    const store = new MemoryAuthorizationStore(studentSnapshot());
    const operation = vi.fn(async (capability) => capability);

    const result = await withAssignmentAuthorization(
      store,
      {
        authUserId: STUDENT_AUTH_ID,
        assignmentId: ASSIGNMENT_ID,
        expectedCaseVersionDigest: CASE_VERSION_DIGEST,
        expectedAttemptNumber: 1,
        action: "student-write",
        expectedBlindPolicyVersion: 1,
      },
      operation,
    );

    expect(result).toEqual({
      actorGithubUserId: STUDENT_GITHUB_ID,
      assignmentId: ASSIGNMENT_ID,
      action: "student-write",
      blindPolicyVersion: 1,
    });
    expect(operation).toHaveBeenCalledOnce();
  });

  it("denies an anonymous request without revealing assignment existence", async () => {
    await expectDenied(
      new MemoryAuthorizationStore({
        actor: null,
        context: null,
        attemptOneSubmissionAccepted: false,
      }),
      {
      authUserId: null,
      assignmentId: ASSIGNMENT_ID,
      expectedCaseVersionDigest: CASE_VERSION_DIGEST,
      expectedAttemptNumber: 1,
      action: "student-read",
      expectedBlindPolicyVersion: 1,
      },
    );
  });

  it("denies the wrong student", async () => {
    const store = new MemoryAuthorizationStore({
      actor: {
        authUserId: "auth-wrong-student",
        githubUserId: "303",
        roles: ["student"],
      },
      context: context(),
      attemptOneSubmissionAccepted: false,
    });
    await expectDenied(store, {
      authUserId: "auth-wrong-student",
      assignmentId: ASSIGNMENT_ID,
      expectedCaseVersionDigest: CASE_VERSION_DIGEST,
      expectedAttemptNumber: 1,
      action: "student-read",
      expectedBlindPolicyVersion: 1,
    });
  });

  it("allows staff only for the exact case version and granted action", async () => {
    const store = new MemoryAuthorizationStore(staffSnapshot());
    await expect(
      withAssignmentAuthorization(
        store,
        {
          authUserId: STAFF_AUTH_ID,
          assignmentId: ASSIGNMENT_ID,
          expectedCaseVersionDigest: CASE_VERSION_DIGEST,
          expectedAttemptNumber: 1,
          action: "staff-read-protected-case",
          expectedBlindPolicyVersion: 1,
        },
        async () => "allowed",
      ),
    ).resolves.toBe("allowed");

    const unauthorized: AuthorizationSnapshot = {
      ...staffSnapshot(),
      context: context(),
    };
    await expectDenied(new MemoryAuthorizationStore(unauthorized), {
      authUserId: STAFF_AUTH_ID,
      assignmentId: ASSIGNMENT_ID,
      expectedCaseVersionDigest: CASE_VERSION_DIGEST,
      expectedAttemptNumber: 1,
      action: "staff-read-protected-case",
      expectedBlindPolicyVersion: 1,
    });
  });

  it("denies the blind staff assignee before Attempt 1 is submitted", async () => {
    await expectDenied(new MemoryAuthorizationStore(studentSnapshot()), {
      authUserId: STUDENT_AUTH_ID,
      assignmentId: ASSIGNMENT_ID,
      expectedCaseVersionDigest: CASE_VERSION_DIGEST,
      expectedAttemptNumber: 1,
      action: "staff-read-protected-case",
      expectedBlindPolicyVersion: 1,
    });
  });

  it("restores case-scoped staff access only after Attempt 1 is submitted", async () => {
    const restored = studentSnapshot({
      attemptStatus: "submitted",
      staffAuthorization: {
        authorizationId: "grant-student-staff",
        githubUserId: STUDENT_GITHUB_ID,
        caseId: "support-routing",
        caseVersionDigest: CASE_VERSION_DIGEST,
        allowedActions: ["staff-read-protected-case"],
      },
    });
    await expect(
      withAssignmentAuthorization(
        new MemoryAuthorizationStore(restored),
        {
          authUserId: STUDENT_AUTH_ID,
          assignmentId: ASSIGNMENT_ID,
          expectedCaseVersionDigest: CASE_VERSION_DIGEST,
          expectedAttemptNumber: 1,
          action: "staff-read-protected-case",
          expectedBlindPolicyVersion: 1,
        },
        async () => "restored",
      ),
    ).resolves.toBe("restored");
  });

  it("does not restore blind access from a submitted label without the atomic submission record", async () => {
    const inconsistent = {
      ...studentSnapshot({
        attemptStatus: "submitted",
        staffAuthorization: {
          authorizationId: "grant-student-staff",
          githubUserId: STUDENT_GITHUB_ID,
          caseId: "support-routing",
          caseVersionDigest: CASE_VERSION_DIGEST,
          allowedActions: ["staff-read-protected-case"],
        },
      }),
      attemptOneSubmissionAccepted: false,
    };
    await expectDenied(new MemoryAuthorizationStore(inconsistent), {
      authUserId: STUDENT_AUTH_ID,
      assignmentId: ASSIGNMENT_ID,
      expectedCaseVersionDigest: CASE_VERSION_DIGEST,
      expectedAttemptNumber: 1,
      action: "staff-read-protected-case",
      expectedBlindPolicyVersion: 1,
    });
  });

  it("denies student writes once the current attempt is submitted", async () => {
    await expectDenied(
      new MemoryAuthorizationStore(studentSnapshot({ attemptStatus: "submitted" })),
      {
        authUserId: STUDENT_AUTH_ID,
        assignmentId: ASSIGNMENT_ID,
        expectedCaseVersionDigest: CASE_VERSION_DIGEST,
        expectedAttemptNumber: 1,
        action: "student-write",
        expectedBlindPolicyVersion: 1,
      },
    );
  });

  it("denies stale role state that changes before the elevated operation", async () => {
    const store = new MemoryAuthorizationStore(staffSnapshot());
    store.beforeLockedRead = () => {
      store.current = {
        ...staffSnapshot(),
        actor: {
          authUserId: STAFF_AUTH_ID,
          githubUserId: STAFF_GITHUB_ID,
          roles: [],
        },
        attemptOneSubmissionAccepted: false,
      };
    };
    await expectDenied(store, {
      authUserId: STAFF_AUTH_ID,
      assignmentId: ASSIGNMENT_ID,
      expectedCaseVersionDigest: CASE_VERSION_DIGEST,
      expectedAttemptNumber: 1,
      action: "staff-read-protected-case",
      expectedBlindPolicyVersion: 1,
    });
  });

  it("denies stale blind-policy versions before and during an elevated operation", async () => {
    await expectDenied(new MemoryAuthorizationStore(staffSnapshot()), {
      authUserId: STAFF_AUTH_ID,
      assignmentId: ASSIGNMENT_ID,
      expectedCaseVersionDigest: CASE_VERSION_DIGEST,
      expectedAttemptNumber: 1,
      action: "staff-read-protected-case",
      expectedBlindPolicyVersion: 2,
    });

    const store = new MemoryAuthorizationStore(staffSnapshot());
    store.beforeLockedRead = () => {
      store.current = staffSnapshot({
        requiredBlindPolicy: {
          policyId: "blind-a-v2",
          policyVersion: 2,
          assignmentId: ASSIGNMENT_ID,
          caseId: "support-routing",
          caseVersionDigest: CASE_VERSION_DIGEST,
          mode: "none",
        },
        blindPolicy: {
          policyId: "blind-a-v2",
          policyVersion: 2,
          assignmentId: ASSIGNMENT_ID,
          caseId: "support-routing",
          caseVersionDigest: CASE_VERSION_DIGEST,
          mode: "none",
        },
      });
    };
    await expectDenied(store, {
      authUserId: STAFF_AUTH_ID,
      assignmentId: ASSIGNMENT_ID,
      expectedCaseVersionDigest: CASE_VERSION_DIGEST,
      expectedAttemptNumber: 1,
      action: "staff-read-protected-case",
      expectedBlindPolicyVersion: 1,
    });
  });

  it("denies cross-assignment identifiers", async () => {
    await expectDenied(
      new MemoryAuthorizationStore(
        studentSnapshot({ requestedAssignmentId: "assignment-b" }),
      ),
      {
        authUserId: STUDENT_AUTH_ID,
        assignmentId: ASSIGNMENT_ID,
        expectedCaseVersionDigest: CASE_VERSION_DIGEST,
        expectedAttemptNumber: 1,
        action: "student-read",
        expectedBlindPolicyVersion: 1,
      },
    );
  });

  it("denies request B when the store returns an otherwise valid snapshot for assignment A", async () => {
    await expectDenied(new MemoryAuthorizationStore(studentSnapshot()), {
      authUserId: STUDENT_AUTH_ID,
      assignmentId: "assignment-b",
      expectedCaseVersionDigest: CASE_VERSION_DIGEST,
      expectedAttemptNumber: 1,
      action: "student-read",
      expectedBlindPolicyVersion: 1,
    });
  });

  it("denies a request whose pinned case version does not match the assignment snapshot", async () => {
    await expectDenied(new MemoryAuthorizationStore(studentSnapshot()), {
      authUserId: STUDENT_AUTH_ID,
      assignmentId: ASSIGNMENT_ID,
      expectedCaseVersionDigest: `sha256:${"b".repeat(64)}`,
      expectedAttemptNumber: 1,
      action: "student-read",
      expectedBlindPolicyVersion: 1,
    });
  });

  it("denies Attempt 1 to Attempt 2 drift before the elevated operation", async () => {
    const store = new MemoryAuthorizationStore(studentSnapshot());
    store.beforeLockedRead = () => {
      store.current = studentSnapshot({ attemptNumber: 2 });
    };
    await expectDenied(store, {
      authUserId: STUDENT_AUTH_ID,
      assignmentId: ASSIGNMENT_ID,
      expectedCaseVersionDigest: CASE_VERSION_DIGEST,
      expectedAttemptNumber: 1,
      action: "student-read",
      expectedBlindPolicyVersion: 1,
    });
  });
});
