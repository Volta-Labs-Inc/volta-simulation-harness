import { describe, expect, it } from "vitest";
import {
  COMPETENCY_IDS,
  acceptedSubmissionProjectionDigest,
  buildReplayComparison,
  buildStaffAssignmentView,
  createHumanEvaluation,
  createReviewResponse,
  exportEvaluationCsv,
  inertArtifactView,
  neutralizeSpreadsheetFormula,
  officialTimelineEventDigest,
  previewHumanEvaluation,
  providerRecordDigest,
  reopenEvaluatedAttempt,
  selectOfficialTimeline,
  sha256TextDigest,
  type EvaluationDraft,
  type EvaluatedAttemptSnapshot,
  type AcceptedSubmissionProjection,
  type OfficialTimelineEvent,
  type ProviderDisplayRecord,
  type StaffAssignmentSource,
  type StaffEvaluationRecord,
  type SubmissionArtifactReceipt,
  type TextArtifact,
  type TrustedProviderRecordReceipt,
} from "../src/index.js";

const digest = `sha256:${"a".repeat(64)}` as const;
const otherDigest = `sha256:${"b".repeat(64)}` as const;

type MutableEvaluationDraft = Omit<EvaluationDraft, "competencies"> & {
  competencies: Record<
    (typeof COMPETENCY_IDS)[number],
    {
      rating: "effective" | "partially-effective" | "not-yet-effective";
      rationale: string;
    }
  >;
};

function draft(overrides: Partial<EvaluationDraft> = {}): EvaluationDraft {
  return {
    competencies: {
      "problem-viability": {
        rating: "effective",
        rationale: "The recommendation follows the observed operational constraint.",
      },
      "evidence-sufficiency": {
        rating: "effective",
        rationale: "The limits of the current sample and the next collection step are explicit.",
      },
      "response-feasibility": {
        rating: "effective",
        rationale: "No build is proportionate while the remaining uncertainty is measured.",
      },
      "objective-success-criteria": {
        rating: "effective",
        rationale: "The baseline plan names a metric, comparison window, and stop threshold.",
      },
    },
    overallRationale: "A defensible no-build decision supported by a credible measurement plan.",
    ...overrides,
  };
}

function acceptedSubmission(
  overrides: Partial<Omit<AcceptedSubmissionProjection, "projectionDigest">> = {},
): AcceptedSubmissionProjection {
  const projection = {
    assignmentId: "assignment-a",
    attemptNumber: 1,
    caseVersionDigest: digest,
    submissionId: "submission-1",
    submissionDigest: digest,
    responseMode: "no-build",
    responseSummary: "Do not build until the observed queue pattern persists.",
    baselineKind: "credible-baseline-plan",
    baselineDetail: "Measure first-response time weekly for four weeks using the frozen sample.",
    source: "accepted-submission-readback",
    ...overrides,
  } as const;
  return { ...projection, projectionDigest: acceptedSubmissionProjectionDigest(projection) };
}

function evaluation(
  overrides: Partial<EvaluationDraft> = {},
  submissionOverrides: Partial<Omit<AcceptedSubmissionProjection, "projectionDigest">> = {},
): StaffEvaluationRecord {
  return createHumanEvaluation({
    evaluationId: "evaluation-1",
    operationId: "evaluate-submission-1",
    evaluatorGithubUserId: "99101",
    evaluatedAt: "2026-09-04T16:00:00.000Z",
    acceptedSubmission: acceptedSubmission(submissionOverrides),
    draft: draft(overrides),
  });
}

function mutableDraft(overrides: Partial<EvaluationDraft> = {}): MutableEvaluationDraft {
  return structuredClone(draft(overrides)) as MutableEvaluationDraft;
}

function providerRecord(
  overrides: Partial<ProviderDisplayRecord> = {},
): ProviderDisplayRecord {
  return {
    assignmentId: "assignment-a",
    attemptNumber: 1,
    caseVersionDigest: digest,
    eventId: "event-provider-1",
    eventSequence: 6,
    providerRecordReceiptId: "provider-record-receipt-original",
    interactionId: "interaction-original",
    providerId: "capture",
    modelId: "gpt-5-mini-2025-08-07",
    routeId: "route-queue-observation",
    officialFactIds: ["fact-wait-time"],
    releasedEvidenceIds: ["evidence-queue-sample"],
    renderedText: "The frozen sample records the observed wait time.",
    renderedTextIsAuthoritative: false,
    ...overrides,
  };
}

