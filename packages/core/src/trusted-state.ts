import type { PublishedCase } from "./published-case.js";

export interface TrustedReleasedEvent {
  readonly eventId: string;
  readonly assignmentId: string;
  readonly attemptNumber: number;
  readonly caseVersionDigest: string;
  readonly sequence: number;
  readonly officialFactIds: readonly string[];
  readonly releasedEvidenceIds?: readonly string[];
  readonly providerInteractionId?: string;
}

export interface TrustedReleasedState {
  readonly assignmentId: string;
  readonly attemptNumber: number;
  readonly caseVersionDigest: string;
  readonly currentEventSequence: number;
  readonly events: readonly TrustedReleasedEvent[];
}

export function validateTrustedReleasedState(
  publishedCase: PublishedCase,
  state: TrustedReleasedState,
): readonly string[] {
  if (state.caseVersionDigest !== publishedCase.digests.caseVersionDigest) {
    throw new Error("Trusted release state belongs to a different case version");
  }
  const authoredFactIds = new Set(publishedCase.source.protected.facts.map(({ id }) => id));
  const authoredEvidenceIds = new Set(
    publishedCase.source.visible.evidenceSources.map(({ id }) => id),
  );
  const eventIds = new Set<string>();
  const eventSequences = new Set<number>();
  const releasedFactIds = new Set<string>();
  for (const event of state.events) {
    if (
      event.assignmentId !== state.assignmentId ||
      event.attemptNumber !== state.attemptNumber ||
      event.caseVersionDigest !== state.caseVersionDigest ||
      event.sequence > state.currentEventSequence ||
      !Number.isInteger(event.sequence) ||
      event.sequence < 0 ||
      event.eventId.length === 0 ||
      eventIds.has(event.eventId) ||
      eventSequences.has(event.sequence)
    ) {
      throw new Error("Trusted release state contains an invalid or duplicate event");
    }
    eventIds.add(event.eventId);
    eventSequences.add(event.sequence);
    for (const factId of event.officialFactIds) {
      if (!authoredFactIds.has(factId)) {
        throw new Error(`Trusted release event references unauthored fact ${factId}`);
      }
      releasedFactIds.add(factId);
    }
    for (const evidenceId of event.releasedEvidenceIds ?? []) {
      if (!authoredEvidenceIds.has(evidenceId)) {
        throw new Error(`Trusted release event references unauthored evidence ${evidenceId}`);
      }
    }
  }
  return [...releasedFactIds].sort();
}
