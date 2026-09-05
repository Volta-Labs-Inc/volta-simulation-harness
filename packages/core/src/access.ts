export type HarnessRole = "student" | "staff" | "case-author";

export interface ActorIdentity {
  readonly githubUserId: string;
  readonly roles: readonly HarnessRole[];
}

export type AssignmentAction =
  | "student-read"
  | "student-write"
  | "staff-read-timeline"
  | "staff-read-protected-case"
  | "staff-evaluate"
  | "staff-author-case";

export type BlindPolicy =
  | {
      readonly policyId: string;
      readonly policyVersion: number;
      readonly assignmentId: string;
      readonly caseId: string;
      readonly caseVersionDigest: string;
      readonly mode: "none";
    }
  | {
      readonly policyId: string;
      readonly policyVersion: number;
      readonly assignmentId: string;
      readonly caseId: string;
      readonly caseVersionDigest: string;
      readonly mode: "attempt-one";
      readonly blindStudentGithubUserId: string;
    };

export interface CaseStaffAuthorization {
  readonly authorizationId: string;
  readonly githubUserId: string;
  readonly caseId: string;
  readonly caseVersionDigest: string;
  readonly allowedActions: readonly Exclude<AssignmentAction, "student-read" | "student-write">[];
}

export interface AssignmentAccessContext {
  readonly assignmentId: string;
  readonly requestedAssignmentId: string;
  readonly caseId: string;
  readonly caseVersionDigest: string;
  readonly studentGithubUserId: string;
  readonly attemptNumber: number;
  readonly attemptStatus: "active" | "submitted";
  readonly requiredBlindPolicy: BlindPolicy;
  readonly blindPolicy?: BlindPolicy;
  readonly staffAuthorization?: CaseStaffAuthorization;
}

export interface AccessDecision {
  readonly allowed: boolean;
  readonly reason:
    | "assignment-member"
    | "case-scoped-authorization"
    | "assignment-not-found"
    | "student-identity-mismatch"
    | "role-required"
    | "case-authorization-required"
    | "missing-blind-policy"
    | "stale-blind-policy"
    | "attempt-one-blind-override";
}

const staffActions = new Set<AssignmentAction>([
  "staff-read-timeline",
  "staff-read-protected-case",
  "staff-evaluate",
  "staff-author-case",
]);

function blindPolicyIsCurrent(context: AssignmentAccessContext, policy: BlindPolicy): boolean {
  const required = context.requiredBlindPolicy;
  return (
    policy.policyId === required.policyId &&
    policy.policyVersion === required.policyVersion &&
    policy.assignmentId === context.assignmentId &&
    policy.caseId === context.caseId &&
    policy.caseVersionDigest === context.caseVersionDigest &&
    policy.mode === required.mode &&
    (policy.mode !== "attempt-one" ||
      (required.mode === "attempt-one" &&
        policy.blindStudentGithubUserId === required.blindStudentGithubUserId))
  );
}

export function decideAssignmentAccess(
  actor: ActorIdentity,
  context: AssignmentAccessContext,
  action: AssignmentAction,
): AccessDecision {
  if (context.requestedAssignmentId !== context.assignmentId) {
    return { allowed: false, reason: "assignment-not-found" };
  }

  if (action === "student-read" || action === "student-write") {
    return actor.githubUserId === context.studentGithubUserId
      ? { allowed: true, reason: "assignment-member" }
      : { allowed: false, reason: "student-identity-mismatch" };
  }

  if (!staffActions.has(action)) return { allowed: false, reason: "role-required" };
  if (context.blindPolicy === undefined) {
    return { allowed: false, reason: "missing-blind-policy" };
  }
  if (!blindPolicyIsCurrent(context, context.blindPolicy)) {
    return { allowed: false, reason: "stale-blind-policy" };
  }

  const blindAttemptOne =
    context.blindPolicy.mode === "attempt-one" &&
    context.attemptNumber === 1 &&
    context.attemptStatus === "active" &&
    actor.githubUserId === context.blindPolicy.blindStudentGithubUserId;
  if (blindAttemptOne) {
    return { allowed: false, reason: "attempt-one-blind-override" };
  }

  const requiredRole = action === "staff-author-case" ? "case-author" : "staff";
  if (!actor.roles.includes(requiredRole)) return { allowed: false, reason: "role-required" };

  const authorization = context.staffAuthorization;
  if (
    authorization === undefined ||
    authorization.githubUserId !== actor.githubUserId ||
    authorization.caseId !== context.caseId ||
    authorization.caseVersionDigest !== context.caseVersionDigest ||
    !authorization.allowedActions.includes(action)
  ) {
    return { allowed: false, reason: "case-authorization-required" };
  }

  return { allowed: true, reason: "case-scoped-authorization" };
}