function providerReceipt(record: ProviderDisplayRecord): TrustedProviderRecordReceipt {
  return {
    receiptId: record.providerRecordReceiptId,
    interactionId: record.interactionId,
    assignmentId: record.assignmentId,
    attemptNumber: record.attemptNumber,
    caseVersionDigest: record.caseVersionDigest,
    eventId: record.eventId,
    eventSequence: record.eventSequence,
    recordDigest: providerRecordDigest(record),
    source: "provider-record-store-readback",
  };
}

function replayProviderRecord(
  original: ProviderDisplayRecord,
  overrides: Partial<ProviderDisplayRecord> = {},
): ProviderDisplayRecord {
  return providerRecord({
    interactionId: "interaction-replay",
    providerRecordReceiptId: "provider-record-receipt-replay",
    modelId: "gpt-4.1-mini-2025-04-14",
    replayOfInteractionId: original.interactionId,
    ...overrides,
  });
}

describe("human evaluation", () => {
  it("derives effective only from four effective human judgments and a credible baseline plan", () => {
    const result = evaluation();

    expect(result.overallRating).toBe("effective");
    expect(result.responseMode).toBe("no-build");
    expect(result.canonicalAnswerCompared).toBe(false);
    expect(Object.isFrozen(result)).toBe(true);
  });

  it("accepts distinct defensible outcomes without comparing either to a canonical answer", () => {
    const noBuild = previewHumanEvaluation(acceptedSubmission(), draft());
    const pilot = previewHumanEvaluation(
      acceptedSubmission({
        responseMode: "pilot",
        responseSummary: "Run a reversible two-week routing pilot with manual review.",
      }),
      draft(),
    );
    const dataCollection = previewHumanEvaluation(
      acceptedSubmission({
        responseMode: "data-collection",
        responseSummary: "Collect a stratified baseline before choosing whether to build.",
      }),
      draft(),
    );

    expect(noBuild).toMatchObject({ canSave: true, overallRating: "effective" });
    expect(pilot).toMatchObject({ canSave: true, overallRating: "effective" });
    expect(dataCollection).toMatchObject({ canSave: true, overallRating: "effective" });
    expect(noBuild.canonicalAnswerCompared).toBe(false);
    expect(pilot.canonicalAnswerCompared).toBe(false);
    expect(dataCollection.canonicalAnswerCompared).toBe(false);
  });

  it("blocks effective evidence and success judgments without a baseline or credible plan", () => {
    const preview = previewHumanEvaluation(
      acceptedSubmission({ baselineKind: "missing", baselineDetail: "" }),
      draft(),
    );

    expect(preview.overallRating).toBe("unavailable");
    expect(preview.canSave).toBe(false);
    expect(preview.issues).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/Evidence sufficiency cannot be effective/),
        expect.stringMatching(/Objective success criteria cannot be effective/),
      ]),
    );
    expect(() =>
      createHumanEvaluation({
        evaluationId: "evaluation-missing-baseline",
        operationId: "evaluate-missing-baseline",
        evaluatorGithubUserId: "99101",
        evaluatedAt: "2026-09-04T16:00:00.000Z",
        acceptedSubmission: acceptedSubmission({ baselineKind: "missing", baselineDetail: "" }),
        draft: draft(),
      }),
    ).toThrow(/baseline/);
  });

  it("requires all four human ratings and rationales", () => {
    const missing = mutableDraft() as unknown as {
      competencies: Partial<MutableEvaluationDraft["competencies"]>;
    };
    delete missing.competencies["objective-success-criteria"];

    const preview = previewHumanEvaluation(
      acceptedSubmission(),
      missing as unknown as EvaluationDraft,
    );
    expect(preview.canSave).toBe(false);
    expect(preview.issues.join(" ")).toMatch(/four competency|objective-success-criteria/);

    for (const competencyId of COMPETENCY_IDS) {
      const changed = mutableDraft();
      changed.competencies[competencyId].rationale = "";
      expect(previewHumanEvaluation(acceptedSubmission(), changed).canSave).toBe(false);
    }
  });

  it("derives a lower overall result when any human competency is lower", () => {
    const changed = mutableDraft();
    changed.competencies["response-feasibility"].rating = "not-yet-effective";

    expect(previewHumanEvaluation(acceptedSubmission(), changed)).toMatchObject({
      canSave: true,
      overallRating: "partially-effective",
    });
  });

  it("rejects malformed accepted-submission projections", () => {
    const malformed = {
      ...acceptedSubmission(),
      submissionId: "NOT AN ID",
      responseMode: "model-decides",
      baselineKind: "probably-fine",
    } as unknown as AcceptedSubmissionProjection;

    expect(previewHumanEvaluation(malformed, draft())).toMatchObject({
      canSave: false,
      overallRating: "unavailable",
      issues: [expect.stringMatching(/verified immutable accepted-submission/)],
    });
    expect(
      previewHumanEvaluation(null as unknown as AcceptedSubmissionProjection, draft()).canSave,
    ).toBe(false);
  });

  it("rejects caller-supplied response facts instead of evaluating a mismatched projection", () => {
    const projection = acceptedSubmission({
      responseMode: "pilot",
      responseSummary: "Run the accepted reversible pilot.",
    });
    expect(() =>
      createHumanEvaluation({
        evaluationId: "evaluation-bound",
        operationId: "evaluate-bound",
        evaluatorGithubUserId: "99101",
        evaluatedAt: "2026-09-04T16:00:00.000Z",
        acceptedSubmission: projection,
        draft: {
          ...draft(),
          responseMode: "no-build",
          responseSummary: "CALLER_CHOSEN_CANARY",
        } as EvaluationDraft,
      }),
    ).toThrow(/must not supply or replace accepted-submission response facts/);
  });
});

