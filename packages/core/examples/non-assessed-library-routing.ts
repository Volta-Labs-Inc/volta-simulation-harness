import type { ApprovedCaseVersionSource, SubmissionDraft } from "@volta-sim/contracts";

const placeholderDigest = `sha256:${"0".repeat(64)}` as const;

/**
 * A deliberately simple public fixture. It demonstrates the engine without
 * revealing any assessed case, calibration submission, or private customer truth.
 */
export const nonAssessedLibraryRoutingCase: ApprovedCaseVersionSource = {
  status: "approved",
  visible: {
    caseId: "public-library-question-routing",
    versionLabel: "example-1",
    assessmentUse: "non-assessed-example",
    title: "Route questions at a fictional community library",
    brief:
      "A fictional community library wants to reduce the time patrons wait for answers without making specialist advice less accurate.",
    difficulty: {
      audience: "New simulation authors and test runners",
      experienceLevel: "introductory",
      factors: [
        {
          id: "limited-data",
          dimension: "data-availability",
          level: "medium",
          rationale: "One baseline is known while accuracy remains deliberately unavailable.",
        },
      ],
    },
    constraints: [
      "The library cannot add staff during the example period.",
      "The example must not send messages or change a real system.",
    ],
    unacceptableOutcomes: [
      "A patron receives invented policy advice.",
      "The proposed response requires a real production action.",
    ],
    nonExhaustiveResponseFamilies: [
      "Change the intake instructions",
      "Trial a routing aid",
      "Collect a better baseline",
      "Choose not to build",
    ],
    competencies: [
      {
        id: "problem-viability",
        title: "Problem viability",
        studentPrompt: "Explain whether this problem warrants action and what evidence supports that view.",
      },
      {
        id: "evidence-sufficiency",
        title: "Evidence sufficiency",
        studentPrompt: "Separate official facts from assumptions, contradictions, and unknowns.",
      },
      {
        id: "response-feasibility",
        title: "Proportionate response",
        studentPrompt: "Defend why the proposed response fits the evidence, authority, cost, and risk.",
      },
      {
        id: "objective-success-criteria",
        title: "Objective success criteria",
        studentPrompt: "State the baseline or baseline plan, target, date, and failure threshold.",
      },
    ],
    requirements: [
      {
        id: "patron-wait",
        title: "Patron wait",
        prompt: "Establish the current response-time baseline or a credible plan to measure it.",
        applicability: "applicable",
      },
    ],
    personas: [
      {
        id: "library-manager",
        name: "Morgan",
        role: "Fictional library manager",
        studentBrief: "Morgan manages the front desk and can explain the current intake process.",
      },
    ],
    evidenceSources: [
      {
        id: "desk-log",
        title: "Fictional front-desk log",
        kind: "dataset",
        studentBrief: "A frozen, synthetic sample of question handling times.",
      },
    ],
  },
  protected: {
    facts: [
      {
        id: "median-wait",
        claim: "The synthetic desk log shows a median first response time of 18 minutes.",
        provenance: "Frozen public example desk log, rows 1-20",
        source: { channel: "persona", targetId: "library-manager" },
      },
      {
        id: "log-median-wait",
        claim: "The synthetic desk log records a median first response time of 18 minutes.",
        provenance: "Frozen public example desk log, rows 1-20",
        source: { channel: "evidence", targetId: "desk-log" },
      },
    ],
    routes: [
      {
        id: "ask-manager-wait",
        channel: "persona",
        targetId: "library-manager",
        priority: 10,
        match: { anyPhrases: [], allTerms: ["wait", "time"], anyTermGroups: [], noneTerms: [] },
        prerequisiteFactIds: [],
        prerequisiteEvidenceIds: [],
        releasedEvidenceIds: [],
        consequence: {
          id: "manager-wait-answer",
          time: { amount: 10, unit: "minutes" },
          resources: [],
          evidenceOutcome: "release",
        },
        outcome: {
          kind: "release",
          factIds: ["median-wait"],
          studentMessage: "The frozen example log shows a median first response time of 18 minutes.",
        },
      },
      {
        id: "ask-log-wait",
        channel: "evidence",
        targetId: "desk-log",
        priority: 10,
        match: {
          anyPhrases: ["response time", "handling time"],
          allTerms: [],
          anyTermGroups: [],
          noneTerms: [],
        },
        prerequisiteFactIds: [],
        prerequisiteEvidenceIds: [],
        releasedEvidenceIds: [],
        consequence: {
          id: "log-wait-release",
          time: { amount: 15, unit: "minutes" },
          resources: [{ id: "desk-log-query", amount: 1, unit: "query" }],
          evidenceOutcome: "release",
        },
        outcome: {
          kind: "release",
          factIds: ["log-median-wait"],
          studentMessage: "The synthetic log is available and records a median of 18 minutes.",
        },
      },
    ],
    personaBehaviors: [
      {
        personaId: "library-manager",
        incentives: ["Reduce queues without lowering the accuracy of patron advice."],
        uncertainties: ["Morgan has not measured answer accuracy."],
        refusalRules: [
          {
            id: "no-invented-accuracy",
            trigger: "The student asks for an accuracy measurement that was never collected.",
            responseBoundary: "State that the measurement is unavailable and do not estimate it.",
          },
        ],
      },
    ],
    calibrationAnchors: [
      {
        class: "effective",
        artifactDigest: placeholderDigest,
        rationale: "Public placeholder showing that this class is required; it is not an answer key.",
      },
      {
        class: "partially-effective",
        artifactDigest: placeholderDigest,
        rationale: "Public placeholder showing that this class is required; it is not an answer key.",
      },
      {
        class: "not-yet-effective",
        artifactDigest: placeholderDigest,
        rationale: "Public placeholder showing that this class is required; it is not an answer key.",
      },
    ],
    nonExhaustiveOutcomeFamilies: [
      {
        id: "measure-first",
        title: "Measure before choosing a response",
        warrantingConditions: ["Answer accuracy is unknown."],
        disqualifyingConditions: ["The student invents an accuracy baseline."],
        nonExhaustive: true,
      },
    ],
    authoredRisks: ["A faster first response could be less accurate."],
    successStandard:
      "A reviewer should be able to tell what was observed, what remains unknown, and what result would cause the response to stop.",
  },
  requirementsSnapshot: {
    source: "Public example requirements",
    sourceDigest: placeholderDigest,
    capturedAt: "2026-09-04T12:00:00.000Z",
  },
  methodologySnapshot: {
    source: "Public example methodology",
    sourceDigest: placeholderDigest,
    capturedAt: "2026-09-04T12:00:00.000Z",
  },
  approvedBy: "Public example fixture",
  approvedAt: "2026-09-04T12:00:00.000Z",
};

