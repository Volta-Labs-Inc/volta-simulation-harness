import type {
  ActionOperationStore,
  OfficialTruthEvent,
  OperationStoreBinding,
  SimulationTruthState,
  StoredOperationRecord,
  TruthStateStore,
} from "./types.js";

function operationKey(assignmentId: string, attemptNumber: number, operationId: string): string {
  return `${assignmentId}\u0000${attemptNumber}\u0000${operationId}`;
}

function stateKey(assignmentId: string, attemptNumber: number): string {
  return `${assignmentId}\u0000${attemptNumber}`;
}

function copy<T>(value: T): T {
  return structuredClone(value);
}

export class InMemoryActionOperationStore implements ActionOperationStore {
  private readonly records = new Map<
    string,
    { readonly binding: OperationStoreBinding; readonly record: StoredOperationRecord }
  >();
  private readonly pending = new Map<
    string,
    { readonly binding: OperationStoreBinding; readonly promise: Promise<StoredOperationRecord> }
  >();

  async executeIdempotent(
    assignmentId: string,
    attemptNumber: number,
    operationId: string,
    binding: OperationStoreBinding,
    run: () => Promise<StoredOperationRecord>,
  ): Promise<{ readonly record: StoredOperationRecord; readonly reused: boolean }> {
    assertValidBinding(binding);
    const key = operationKey(assignmentId, attemptNumber, operationId);
    const existing = this.records.get(key);
    if (existing !== undefined) {
      assertSameBinding(existing.binding, binding);
      return { record: copy(existing.record), reused: true };
    }
    const inFlight = this.pending.get(key);
    if (inFlight !== undefined) {
      assertSameBinding(inFlight.binding, binding);
      return { record: copy(await inFlight.promise), reused: true };
    }

    const promise = run();
    this.pending.set(key, { binding: copy(binding), promise });
    try {
      const record = await promise;
      if (
        record.assignmentId !== assignmentId ||
        record.operationId !== operationId ||
        record.attemptNumber !== attemptNumber ||
        record.caseVersionDigest !== binding.caseVersionDigest ||
        record.operationFingerprint !== binding.operationFingerprint ||
        recordOperationType(record) !== binding.operationType
      ) {
        throw new Error("An idempotent operation returned a record with different bindings");
      }
      this.records.set(key, { binding: copy(binding), record: copy(record) });
      return { record: copy(record), reused: false };
    } finally {
      this.pending.delete(key);
    }
  }

  async read(
    assignmentId: string,
    attemptNumber: number,
    operationId: string,
  ): Promise<StoredOperationRecord | undefined> {
    const entry = this.records.get(operationKey(assignmentId, attemptNumber, operationId));
    if (entry === undefined) return undefined;
    const record = entry.record;
    if (
      record.assignmentId !== assignmentId ||
      record.attemptNumber !== attemptNumber ||
      record.operationId !== operationId ||
      record.caseVersionDigest !== entry.binding.caseVersionDigest ||
      record.operationFingerprint !== entry.binding.operationFingerprint ||
      recordOperationType(record) !== entry.binding.operationType
    ) {
      throw new Error("Stored operation binding validation failed");
    }
    return copy(record);
  }
}

function recordOperationType(record: StoredOperationRecord): OperationStoreBinding["operationType"] {
  return record.kind === "replayed" || "originalOperationId" in record ? "replay" : "action";
}

function assertSameBinding(
  existing: OperationStoreBinding,
  requested: OperationStoreBinding,
): void {
  if (existing.operationType !== requested.operationType) {
    throw new Error("The operation ID is already bound to a different operation type");
  }
  if (
    existing.operationFingerprint !== requested.operationFingerprint ||
    existing.caseVersionDigest !== requested.caseVersionDigest
  ) {
    throw new Error("The idempotent operation ID is already bound to different consequential input");
  }
}

function assertValidBinding(binding: OperationStoreBinding): void {
  if (
    (binding.operationType !== "action" && binding.operationType !== "replay") ||
    !/^sha256:[a-f0-9]{64}$/u.test(binding.operationFingerprint) ||
    !/^sha256:[a-f0-9]{64}$/u.test(binding.caseVersionDigest)
  ) {
    throw new Error("The idempotent operation binding is invalid");
  }
}