describe("staff authorization and official activity", () => {
  const officialEvent: OfficialTimelineEvent = {
    assignmentId: "assignment-a",
    attemptNumber: 1,
    caseVersionDigest: digest,
    sequence: 1,
    eventId: "event-1",
    kind: "evidence-released",
    occurredAt: "2026-09-04T13:00:00.000Z",
    actorLabel: "Harness",
    title: "Queue sample released",
    detail: "The authored sample became visible.",
    officialFactIds: ["fact-wait-time"],
    releasedEvidenceIds: ["evidence-queue-sample"],
    source: "official-event-store",
    officialEventReceiptId: "official-event-receipt-1",
  };
  const assignment: StaffAssignmentSource = {
    assignmentId: "assignment-a",
    caseId: "case-public-fixture",
    caseTitle: "Civic desk routing study",
    studentLabel: "Student 01",
    caseVersionDigest: digest,
    attemptNumber: 1,
    lifecycleState: "submitted",
    repositoryReadback: "ready",
    hiddenEvaluationAnchor: "PROTECTED_ANCHOR_CANARY",
    privateAgentTranscript: "PRIVATE_AGENT_TRANSCRIPT_CANARY",
    officialEventReceipts: [
      {
        receiptId: officialEvent.officialEventReceiptId,
        eventId: officialEvent.eventId,
        assignmentId: officialEvent.assignmentId,
        attemptNumber: officialEvent.attemptNumber,
        caseVersionDigest: officialEvent.caseVersionDigest,
        sequence: officialEvent.sequence,
        eventDigest: officialTimelineEventDigest(officialEvent),
        source: "official-event-store-readback",
      },
    ],
    timeline: [
      {
        ...officialEvent,
        privateAgentTranscript: "PRIVATE_EVENT_CANARY",
      },
      {
        eventId: "private-1",
        kind: "decision",
        occurredAt: "2026-09-04T13:01:00.000Z",
        actorLabel: "Private agent",
        title: "Should never render",
        detail: "PRIVATE_TIMELINE_CANARY",
        officialFactIds: [],
        releasedEvidenceIds: [],
        source: "official-event-store",
        officialEventReceiptId: "forged-official-receipt",
      },
    ],
  };

  it("denies blind staff before Attempt 1 acceptance without leaking assignment fields", () => {
    const view = buildStaffAssignmentView(
      {
        githubUserId: "99102",
        role: "staff",
        authorizedAssignmentIds: ["assignment-a"],
        blindAssignmentIds: ["assignment-a"],
        acceptedAttemptOneAssignmentIds: [],
      },
      "assignment-a",
      [assignment],
    );

    expect(view).toEqual({ allowed: false, reason: "not-found-or-not-authorized" });
    expect(JSON.stringify(view)).not.toContain("CANARY");
  });

  it("allows authorized non-blind staff and exposes only allowlisted official events", () => {
    const view = buildStaffAssignmentView(
      {
        githubUserId: "99101",
        role: "staff",
        authorizedAssignmentIds: ["assignment-a"],
        blindAssignmentIds: [],
        acceptedAttemptOneAssignmentIds: [],
      },
      "assignment-a",
      [assignment],
    );

    expect(view.allowed).toBe(true);
    if (!view.allowed) throw new Error("Expected staff view");
    expect(view.assignment.stateAuthority).toBe("persisted-service-and-provider-readback");
    expect(view.assignment.timeline).toHaveLength(1);
    expect(JSON.stringify(view)).not.toContain("CANARY");
  });

  it("restores a blind staff view only after Attempt 1 acceptance", () => {
    const view = buildStaffAssignmentView(
      {
        githubUserId: "99102",
        role: "staff",
        authorizedAssignmentIds: ["assignment-a"],
        blindAssignmentIds: ["assignment-a"],
        acceptedAttemptOneAssignmentIds: ["assignment-a"],
      },
      "assignment-a",
      [assignment],
    );

    expect(view.allowed).toBe(true);
  });

  it("projects every authoritative assignment lifecycle state without browser inference", () => {
    const states = [
      "provisioning",
      "active",
      "review-requested",
      "submitted",
      "reopened",
      "closed",
    ] as const;

    for (const lifecycleState of states) {
      const view = buildStaffAssignmentView(
        {
          githubUserId: "99101",
          role: "staff",
          authorizedAssignmentIds: ["assignment-a"],
          blindAssignmentIds: [],
          acceptedAttemptOneAssignmentIds: [],
        },
        "assignment-a",
        [{ ...assignment, lifecycleState }],
      );

      expect(view.allowed).toBe(true);
      if (!view.allowed) throw new Error("Expected staff view");
      expect(view.assignment.lifecycleState).toBe(lifecycleState);
    }
  });

  it("fails closed for malformed viewer or authoritative assignment state", () => {
    const viewer = {
      githubUserId: "99101",
      role: "staff",
      authorizedAssignmentIds: ["assignment-a"],
      blindAssignmentIds: [],
      acceptedAttemptOneAssignmentIds: [],
    } as const;

    expect(
      buildStaffAssignmentView(
        { ...viewer, authorizedAssignmentIds: null } as unknown as typeof viewer,
        "assignment-a",
        [assignment],
      ),
    ).toEqual({ allowed: false, reason: "not-found-or-not-authorized" });
    expect(
      buildStaffAssignmentView(viewer, "assignment-a", [
        { ...assignment, caseVersionDigest: "unverified" },
      ]),
    ).toEqual({ allowed: false, reason: "not-found-or-not-authorized" });
  });

  it("drops malformed, private, and non-official timeline records", () => {
    const selected = selectOfficialTimeline(
      [assignment.timeline[0], assignment.timeline[1], { kind: "decision" }, null],
      assignment.officialEventReceipts,
      { assignmentId: "assignment-a", attemptNumber: 1, caseVersionDigest: digest },
    );

    expect(selected.map(({ eventId }) => eventId)).toEqual(["event-1"]);
    expect(JSON.stringify(selected)).not.toContain("PRIVATE_TIMELINE_CANARY");
  });

  it("rejects a fabricated event that claims official provenance without a trusted receipt", () => {
    const fabricated = {
      ...officialEvent,
      eventId: "fabricated-event",
      title: "PRIVATE_FORGED_EVENT_CANARY",
      detail: "A private record claims an official source and a made-up receipt.",
      officialEventReceiptId: "forged-official-receipt",
    };

    expect(
      selectOfficialTimeline([fabricated], assignment.officialEventReceipts, {
        assignmentId: "assignment-a",
        attemptNumber: 1,
        caseVersionDigest: digest,
      }),
    ).toEqual([]);
  });

  it("rejects cross-assignment events and duplicate receipt, event, or sequence identities", () => {
    const binding = { assignmentId: "assignment-a", attemptNumber: 1, caseVersionDigest: digest };
    expect(() =>
      selectOfficialTimeline(
        [{ ...officialEvent, assignmentId: "assignment-b" }],
        assignment.officialEventReceipts,
        binding,
      ),
    ).toThrow(/another assignment attempt/);

    for (const duplicate of [
      { ...officialEvent, officialEventReceiptId: officialEvent.officialEventReceiptId },
      { ...officialEvent, eventId: officialEvent.eventId, officialEventReceiptId: "receipt-other" },
      { ...officialEvent, eventId: "event-other", officialEventReceiptId: "receipt-other" },
    ]) {
      expect(() =>
        selectOfficialTimeline(
          [officialEvent, duplicate],
          assignment.officialEventReceipts,
          binding,
        ),
      ).toThrow(/duplicate receipt, event, or sequence/);
    }

    const receipt = assignment.officialEventReceipts[0]!;
    expect(() =>
      selectOfficialTimeline([officialEvent], [receipt, receipt], binding),
    ).toThrow(/duplicate receipt, event, or sequence/);
    expect(() =>
      selectOfficialTimeline(
        [officialEvent],
        [{ ...receipt, assignmentId: "assignment-b" }],
        binding,
      ),
    ).toThrow(/another assignment attempt/);
  });
});

