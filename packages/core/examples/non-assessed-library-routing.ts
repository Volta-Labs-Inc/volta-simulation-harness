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
      {
        id: "intake-process",
        claim:
          "Patrons ask at the front desk. The desk clerk answers directly when able; otherwise the question goes on a paper slip that the specialist collects twice a day.",
        provenance: "Frozen public example: Morgan's description of the intake process",
        source: { channel: "persona", targetId: "library-manager" },
      },
      {
        id: "manager-goal",
        claim:
          "Morgan would consider the problem addressed if a typical patron waited no more than ten minutes for a first response with no rise in corrected answers.",
        provenance: "Frozen public example: Morgan's stated goal",
        source: { channel: "persona", targetId: "library-manager" },
      },
      {
        id: "log-sample-size",
        claim: "The frozen desk-log sample contains 20 handled questions.",
        provenance: "Frozen public example desk log, rows 1-20",
        source: { channel: "evidence", targetId: "desk-log" },
      },
      {
        id: "log-wait-range",
        claim: "First response times in the frozen sample range from 4 to 41 minutes.",
        provenance: "Frozen public example desk log, rows 1-20",
        source: { channel: "evidence", targetId: "desk-log" },
      },
      {
        id: "log-first-response-definition",
        claim:
          "In the log, first response time is the gap between a patron asking and receiving any first answer, from the clerk or the specialist; the two are not separated.",
        provenance: "Frozen public example desk log, column definitions",
        source: { channel: "evidence", targetId: "desk-log" },
      },
    ],
    outOfUniverse: {
      studentMessage:
        "No authored answer matches that question as asked. Ask about one specific thing in plain words. If this case has never measured it, that is your answer: record it as an unknown.",
    },
    routes: [
      {
        id: "ask-manager-wait",
        channel: "persona",
        targetId: "library-manager",
        priority: 10,
        match: {
          anyPhrases: [],
          allTerms: [],
          anyTermGroups: [["wait"], ["waiting"], ["long"], ["delay"], ["slow"], ["quickly"], ["response", "time"]],
          noneTerms: ["slip", "slips", "why", "mean", "means", "definition", "defined", "complain", "complaints", "complained"],
        },
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
          anyPhrases: ["response time", "handling time", "baseline", "median", "wait", "typical"],
          allTerms: [],
          anyTermGroups: [],
          noneTerms: ["mean", "means", "definition", "defined", "measured", "counted", "slip", "slips", "specialist"],
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
          studentMessage:
            "The synthetic log is available and records a median first response time of 18 minutes.",
        },
      },
      {
        id: "ask-manager-intake",
        channel: "persona",
        targetId: "library-manager",
        priority: 9,
        match: {
          anyPhrases: [],
          allTerms: [],
          anyTermGroups: [
            ["intake"], ["process"], ["handled"], ["handle"], ["triage"], ["routed"], ["route"], ["workflow"],
            ["front", "desk"], ["what", "happens"], ["steps"], ["flow"], ["slip"], ["slips"], ["clerk"],
            ["specialist"], ["decide"], ["escalate"], ["escalated"],
          ],
          noneTerms: ["accuracy", "accurate", "budget", "staff", "specialists"],
        },
        prerequisiteFactIds: [],
        prerequisiteEvidenceIds: [],
        releasedEvidenceIds: [],
        consequence: {
          id: "manager-intake-answer",
          time: { amount: 10, unit: "minutes" },
          resources: [],
          evidenceOutcome: "release",
        },
        outcome: {
          kind: "release",
          factIds: ["intake-process"],
          studentMessage:
            "Morgan explains: patrons ask at the front desk. The clerk answers directly when able; otherwise the question goes on a paper slip that the specialist collects twice a day.",
        },
      },
      {
        id: "ask-manager-goal",
        channel: "persona",
        targetId: "library-manager",
        priority: 11,
        match: {
          anyPhrases: [],
          allTerms: [],
          anyTermGroups: [["outcome"], ["worth"], ["goal"], ["success"], ["target"], ["addressed"], ["good", "enough"], ["why"], ["matter"], ["motivation"]],
          noneTerms: ["accuracy", "accurate"],
        },
        prerequisiteFactIds: [],
        prerequisiteEvidenceIds: [],
        releasedEvidenceIds: [],
        consequence: {
          id: "manager-goal-answer",
          time: { amount: 10, unit: "minutes" },
          resources: [],
          evidenceOutcome: "release",
        },
        outcome: {
          kind: "release",
          factIds: ["manager-goal"],
          studentMessage:
            "Morgan would call it addressed if a typical patron waited no more than ten minutes for a first response, with no rise in corrected answers.",
        },
      },
      {
        id: "ask-manager-accuracy",
        channel: "persona",
        targetId: "library-manager",
        priority: 12,
        match: {
          anyPhrases: [],
          allTerms: [],
          anyTermGroups: [["accuracy"], ["accurate"], ["correct"], ["corrected"], ["wrong"], ["error"], ["errors"], ["mistakes"]],
          noneTerms: [],
        },
        prerequisiteFactIds: [],
        prerequisiteEvidenceIds: [],
        releasedEvidenceIds: [],
        consequence: {
          id: "manager-accuracy-refusal",
          time: { amount: 5, unit: "minutes" },
          resources: [],
          evidenceOutcome: "unavailable",
        },
        outcome: {
          kind: "unavailable",
          factIds: [],
          studentMessage:
            "Morgan has never measured answer accuracy and will not guess at it. Treat accuracy as unknown.",
        },
      },
      {
        id: "ask-manager-staffing",
        channel: "persona",
        targetId: "library-manager",
        priority: 12,
        match: {
          anyPhrases: [],
          allTerms: [],
          anyTermGroups: [["budget"], ["staff"], ["staffing"], ["specialists"], ["headcount"], ["hire"], ["hiring"], ["funding"]],
          noneTerms: [],
        },
        prerequisiteFactIds: [],
        prerequisiteEvidenceIds: [],
        releasedEvidenceIds: [],
        consequence: {
          id: "manager-staffing-refusal",
          time: { amount: 5, unit: "minutes" },
          resources: [],
          evidenceOutcome: "unavailable",
        },
        outcome: {
          kind: "unavailable",
          factIds: [],
          studentMessage:
            "Morgan has no budget or staffing figure to share; treat both as unknown. The one fixed constraint is that no staff can be added during the example period.",
        },
      },
      {
        id: "ask-log-period",
        channel: "evidence",
        targetId: "desk-log",
        priority: 12,
        match: {
          anyPhrases: [],
          allTerms: [],
          anyTermGroups: [["period"], ["dates"], ["dated"], ["when"], ["cover"], ["covers"], ["timeframe"], ["month"], ["week"], ["day"], ["daily"]],
          noneTerms: [],
        },
        prerequisiteFactIds: [],
        prerequisiteEvidenceIds: [],
        releasedEvidenceIds: [],
        consequence: {
          id: "log-period-refusal",
          time: { amount: 5, unit: "minutes" },
          resources: [{ id: "desk-log-query", amount: 1, unit: "query" }],
          evidenceOutcome: "unavailable",
        },
        outcome: {
          kind: "unavailable",
          factIds: [],
          studentMessage:
            "The frozen sample is not dated. It records 20 handled questions and nothing about the period they cover or the daily volume.",
        },
      },
      {
        id: "ask-log-definition",
        channel: "evidence",
        targetId: "desk-log",
        priority: 12,
        match: {
          anyPhrases: [],
          allTerms: [],
          anyTermGroups: [["mean"], ["means"], ["definition"], ["defined"], ["measured"], ["counted"], ["what", "is", "first"]],
          noneTerms: [],
        },
        prerequisiteFactIds: [],
        prerequisiteEvidenceIds: [],
        releasedEvidenceIds: [],
        consequence: {
          id: "log-definition-release",
          time: { amount: 5, unit: "minutes" },
          resources: [{ id: "desk-log-query", amount: 1, unit: "query" }],
          evidenceOutcome: "release",
        },
        outcome: {
          kind: "release",
          factIds: ["log-first-response-definition"],
          studentMessage:
            "In the log, first response time is the gap between a patron asking and receiving any first answer, whether from the clerk or the specialist. The log does not separate the two.",
        },
      },
      {
        id: "ask-log-accuracy",
        channel: "evidence",
        targetId: "desk-log",
        priority: 13,
        match: {
          anyPhrases: [],
          allTerms: [],
          anyTermGroups: [["accuracy"], ["accurate"], ["correct"], ["corrected"], ["wrong"], ["error"], ["errors"], ["mistakes"]],
          noneTerms: [],
        },
        prerequisiteFactIds: [],
        prerequisiteEvidenceIds: [],
        releasedEvidenceIds: [],
        consequence: {
          id: "log-accuracy-refusal",
          time: { amount: 5, unit: "minutes" },
          resources: [{ id: "desk-log-query", amount: 1, unit: "query" }],
          evidenceOutcome: "unavailable",
        },
        outcome: {
          kind: "unavailable",
          factIds: [],
          studentMessage:
            "The log records timing only. It has no field for whether an answer was accurate, so accuracy cannot be established from it.",
        },
      },
      {
        id: "ask-log-sample-size",
        channel: "evidence",
        targetId: "desk-log",
        priority: 11,
        match: {
          anyPhrases: [],
          allTerms: [],
          anyTermGroups: [["how", "many"], ["sample", "size"], ["rows"], ["records"], ["count"], ["entries"], ["observations"]],
          noneTerms: ["day", "daily", "week", "weekly", "specialist", "passed", "routed", "share", "percent", "proportion", "clerk"],
        },
        prerequisiteFactIds: [],
        prerequisiteEvidenceIds: [],
        releasedEvidenceIds: [],
        consequence: {
          id: "log-sample-size-release",
          time: { amount: 5, unit: "minutes" },
          resources: [{ id: "desk-log-query", amount: 1, unit: "query" }],
          evidenceOutcome: "release",
        },
        outcome: {
          kind: "release",
          factIds: ["log-sample-size"],
          studentMessage: "The frozen sample contains 20 handled questions.",
        },
      },
      {
        id: "ask-log-range",
        channel: "evidence",
        targetId: "desk-log",
        priority: 11,
        match: {
          anyPhrases: [],
          allTerms: [],
          anyTermGroups: [["range"], ["spread"], ["distribution"], ["slowest"], ["fastest"], ["longest"], ["shortest"], ["maximum"], ["minimum"], ["variance"], ["percentile"], ["outliers"]],
          noneTerms: [],
        },
        prerequisiteFactIds: [],
        prerequisiteEvidenceIds: [],
        releasedEvidenceIds: [],
        consequence: {
          id: "log-range-release",
          time: { amount: 15, unit: "minutes" },
          resources: [{ id: "desk-log-query", amount: 1, unit: "query" }],
          evidenceOutcome: "release",
        },
        outcome: {
          kind: "release",
          factIds: ["log-wait-range"],
          studentMessage: "First response times in the frozen sample range from 4 to 41 minutes.",
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