export function makeCompleteExampleSubmission(caseVersionDigest: `sha256:${string}`): SubmissionDraft {
  const timestamp = "2026-09-04T14:00:00.000Z";
  const evidenceId = "evidence-1";
  return {
    submissionId: "submission-1",
    assignmentId: "assignment-1",
    studentGithubUserId: "12345",
    attemptNumber: 1,
    caseVersionDigest,
    gitCommitSha: "a".repeat(40),
    ledger: [
      {
        id: "ledger-fact-1",
        kind: "fact",
        statement: "The median first response time is 18 minutes.",
        officialFactIds: ["median-wait"],
        createdAt: timestamp,
      },
      {
        id: "ledger-unknown-1",
        kind: "unknown",
        statement: "The example does not establish whether faster responses remain accurate.",
        officialFactIds: [],
        createdAt: timestamp,
      },
    ],
    evidence: [
      {
        id: evidenceId,
        assignmentId: "assignment-1",
        attemptNumber: 1,
        officialFactId: "median-wait",
        sourceEventId: "event-8",
        capturedAt: timestamp,
        provenance: "Released by authored route ask-manager-wait",
      },
    ],
    decision: {
      id: "decision-1",
      choice: "collect-more-evidence",
      rationale: "Measure answer accuracy before deciding whether a routing aid is warranted.",
      supportingEvidenceIds: [evidenceId],
      expectedEvidence: [
        {
          description: "A bounded sample of answer-accuracy observations",
          sourceOrMethod: "Observe the next synthetic desk-log sample",
          decisionUse: "Decide whether a routing aid can improve speed without reducing accuracy",
        },
      ],
      pivotOrStopConditions: [
        {
          action: "stop",
          condition: "Sampled answer accuracy declines at all",
          rationale: "A faster response is not viable if advice becomes less accurate",
        },
      ],
      createdAt: timestamp,
    },
    estimates: [
      {
        id: "estimate-1",
        subject: "Time needed to observe a second synthetic sample",
        low: 2,
        high: 4,
        unit: "hours",
        assumptions: ["The frozen log format remains available"],
        confidence: 0.6,
        createdAt: timestamp,
      },
    ],
    missingDataPlan: "Sample answer accuracy alongside wait time before deciding to build.",
    requirementAssessments: [
      {
        requirementId: "patron-wait",
        status: "addressed",
        rationale: "The released synthetic log establishes an 18-minute baseline.",
        evidenceIds: [evidenceId],
      },
    ],
    competencyClaims: [
      {
        competencyId: "problem-viability",
        rationale: "The delay exists, but its cost and relationship to accuracy remain uncertain.",
        evidenceIds: [evidenceId],
      },
      {
        competencyId: "evidence-sufficiency",
        rationale: "The response-time baseline is official; accuracy is explicitly unknown.",
        evidenceIds: [evidenceId],
      },
      {
        competencyId: "response-feasibility",
        rationale: "A second measurement is proportionate and requires no real-world change.",
        evidenceIds: [evidenceId],
      },
      {
        competencyId: "objective-success-criteria",
        rationale: "The observation has a target date and a predefined failure threshold.",
        evidenceIds: [evidenceId],
      },
    ],
    successCriteria: [
      {
        metric: "Median first response time with accurate answer",
        baseline: "18 minutes; accuracy baseline not yet available",
        target: "At most 12 minutes with no reduction in sampled accuracy",
        targetDate: "2026-09-18T14:00:00.000Z",
        failureThreshold: "Stop if sampled answer accuracy declines at all",
      },
    ],
    calculations: [
      {
        id: "sample-size",
        name: "Synthetic records reviewed",
        inputs: [{ name: "desk-records", value: 20, unit: "records", source: "desk-log" }],
        formula: { operation: "sum", inputNames: ["desk-records"] },
        result: { value: 20, unit: "records" },
        rationale: "Makes the small sample size explicit and reproducible.",
      },
    ],
    economicRationale:
      "The example estimates staff observation time only; it makes no invented savings claim.",
    responsePlan: {
      mode: "no-build",
      rationale: "The accuracy baseline should be collected before a build decision.",
      feasibility: "The synthetic observation can be completed with the existing example data.",
      risks: ["The small frozen sample may not represent a different period."],
      artifactSnapshots: [],
    },
  };
}