describe("review, replay, and reopening", () => {
  it("records an asynchronous review response without blocking the sandbox", () => {
    const response = createReviewResponse(
      {
        reviewRequestId: "review-request-1",
        assignmentId: "assignment-a",
        attemptNumber: 1,
        status: "open",
        studentSandboxAvailable: true,
      },
      {
        reviewResponseId: "review-response-1",
        operationId: "respond-review-1",
        assignmentId: "assignment-a",
        attemptNumber: 1,
        responderGithubUserId: "99101",
        responseText: "Proceed in the sandbox; keep the test reversible and record the threshold.",
        respondedAt: "2026-09-04T15:00:00.000Z",
      },
      [],
    );

    expect(response.blocksSandboxWork).toBe(false);
    expect(Object.isFrozen(response)).toBe(true);
  });

  it("rejects closed, sandbox-unavailable, duplicate, and mismatched review responses", () => {
    const request = {
      reviewRequestId: "review-request-1",
      assignmentId: "assignment-a",
      attemptNumber: 1,
      status: "open",
      studentSandboxAvailable: true,
    } as const;
    const input = {
      reviewResponseId: "review-response-1",
      operationId: "respond-review-1",
      assignmentId: "assignment-a",
      attemptNumber: 1,
      responderGithubUserId: "99101",
      responseText: "Continue the reversible sandbox test.",
      respondedAt: "2026-09-04T15:00:00.000Z",
    } as const;
    const existing = createReviewResponse(request, input, []);

    expect(() => createReviewResponse({ ...request, status: "closed" }, input, [])).toThrow(
      /not open/,
    );
    expect(() =>
      createReviewResponse({ ...request, studentSandboxAvailable: false }, input, []),
    ).toThrow(/available student sandbox/);
    expect(() => createReviewResponse(request, input, [existing])).toThrow(/already has a response/);
    expect(() =>
      createReviewResponse(request, { ...input, attemptNumber: 2 }, []),
    ).toThrow(/another assignment attempt/);
  });

  it("shows a linked replay while preserving official truth and the evaluation", () => {
    const original = providerRecord();
    const originalEvaluation = evaluation();
    const replay = replayProviderRecord(original);
    const comparison = buildReplayComparison(
      original,
      replay,
      originalEvaluation,
      [providerReceipt(original), providerReceipt(replay)],
    );

    expect(comparison.truthChanged).toBe(false);
    expect(comparison.evaluationChanged).toBe(false);
    expect(comparison.evaluation).toEqual(originalEvaluation);
    expect(comparison.replay.replayOfInteractionId).toBe(original.interactionId);
  });

  it("projects replay and evaluation records without carrying untrusted extra fields", () => {
    const original = {
      ...providerRecord(),
      privatePrompt: "PRIVATE_PROVIDER_CANARY",
    } as ProviderDisplayRecord;
    const replay = {
      ...replayProviderRecord(original),
      rawResponse: "PRIVATE_RESPONSE_CANARY",
    } as ProviderDisplayRecord;
    const recordedEvaluation = {
      ...evaluation(),
      canonicalAnswer: "PRIVATE_EVALUATION_CANARY",
    } as StaffEvaluationRecord;

    const comparison = buildReplayComparison(original, replay, recordedEvaluation, [
      providerReceipt(original),
      providerReceipt(replay),
    ]);
    expect(JSON.stringify(comparison)).not.toContain("CANARY");
  });

  it("rejects a replay that changes the official fact set", () => {
    const original = providerRecord();
    const replay = replayProviderRecord(original, { officialFactIds: ["invented-fact"] });
    expect(() =>
      buildReplayComparison(
        original,
        replay,
        evaluation(),
        [providerReceipt(original), providerReceipt(replay)],
      ),
    ).toThrow(/cannot change official truth/);
  });

  it("rejects replay records with untrusted, reused, or cross-attempt bindings", () => {
    const original = providerRecord();
    const replay = replayProviderRecord(original);
    const receipts = [providerReceipt(original), providerReceipt(replay)];

    expect(() => buildReplayComparison(original, replay, evaluation(), [])).toThrow(
      /trusted readback receipt/,
    );
    const reused = replayProviderRecord(original, {
      interactionId: original.interactionId,
      providerRecordReceiptId: "provider-record-receipt-reused",
    });
    expect(() =>
      buildReplayComparison(original, reused, evaluation(), [
        providerReceipt(original),
        providerReceipt(reused),
      ]),
    ).toThrow(/duplicate identity|distinct provider interaction/);
    const crossAttempt = replayProviderRecord(original, { attemptNumber: 2 });
    expect(() =>
      buildReplayComparison(original, crossAttempt, evaluation(), [
        providerReceipt(original),
        providerReceipt(crossAttempt),
      ]),
    ).toThrow(/cannot change official truth/);
    expect(() =>
      buildReplayComparison(original, replay, evaluation(), [
        { ...receipts[0]!, eventId: "other-event" },
        receipts[1]!,
      ]),
    ).toThrow(/trusted readback receipt/);
  });

  it("reopens as a distinct active attempt while freezing the old submission and evaluation", () => {
    const previous: EvaluatedAttemptSnapshot = {
      assignmentId: "assignment-a",
      caseVersionDigest: digest,
      attemptNumber: 1,
      status: "submitted",
      submissionId: "submission-1",
      submissionDigest: digest,
      evaluation: evaluation(),
    };
    const reopened = reopenEvaluatedAttempt(previous, {
      operationId: "reopen-assignment-a-2",
      openedAt: "2026-09-04T17:00:00.000Z",
    });

    expect(reopened.assignmentState).toBe("reopened");
    expect(reopened.previous).toEqual(previous);
    expect(reopened.next).toMatchObject({
      attemptNumber: 2,
      status: "active",
      reopenedFromAttempt: 1,
    });
    expect(reopened.next).not.toHaveProperty("submissionId");
    expect(reopened.next).not.toHaveProperty("evaluation");
    expect(Object.isFrozen(reopened.previous.evaluation)).toBe(true);
  });

  it("rejects reopening when the frozen case version is not digest-bound", () => {
    const previous = {
      assignmentId: "assignment-a",
      caseVersionDigest: "unverified",
      attemptNumber: 1,
      status: "submitted",
      submissionId: "submission-1",
      submissionDigest: digest,
      evaluation: evaluation(),
    } as unknown as EvaluatedAttemptSnapshot;

    expect(() =>
      reopenEvaluatedAttempt(previous, {
        operationId: "reopen-invalid-case",
        openedAt: "2026-09-04T17:00:00.000Z",
      }),
    ).toThrow(/prior attempt identity/);
  });

  it("rejects reopening when the evaluation belongs to another submission", () => {
    const previous: EvaluatedAttemptSnapshot = {
      assignmentId: "assignment-a",
      caseVersionDigest: digest,
      attemptNumber: 1,
      status: "submitted",
      submissionId: "submission-accepted",
      submissionDigest: digest,
      evaluation: evaluation(),
    };

    expect(() =>
      reopenEvaluatedAttempt(previous, {
        operationId: "reopen-cross-submission",
        openedAt: "2026-09-04T17:00:00.000Z",
      }),
    ).toThrow(/not bound to the accepted attempt snapshot/);
  });

  it("rejects every cross-attempt evaluation binding and unsafe attempt increments", () => {
    const previous = (record: StaffEvaluationRecord): EvaluatedAttemptSnapshot => ({
      assignmentId: "assignment-a",
      caseVersionDigest: digest,
      attemptNumber: 1,
      status: "submitted",
      submissionId: "submission-1",
      submissionDigest: digest,
      evaluation: record,
    });
    for (const record of [
      evaluation({}, { assignmentId: "assignment-b" }),
      evaluation({}, { attemptNumber: 2 }),
      evaluation({}, { caseVersionDigest: otherDigest }),
      evaluation({}, { submissionDigest: otherDigest }),
    ]) {
      expect(() =>
        reopenEvaluatedAttempt(previous(record), {
          operationId: "reopen-cross-binding",
          openedAt: "2026-09-04T17:00:00.000Z",
        }),
      ).toThrow(/not bound to the accepted attempt snapshot/);
    }

    expect(() =>
      reopenEvaluatedAttempt(
        {
          ...previous(evaluation({}, { attemptNumber: Number.MAX_SAFE_INTEGER })),
          attemptNumber: Number.MAX_SAFE_INTEGER,
        },
        {
          operationId: "reopen-overflow",
          openedAt: "2026-09-04T17:00:00.000Z",
        },
      ),
    ).toThrow(/prior attempt identity/);
  });
});