export function createInitialTruthState(input: {
  readonly assignmentId: string;
  readonly attemptNumber: number;
  readonly caseVersionDigest: string;
  readonly evaluationMarker?: string;
}): SimulationTruthState {
  return {
    assignmentId: input.assignmentId,
    attemptNumber: input.attemptNumber,
    caseVersionDigest: input.caseVersionDigest,
    currentEventSequence: 0,
    stateVersion: 0,
    events: [],
    officialEvents: [],
    elapsed: { minutes: 0, hours: 0, days: 0 },
    resources: {},
    reviewGuidance: [],
    evaluationMarker: input.evaluationMarker ?? "human-evaluation-unchanged",
  };
}

export class InMemoryTruthStateStore implements TruthStateStore {
  private readonly states = new Map<string, SimulationTruthState>();

  constructor(initialStates: readonly SimulationTruthState[]) {
    for (const state of initialStates) {
      const key = stateKey(state.assignmentId, state.attemptNumber);
      if (this.states.has(key)) throw new Error("Duplicate initial truth state");
      this.states.set(key, copy(state));
    }
  }

  async read(assignmentId: string, attemptNumber: number): Promise<SimulationTruthState> {
    const state = this.states.get(stateKey(assignmentId, attemptNumber));
    if (state === undefined) throw new Error("The requested assignment state is not available");
    return copy(state);
  }

  async commitEvent(input: {
    readonly assignmentId: string;
    readonly attemptNumber: number;
    readonly caseVersionDigest: string;
    readonly expectedStateVersion: number;
    readonly authorizationRecheck: {
      readonly actorGithubUserId: string;
      readonly action: "student-write";
      readonly blindPolicyVersion: number;
    };
    readonly event: Omit<OfficialTruthEvent, "eventId" | "sequence">;
  }): Promise<{ readonly state: SimulationTruthState; readonly event: OfficialTruthEvent }> {
    const key = stateKey(input.assignmentId, input.attemptNumber);
    const current = this.states.get(key);
    if (current === undefined) throw new Error("The requested assignment state is not available");
    if (
      current.assignmentId !== input.assignmentId ||
      current.attemptNumber !== input.attemptNumber ||
      current.caseVersionDigest !== input.caseVersionDigest ||
      current.stateVersion !== input.expectedStateVersion
    ) {
      throw new Error("The simulation state changed before the official outcome could commit");
    }
    if (
      input.event.assignmentId !== current.assignmentId ||
      input.event.attemptNumber !== current.attemptNumber ||
      input.event.caseVersionDigest !== current.caseVersionDigest
    ) {
      throw new Error("The official event does not belong to the locked assignment state");
    }
    if (
      input.authorizationRecheck.actorGithubUserId.length === 0 ||
      input.authorizationRecheck.action !== "student-write" ||
      !Number.isInteger(input.authorizationRecheck.blindPolicyVersion) ||
      input.authorizationRecheck.blindPolicyVersion < 1
    ) {
      throw new Error("The official event lacks a current locked authorization recheck");
    }
    if (current.officialEvents.some(({ operationId }) => operationId === input.event.operationId)) {
      throw new Error("The operation already has an official truth event");
    }

    const sequence = current.currentEventSequence + 1;
    const event: OfficialTruthEvent = {
      ...copy(input.event),
      eventId: `event-${sequence}`,
      sequence,
    };
    const resources = { ...current.resources };
    for (const resource of event.resources) {
      const existing = resources[resource.id];
      if (existing !== undefined && existing.unit !== resource.unit) {
        throw new Error("A resource cannot change units within one attempt");
      }
      resources[resource.id] = {
        amount: (existing?.amount ?? 0) + resource.amount,
        unit: resource.unit,
      };
    }
    const elapsed = {
      ...current.elapsed,
      [event.time.unit]: current.elapsed[event.time.unit] + event.time.amount,
    };
    const next: SimulationTruthState = {
      ...current,
      currentEventSequence: sequence,
      stateVersion: current.stateVersion + 1,
      events: [
        ...current.events,
        {
          eventId: event.eventId,
          assignmentId: event.assignmentId,
          attemptNumber: event.attemptNumber,
          caseVersionDigest: event.caseVersionDigest,
          sequence: event.sequence,
          officialFactIds: [...event.officialFactIds],
          releasedEvidenceIds: [...event.releasedEvidenceIds],
          providerInteractionId: event.providerInteractionId,
        },
      ],
      officialEvents: [...current.officialEvents, event],
      elapsed,
      resources,
      reviewGuidance:
        event.reviewGuidance === undefined
          ? current.reviewGuidance
          : [
              ...current.reviewGuidance,
              { eventId: event.eventId, routeId: event.routeId, guidance: event.reviewGuidance },
            ],
    };
    this.states.set(key, copy(next));
    return { state: copy(next), event: copy(event) };
  }
}
