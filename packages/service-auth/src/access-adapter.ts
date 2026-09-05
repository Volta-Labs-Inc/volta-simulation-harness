import {
  decideAssignmentAccess,
  type ActorIdentity,
  type AssignmentAccessContext,
  type AssignmentAction,
} from "@volta-sim/core";

export interface AuthenticatedActor extends ActorIdentity {
  readonly authUserId: string;
}

export interface AuthorizationSnapshot {
  readonly actor: AuthenticatedActor | null;
  readonly context: AssignmentAccessContext | null;
  /** True only when Attempt 1's immutable submission and state transition committed together. */
  readonly attemptOneSubmissionAccepted: boolean;
}

export interface AuthorizationRequest {
  readonly authUserId: string | null;
  readonly assignmentId: string;
  readonly expectedCaseVersionDigest: string;
  readonly expectedAttemptNumber: number;
  readonly action: AssignmentAction;
  readonly expectedBlindPolicyVersion: number;
}

export interface ElevatedCapability {
  readonly actorGithubUserId: string;
  readonly assignmentId: string;
  readonly action: AssignmentAction;
  readonly blindPolicyVersion: number;
}

export interface AssignmentAuthorizationStore {
  /**
   * Reads identity from the provider-backed identity record and current assignment state.
   * Implementations must not construct roles from user_metadata or other editable claims.
   */
  readAuthorizationSnapshot(request: AuthorizationRequest): Promise<AuthorizationSnapshot>;

  /**
   * Reloads and locks the same authorization state immediately before elevated work.
   * The callback and write must share one transaction or equivalent serialization boundary.
   */
  withLockedAuthorizationSnapshot<Result>(
    request: AuthorizationRequest,
    run: (snapshot: AuthorizationSnapshot) => Promise<Result>,
  ): Promise<Result>;
}

export class AccessDeniedError extends Error {
  readonly code = "ACCESS_DENIED";

  constructor(readonly internalReason: string) {
    super("The requested assignment action is not available");
    this.name = "AccessDeniedError";
  }
}

function deny(reason: string): never {
  throw new AccessDeniedError(reason);
}

function currentDecision(
  request: AuthorizationRequest,
  snapshot: AuthorizationSnapshot,
): { readonly actor: AuthenticatedActor; readonly context: AssignmentAccessContext } {
  if (request.authUserId === null || snapshot.actor === null || snapshot.context === null) {
    return deny("missing-authenticated-assignment-context");
  }
  if (snapshot.actor.authUserId !== request.authUserId) {
    return deny("authenticated-identity-mismatch");
  }
  if (
    snapshot.context.assignmentId !== request.assignmentId ||
    snapshot.context.requestedAssignmentId !== request.assignmentId
  ) {
    return deny("assignment-context-mismatch");
  }
  if (snapshot.context.caseVersionDigest !== request.expectedCaseVersionDigest) {
    return deny("case-version-context-mismatch");
  }
  if (snapshot.context.attemptNumber !== request.expectedAttemptNumber) {
    return deny("attempt-context-mismatch");
  }
  if (request.action === "student-write" && snapshot.context.attemptStatus !== "active") {
    return deny("attempt-not-active");
  }
  if (
    snapshot.context.requiredBlindPolicy.mode === "attempt-one" &&
    snapshot.actor.githubUserId ===
      snapshot.context.requiredBlindPolicy.blindStudentGithubUserId &&
    snapshot.context.attemptNumber === 1 &&
    snapshot.context.attemptStatus === "submitted" &&
    !snapshot.attemptOneSubmissionAccepted
  ) {
    return deny("attempt-one-submission-not-atomically-confirmed");
  }
  if (
    snapshot.context.requiredBlindPolicy.policyVersion !== request.expectedBlindPolicyVersion ||
    snapshot.context.blindPolicy?.policyVersion !== request.expectedBlindPolicyVersion
  ) {
    return deny("stale-blind-policy-version");
  }

  const decision = decideAssignmentAccess(snapshot.actor, snapshot.context, request.action);
  if (!decision.allowed) return deny(decision.reason);
  return { actor: snapshot.actor, context: snapshot.context };
}

/**
 * Checks access once for an early refusal, then checks newly loaded state again inside
 * the store's locked write boundary. An elevated credential is never treated as authority.
 */
export async function withAssignmentAuthorization<Result>(
  store: AssignmentAuthorizationStore,
  request: AuthorizationRequest,
  operation: (capability: ElevatedCapability) => Promise<Result>,
): Promise<Result> {
  const first = currentDecision(request, await store.readAuthorizationSnapshot(request));

  return store.withLockedAuthorizationSnapshot(request, async (freshSnapshot) => {
    const fresh = currentDecision(request, freshSnapshot);
    if (
      fresh.actor.githubUserId !== first.actor.githubUserId ||
      fresh.context.assignmentId !== first.context.assignmentId ||
      fresh.context.caseVersionDigest !== first.context.caseVersionDigest ||
      fresh.context.attemptNumber !== first.context.attemptNumber
    ) {
      return deny("authorization-state-changed");
    }

    return operation({
      actorGithubUserId: fresh.actor.githubUserId,
      assignmentId: fresh.context.assignmentId,
      action: request.action,
      blindPolicyVersion: fresh.context.requiredBlindPolicy.policyVersion,
    });
  });
}