describe("hostile artifact and export boundaries", () => {
  const hostileArtifacts: readonly TextArtifact[] = [
    {
      artifactId: "artifact-html",
      relativePath: "evidence/hostile.html",
      contentType: "text/html",
      digest: sha256TextDigest(
        '<img src=x onerror="globalThis.__artifactExecuted=true"><script>alert(1)</script>',
      ),
      content: '<img src=x onerror="globalThis.__artifactExecuted=true"><script>alert(1)</script>',
    },
    {
      artifactId: "artifact-svg",
      relativePath: "evidence/hostile.svg",
      contentType: "image/svg+xml",
      digest: sha256TextDigest(
        '<svg onload="globalThis.__artifactExecuted=true"><image href="https://artifact-canary.invalid/svg"/></svg>',
      ),
      content: '<svg onload="globalThis.__artifactExecuted=true"><image href="https://artifact-canary.invalid/svg"/></svg>',
    },
    {
      artifactId: "artifact-markdown",
      relativePath: "evidence/hostile.md",
      contentType: "text/markdown",
      digest: sha256TextDigest("![remote](https://artifact-canary.invalid/markdown)"),
      content: "![remote](https://artifact-canary.invalid/markdown)",
    },
    {
      artifactId: "artifact-json",
      relativePath: "evidence/hostile.json",
      contentType: "application/json",
      digest: sha256TextDigest(
        '{"payload":"</script><script>globalThis.__artifactExecuted=true</script>"}',
      ),
      content: '{"payload":"</script><script>globalThis.__artifactExecuted=true</script>"}',
    },
    {
      artifactId: "artifact-csv",
      relativePath: "evidence/hostile.csv",
      contentType: "text/csv",
      digest: sha256TextDigest('=WEBSERVICE("https://artifact-canary.invalid/csv"),+1'),
      content: '=WEBSERVICE("https://artifact-canary.invalid/csv"),+1',
    },
  ];

  function artifactReceipt(
    artifact: TextArtifact,
    overrides: Partial<SubmissionArtifactReceipt> = {},
  ): SubmissionArtifactReceipt {
    return {
      receiptId: `receipt-${artifact.artifactId}`,
      assignmentId: "assignment-a",
      attemptNumber: 1,
      caseVersionDigest: digest,
      submissionId: "submission-1",
      submissionDigest: digest,
      artifactId: artifact.artifactId,
      relativePath: artifact.relativePath,
      contentType: artifact.contentType,
      byteLength: new TextEncoder().encode(artifact.content).byteLength,
      digest: artifact.digest,
      source: "submission-artifact-store-readback",
      ...overrides,
    };
  }

  const expectedSubmission = {
    assignmentId: "assignment-a",
    attemptNumber: 1,
    caseVersionDigest: digest,
    submissionId: "submission-1",
    submissionDigest: digest,
  } as const;

  it("reduces every supported hostile text type to inert bounded plain text", () => {
    for (const artifact of hostileArtifacts) {
      expect(inertArtifactView(artifact, artifactReceipt(artifact), expectedSubmission)).toMatchObject({
        displayMode: "plain-text",
        text: artifact.content,
        executable: false,
        remoteResourcesAllowed: false,
      });
    }
  });

  it("matches standard SHA-256 vectors and rejects artifact bytes that do not match the receipt", () => {
    expect(sha256TextDigest("")).toBe(
      "sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
    expect(sha256TextDigest("abc")).toBe(
      "sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    expect(sha256TextDigest("a".repeat(1_000))).toBe(
      "sha256:41edece42d63e8d9bf515a9ba6932e1c20cbc9f5a5d134645adb5db1b9737ea3",
    );
    expect(sha256TextDigest("Volta ⚡ evidence")).toBe(
      "sha256:db08285a7584b1cc11f06b715bc712b6be6e75f77628fa06a24db8e045bd4150",
    );
    const artifact = hostileArtifacts[0]!;
    expect(() =>
      inertArtifactView(
        { ...artifact, digest },
        artifactReceipt(artifact),
        expectedSubmission,
      ),
    ).toThrow(
      /does not match its verified digest/,
    );
  });

  it("requires an independent artifact receipt bound to the accepted submission and exact bytes", () => {
    const artifact = hostileArtifacts[0]!;
    expect(() => inertArtifactView(artifact, artifactReceipt(artifact), {
      ...expectedSubmission,
      assignmentId: "assignment-b",
    })).toThrow(/immutable submission receipt/);
    expect(() => inertArtifactView(artifact, artifactReceipt(artifact, { byteLength: 1 }), expectedSubmission))
      .toThrow(/immutable submission receipt/);
    expect(() => inertArtifactView(artifact, artifactReceipt(artifact, { relativePath: "other.html" }), expectedSubmission))
      .toThrow(/immutable submission receipt/);
    expect(() => inertArtifactView(artifact, artifactReceipt(artifact, { contentType: "text/csv" }), expectedSubmission))
      .toThrow(/immutable submission receipt/);
  });

  it("rejects Windows, backslash, control, dot, and empty path segments", () => {
    const artifact = hostileArtifacts[0]!;
    for (const relativePath of [
      "C:/evidence/hostile.html",
      "C:\\evidence\\hostile.html",
      "\\\\server\\share\\hostile.html",
      "evidence\\hostile.html",
      "evidence/./hostile.html",
      "evidence/../hostile.html",
      "evidence//hostile.html",
      "evidence/hostile.html/",
      "evidence/hostile\u0000.html",
    ]) {
      const changed = { ...artifact, relativePath };
      expect(() =>
        inertArtifactView(changed, artifactReceipt(changed), expectedSubmission),
      ).toThrow(/path must stay relative|receipt is invalid/);
    }
  });

  it("neutralizes spreadsheet formula prefixes including leading whitespace", () => {
    for (const value of ["=1+1", "+SUM(A1:A2)", "-2+3", "@cmd", "  =WEBSERVICE()"])
      expect(neutralizeSpreadsheetFormula(value)).toBe(`'${value}`);
    expect(neutralizeSpreadsheetFormula("ordinary text")).toBe("ordinary text");
  });

  it("neutralizes formula-bearing rationales in the CSV export", () => {
    const changed = mutableDraft();
    changed.competencies["problem-viability"].rationale = "=WEBSERVICE(\"https://artifact-canary.invalid/export\")";
    const csv = exportEvaluationCsv(
      createHumanEvaluation({
        evaluationId: "evaluation-export",
        operationId: "evaluate-export",
        evaluatorGithubUserId: "99101",
        evaluatedAt: "2026-09-04T16:00:00.000Z",
        acceptedSubmission: acceptedSubmission(),
        draft: changed,
      }),
    );

    expect(csv).toContain("'=WEBSERVICE");
    expect(csv).not.toContain('",=WEBSERVICE');
  });
});
